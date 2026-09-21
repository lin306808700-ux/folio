// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * Model Provider Abstraction Layer
 *
 * 统一接口支持多种 LLM 后端：
 * - qoder:    复用本机 Qoder CLI（qodercli）的登录与额度，零密钥配置（默认）
 * - openai:   OpenAI-compatible API (OpenAI, DeepSeek, Ollama, vLLM, LiteLLM, ...)
 *
 * 配置方式：
 *   环境变量（推荐，通过 .env 文件加载）；qoder 模式零配置
 *
 * 环境变量说明见 .env.example
 */

const axios = require('axios')
const { StringDecoder } = require('string_decoder')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { isProviderErrorText } = require('./ai-error')

// ========== .env 文件加载（零依赖）==========

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '..', '.env')
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      // 不覆盖已存在的环境变量
      if (!process.env[key]) process.env[key] = value
    }
  } catch (_) { /* .env 不存在，忽略 */ }
}
loadEnvFile()

// ========== 配置加载 ==========

function loadConfig() {
  const rawProvider = process.env.MUSE_MODEL_PROVIDER || 'qoder'

  // OpenAI 兼容模式
  if (rawProvider === 'openai') {
    const apiKey = process.env.MUSE_API_KEY
    if (!apiKey) {
      console.warn('[ModelProvider] openai 模式缺少 MUSE_API_KEY，请在 .env 中配置。参考 .env.example')
    }
    return {
      provider: 'openai',
      apiKey: apiKey || '',
      baseUrl: (process.env.MUSE_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: process.env.MUSE_MODEL || 'gpt-4o',
    }
  }

  if (rawProvider !== 'qoder') {
    console.warn(`[ModelProvider] 未知 provider「${rawProvider}」（aistudio 已移除），回退到 qoder`)
  }

  // 默认：复用本机 Qoder CLI，无密钥配置，登录态由 qodercli login 管理
  return {
    provider: 'qoder',
    model: process.env.MUSE_QODER_MODEL || '',
    bin: process.env.MUSE_QODER_BIN || 'qodercli',
  }
}

const _config = loadConfig()
console.log(`[ModelProvider] 使用 provider: ${_config.provider}` + (_config.provider === 'openai' ? `, model: ${_config.model}` : ''))

// ========== 公共工具 ==========

/**
 * 过滤 AI 模型返回的思考）
 */
function stripThinkingTags(text) {
  if (!text || typeof text !== 'string') return text
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  cleaned = cleaned.replace(/<\/?think>/g, '')
  cleaned = cleaned.replace(/^(?:[a-z]*>[\s\n]*)+/gm, '')
  return cleaned.trim()
}

// ========== 请求队列（串行执行）==========

let requestQueue = Promise.resolve()

// ========== 瞬时错误重试 ==========

const RETRYABLE_ERRORS = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
  'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED'
])
const MAX_RETRIES = 2
const RETRY_DELAY_BASE = 1000 // 1s, 2s

function isRetryableError(error) {
  if (!error) return false
  // 网络层错误码
  if (error.code && RETRYABLE_ERRORS.has(error.code)) return true
  // axios 超时
  if (error.message && error.message.includes('timeout')) return true
  // 5xx 服务端错误可重试
  if (error.response && error.response.status >= 500 && error.response.status < 600) return true
  return false
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ========== 调用标签注册表 ==========
// 每次 AI 调用可携带 label（如 'prefetch' 后台预生成），用于：
// 1) isAiBusy：后台任务检测是否有交互调用在用 AI，主动让路
// 2) abortCallsByLabel：交互请求抢占中断后台调用，避免排队等待
const _activeLabels = []
const _labelKillers = new Map() // label -> Set<() => void>

function registerCallKiller(label, killer) {
  if (!label || typeof killer !== 'function') return () => {}
  if (!_labelKillers.has(label)) _labelKillers.set(label, new Set())
  _labelKillers.get(label).add(killer)
  return () => {
    const set = _labelKillers.get(label)
    if (!set) return
    set.delete(killer)
    if (set.size === 0) _labelKillers.delete(label)
  }
}

function isAiBusy(excludeLabels = []) {
  return _activeLabels.some(label => !excludeLabels.includes(label))
}

function abortCallsByLabel(label) {
  const set = _labelKillers.get(label)
  if (!set || set.size === 0) return 0
  const killers = [...set]
  killers.forEach(killer => { try { killer() } catch (_) {} })
  return killers.length
}

// ========== OpenAI Compatible Provider ==========

async function callOpenAI(question, options = {}) {
  const { timeout = 60000, signal, label } = options
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort)
  const unregisterKiller = registerCallKiller(label, () => controller.abort())

  try {
    const response = await axios.post(
      `${_config.baseUrl}/chat/completions`,
      {
        model: _config.model,
        messages: [{ role: 'user', content: question }],
        stream: false,
      },
      {
        headers: {
          'Authorization': `Bearer ${_config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout,
        signal: controller.signal,
      }
    )

    const content = response.data?.choices?.[0]?.message?.content || ''
    return stripThinkingTags(content)
  } finally {
    unregisterKiller()
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

async function* callOpenAIStream(question, options = {}) {
  const { timeout = 300000, signal, label } = options
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort)
  const unregisterKiller = registerCallKiller(label, () => controller.abort())

  let response
  try {
    response = await axios.post(
      `${_config.baseUrl}/chat/completions`,
      {
        model: _config.model,
        messages: [{ role: 'user', content: question }],
        stream: true,
      },
      {
        headers: {
          'Authorization': `Bearer ${_config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout,
        responseType: 'stream',
        signal: controller.signal,
      }
    )
  } catch (error) {
    unregisterKiller()
    signal?.removeEventListener('abort', onOuterAbort)
    throw error
  }

  let fullContent = ''
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  try {
    for await (const chunk of response.data) {
      if (signal?.aborted || controller.signal.aborted) return

      buffer += decoder.write(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr || jsonStr === '[DONE]') {
          yield { delta: '', content: stripThinkingTags(fullContent), streamEnd: true }
          return
        }

        try {
          const parsed = JSON.parse(jsonStr)

          // OpenAI 错误格式
          if (parsed.error) {
            const err = new Error(parsed.error.message || 'OpenAI API error')
            err.aiErrorCode = 'OPENAI_ERROR'
            throw err
          }

          const delta = parsed?.choices?.[0]?.delta?.content || ''
          const finishReason = parsed?.choices?.[0]?.finish_reason

          if (delta) {
            fullContent += delta
            const cleaned = stripThinkingTags(fullContent)
            yield { delta, content: cleaned, streamEnd: false }
          }

          if (finishReason) {
            yield { delta: '', content: stripThinkingTags(fullContent), streamEnd: true }
            return
          }
        } catch (e) {
          if (e && e.aiErrorCode) throw e
          continue
        }
      }
    }

    // 处理残留数据
    const remaining = decoder.end()
    if (remaining) buffer += remaining
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim()
        try {
          const parsed = JSON.parse(jsonStr)
          const delta = parsed?.choices?.[0]?.delta?.content || ''
          if (delta) {
            fullContent += delta
            yield { delta, content: stripThinkingTags(fullContent), streamEnd: true }
          }
        } catch (_) { /* 忽略 */ }
      }
    }
  } finally {
    unregisterKiller()
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

// ========== Qoder CLI Provider ==========

function buildQoderArgs() {
  // 无头纯聊天：-p 非交互输出，--tools '' 禁用全部工具（防文件副作用），-- 分隔 query
  const args = ['-p', '--tools', '', '--dangerously-skip-permissions', '--']
  if (_config.model) args.splice(1, 0, '--model', _config.model)
  return args
}

/**
 * 启动 qodercli 子进程，返回 { child, waitExit }
 * waitExit() resolve 退出码；未登录/未安装等错误通过 reject 抛出友好信息
 */
function spawnQoder(question) {
  let child
  try {
    child = spawn(_config.bin || 'qodercli', [...buildQoderArgs(), question], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    })
  } catch (e) {
    throw new Error(`无法启动 qodercli：${e.message}`)
  }

  child.on('error', () => {
    // spawn 失败（ENOENT 等）由 stderr/close 分支兜底，这里防未捕获
  })

  const waitExit = () => new Promise((resolve, reject) => {
    let stderr = ''
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => {
      reject(new Error(err.code === 'ENOENT'
        ? '未检测到 qodercli，请先安装 Qoder CLI'
        : `qodercli 启动失败：${err.message}`))
    })
    // 用 'exit' 而非 'close'：qodercli 后台守护子进程可能继承 stdio 管道，
    // 'close' 要等管道全部 EOF 才触发，会导致流永不结束（前端停止按钮卡住）
    child.on('exit', code => {
      if (/not logged in|please run .?\/login/i.test(stderr)) {
        reject(new Error('qodercli 未登录，请先在终端执行 qodercli login'))
        return
      }
      resolve({ code, stderr })
    })
  })

  return { child, waitExit }
}

/** exit 后等待 stdio 尾部数据排空：'close' 到达即返回，否则超时兜底 */
function waitStdioDrain(child, graceMs = 500) {
  return Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    sleep(graceMs),
  ])
}

function isQoderLoginError(text) {
  return !!text && text.length < 120 && /not logged in|please run .?\/login/i.test(text)
}

/**
 * 额度耗尽 / 鉴权失败时，qodercli 会把错误写到 stdout。流式读取时它与正常输出
 * 无从区分，会被当成正文一路传下去，落盘后就成了一段不可读的「章节」。
 * 这里统一转成异常，避免上层把「一次失败的调用」当成「一次成功的生成」。
 */
function assertNotProviderError(text) {
  if (isProviderErrorText(text)) {
    throw new Error(`模型调用失败：${text.slice(0, 200)}`)
  }
}

async function callQoder(question, options = {}) {
  const { timeout = 300000, signal, label } = options
  const { child, waitExit } = spawnQoder(question)

  let stdout = ''
  child.stdout.on('data', d => { stdout += d.toString() })

  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  const onAbort = () => child.kill('SIGKILL')
  signal?.addEventListener('abort', onAbort)
  const unregisterKiller = registerCallKiller(label, () => child.kill('SIGKILL'))

  try {
    const { code, stderr } = await waitExit()
    // 进程已退出，排空管道里残留的尾部输出
    await waitStdioDrain(child)
    if (signal?.aborted) throw new Error('AI 调用已中断')
    const content = stripThinkingTags(stdout)
    if (isQoderLoginError(content)) throw new Error('qodercli 未登录，请先在终端执行 qodercli login')
    assertNotProviderError(content)
    if (!content && code !== 0) {
      throw new Error(`qodercli 执行失败（exit ${code}）：${(stderr || '').slice(0, 200)}`)
    }
    return content
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    unregisterKiller()
  }
}

async function* callQoderStream(question, options = {}) {
  const { timeout = 300000, signal, label } = options
  const { child, waitExit } = spawnQoder(question)

  let fullContent = ''
  const chunks = []
  let exited = false
  // 用标志位而非一次性 notify：exit 可能在消费者挂起前到达，
  // 一次性 notify 会丢失导致循环永久卡死（前端停止按钮不消失）
  child.stdout.on('data', d => { chunks.push(d.toString()) })

  const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
  const onAbort = () => child.kill('SIGKILL')
  signal?.addEventListener('abort', onAbort)
  const unregisterKiller = registerCallKiller(label, () => child.kill('SIGKILL'))

  const exitPromise = waitExit().finally(() => { exited = true })
  exitPromise.catch(() => {}) // 守卫：中断提前退出时避免 unhandledRejection

  try {
    // qodercli -p 的输出可能整体一次到达，也可能逐块到达，统一按增量 yield
    while (true) {
      if (signal?.aborted) return
      while (chunks.length > 0) {
        const delta = chunks.shift()
        fullContent += delta
        yield { delta, content: stripThinkingTags(fullContent), streamEnd: false }
      }
      if (exited) break
      await sleep(20) // 让出事件循环接收数据/exit 事件
    }
    // exit 后排空尾部数据，再统一按增量 yield
    await waitStdioDrain(child)
    while (chunks.length > 0) {
      const delta = chunks.shift()
      fullContent += delta
      yield { delta, content: stripThinkingTags(fullContent), streamEnd: false }
    }
    const { code, stderr } = await exitPromise.catch(e => ({ code: 1, stderr: e.message }))
    const content = stripThinkingTags(fullContent)
    if (isQoderLoginError(content)) throw new Error('qodercli 未登录，请先在终端执行 qodercli login')
    // 必须在 yield streamEnd 之前抛：消费方（学习图谱预生成 / 章节撰写）都是
    // 累积到流结束才落盘，抛异常才能让这次调用被记为失败而不是一次成功的生成。
    assertNotProviderError(content)
    if (!content && code !== 0) {
      throw new Error(stderr || `qodercli 执行失败（exit ${code}）`)
    }
    yield { delta: '', content, streamEnd: true }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    unregisterKiller()
  }
}

// ========== 统一入口 ==========

/**
 * 非流式 AI 调用（串行队列保证）
 * @param {string} question - 问题/提示词
 * @param {object} [options]
 * @param {string} [options.sessionId] - 会话 ID
 * @param {number} [options.timeout=60000] - 超时(ms)
 * @param {AbortSignal} [options.signal] - 中断信号
 * @returns {Promise<string>} AI 返回的文本
 */
async function callAI(question, options = {}) {
  // qoder 走本机 CLI，冷启动+推理耗时更长，默认超时放宽
  const { timeout = _config.provider === 'qoder' ? 300000 : 60000 } = options

  return new Promise((resolve, reject) => {
    requestQueue = requestQueue.then(async () => {
      _activeLabels.push(options.label || 'call')
      let lastError = null
      try {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const controller = new AbortController()
        const abortTimer = setTimeout(() => {
          console.warn(`[AI][TIMEOUT] callAI 超时 ${timeout}ms`)
          controller.abort()
        }, timeout)

        try {
          let result
          if (_config.provider === 'qoder') {
            result = await callQoder(question, { ...options, signal: controller.signal })
          } else {
            result = await callOpenAI(question, { ...options, signal: controller.signal })
          }
          clearTimeout(abortTimer)
          resolve(result)
          return
        } catch (error) {
          clearTimeout(abortTimer)
          if (controller.signal.aborted) {
            lastError = new Error(`AI 调用超时 (${timeout}ms)`)
          } else {
            lastError = error
          }
          // 判断是否可重试
          if (attempt < MAX_RETRIES && isRetryableError(lastError)) {
            const delay = RETRY_DELAY_BASE * Math.pow(2, attempt)
            console.warn(`[AI][RETRY] ${attempt + 1}/${MAX_RETRIES} 因 ${lastError.code || lastError.message?.slice(0, 60)} 将在 ${delay}ms 后重试...`)
            await sleep(delay)
            continue
          }
          break
        }
      }
      } finally {
        const idx = _activeLabels.lastIndexOf(options.label || 'call')
        if (idx >= 0) _activeLabels.splice(idx, 1)
      }
      reject(lastError)
    }).catch(reject)
  })
}

/**
 * 流式 AI 调用（async generator）
 * @param {string} question - 问题/提示词
 * @param {object} [options]
 * @param {string} [options.sessionId] - 会话 ID
 * @param {number} [options.timeout=300000] - 超时(ms)
 * @param {AbortSignal} [options.signal] - 中断信号
 * @yields {{delta: string, content: string, streamEnd: boolean}}
 */
async function* callAIStream(question, options = {}) {
  let releaseQueue
  const waitForPrevious = requestQueue
  requestQueue = new Promise((resolve) => { releaseQueue = resolve })
  await waitForPrevious
  _activeLabels.push(options.label || 'stream')

  try {
    if (_config.provider === 'qoder') {
      yield* callQoderStream(question, options)
    } else {
      yield* callOpenAIStream(question, options)
    }
  } finally {
    const idx = _activeLabels.lastIndexOf(options.label || 'stream')
    if (idx >= 0) _activeLabels.splice(idx, 1)
    releaseQueue()
  }
}

module.exports = {
  callAI,
  callAIStream,
  stripThinkingTags,
  isAiBusy,
  abortCallsByLabel,
  getConfig: () => ({ ..._config }),
}

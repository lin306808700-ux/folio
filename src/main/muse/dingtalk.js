'use strict'

/**
 * 钉钉群机器人通知模块
 * Muse 完成任务时通过钉钉群消息提醒主人
 */

const https = require('https')
const http = require('http')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const { MUSE_HOME } = require('./config')

// 钉钉配置文件路径
const DINGTALK_CONFIG_FILE = path.join(MUSE_HOME, 'dingtalk.json')

/**
 * 读取钉钉配置
 * 配置文件格式: { "webhook": "https://...", "secret": "SEC..." (可选) }
 */
function loadConfig() {
  try {
    if (!fs.existsSync(DINGTALK_CONFIG_FILE)) return null
    const raw = fs.readFileSync(DINGTALK_CONFIG_FILE, 'utf-8')
    const config = JSON.parse(raw)
    if (!config.webhook) return null
    return config
  } catch (e) {
    console.warn('[DingTalk] 读取配置失败:', e.message)
    return null
  }
}

/**
 * 保存钉钉配置
 */
function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(DINGTALK_CONFIG_FILE), { recursive: true })
    fs.writeFileSync(DINGTALK_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[DingTalk] 配置已保存')
    return true
  } catch (e) {
    console.error('[DingTalk] 保存配置失败:', e.message)
    return false
  }
}

/**
 * 生成加签签名
 */
function generateSign(secret) {
  const timestamp = String(Date.now())
  const stringToSign = `${timestamp}\n${secret}`
  const hmacCode = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64')
  const sign = encodeURIComponent(hmacCode)
  return `&timestamp=${timestamp}&sign=${sign}`
}

/**
 * 发送 HTTP POST 请求（纯 Node.js，不依赖 axios/fetch）
 */
function post(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(url)
    const mod = parsed.protocol === 'https:' ? https : http

    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      let chunks = ''
      res.on('data', (chunk) => { chunks += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(chunks))
        } catch {
          resolve({ errcode: -1, errmsg: chunks })
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(body)
    req.end()
  })
}

/**
 * 发送文本消息
 */
async function sendText(content) {
  const config = loadConfig()
  if (!config) return { success: false, error: '钉钉未配置' }

  let url = config.webhook
  if (config.secret) url += generateSign(config.secret)

  try {
    const result = await post(url, { msgtype: 'text', text: { content } })
    if (result.errcode === 0) {
      console.log('[DingTalk] 文本消息发送成功')
      return { success: true }
    }
    console.warn('[DingTalk] 发送失败:', result.errmsg)
    return { success: false, error: result.errmsg }
  } catch (e) {
    console.error('[DingTalk] 发送异常:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 发送 Markdown 消息
 */
async function sendMarkdown(title, markdownContent) {
  const config = loadConfig()
  if (!config) return { success: false, error: '钉钉未配置' }

  let url = config.webhook
  if (config.secret) url += generateSign(config.secret)

  try {
    const result = await post(url, {
      msgtype: 'markdown',
      markdown: { title, text: markdownContent }
    })
    if (result.errcode === 0) {
      console.log('[DingTalk] Markdown 消息发送成功')
      return { success: true }
    }
    console.warn('[DingTalk] 发送失败:', result.errmsg)
    return { success: false, error: result.errmsg }
  } catch (e) {
    console.error('[DingTalk] 发送异常:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 将任务结果格式化为可读字符串
 */
function formatResult(result) {
  if (!result) return ''
  if (typeof result === 'string') return result
  // 优先取有意义的文本字段
  const text = result.summary || result.output || result.stdout || result.message || result.content
  if (text && typeof text === 'string') return text
  // 降级 JSON，过滤掉大字段
  try {
    return JSON.stringify(result, (key, value) => {
      if (typeof value === 'string' && value.length > 200) return value.slice(0, 200) + '...'
      return value
    })
  } catch {
    return String(result)
  }
}

/**
 * 提取任务结果中最有价值的摘要文本
 * 优先取 result 字段里的纯文本输出，去掉冗余的 JSON 包装
 */
function extractResultSummary(rawResult, maxLength = 400) {
  if (!rawResult) return ''

  let text = rawResult
  // 如果是 JSON 字符串，尝试解析取 result 字段
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text)
      text = parsed.result || parsed.output || parsed.summary || parsed.message || text
    } catch {
      // 不是 JSON，直接用原始字符串
    }
  } else if (typeof text === 'object') {
    text = text.result || text.output || text.summary || text.message || formatResult(text)
  }

  text = String(text).trim()

  // 截断并在末尾加省略号
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + '...'
  }
  return text
}

/**
 * 任务完成通知（Muse 完成任务时调用）
 */
async function notifyTaskCompleted(task) {
  const title = '✅ 小猪完成任务'
  const now = new Date().toLocaleString('zh-CN', { hour12: false })

  const taskName = task.command || task.title || '未命名任务'
  const summary = extractResultSummary(task.result)

  const lines = [
    `### ✅ 任务完成 · ${now}`,
    '',
    `**${taskName}**`,
    '',
  ]

  if (summary) {
    const resultLines = summary.split('\n').filter(l => l.trim())
    const displayLines = resultLines.slice(0, 12)
    lines.push(...displayLines.map(l => `- ${l}`))
    if (resultLines.length > 12) lines.push(`- *(还有 ${resultLines.length - 12} 行省略)*`)
  }

  return sendMarkdown(title, lines.join('\n'))
}

/**
 * 任务失败通知
 */
async function notifyTaskFailed(task, error) {
  const title = '❌ 小猪任务失败'
  const now = new Date().toLocaleString('zh-CN', { hour12: false })

  const taskName = task.command || task.title || '未命名任务'
  const errorLines = String(error).substring(0, 300).split('\n').filter(l => l.trim())

  const markdown = [
    `### ❌ 任务失败 · ${now}`,
    '',
    `**${taskName}**`,
    '',
    ...errorLines.map(l => `- ${l}`)
  ].join('\n')

  return sendMarkdown(title, markdown)
}

/**
 * 通用通知（信件、探索发现等）
 * 注意：消息内容需包含关键词「小猪」才能通过 webhook 安全策略
 */
async function notify(title, content) {
  // 确保内容包含 webhook 关键词
  const safeContent = content.includes('小猪') ? content : `[小猪] ${content}`
  return sendMarkdown(title, safeContent)
}

module.exports = {
  loadConfig,
  saveConfig,
  sendText,
  sendMarkdown,
  notifyTaskCompleted,
  notifyTaskFailed,
  notify,
  DINGTALK_CONFIG_FILE
}

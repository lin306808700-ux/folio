'use strict'

/**
 * Muse ReAct Engine (Node.js 统一版)
 * 替代 Python muse-engine，所有逻辑合并到 Node.js 侧
 * 
 * 核心能力：
 * - ReAct 循环 (Thought → Action → Observation)
 * - 元认知监控 (MetaCognitiveMonitor)
 * - 推理轨迹存储 (ReasoningTraceStore)
 * - 内置工具集 (shell, file ops, git, http, search)
 */

const { execFileSync, spawn } = require('child_process')
const { callAI } = require('../../shared/ai-client')
const tokenMonitor = require('../token-monitor')
const { evaluateCommand, findWorkspaceEscape } = require('../command-policy')
const fs = require('fs')
const path = require('path')
const os = require('os')
const axios = require('axios')

// ========== 配置 ==========
const REACT_MAX_STEPS = 100
const REACT_TOTAL_TIMEOUT = 600000 // 10分钟
const TOOL_TIMEOUT = 30000

// 用户主动中断标志 — 由 requestAbort() 置位，executeReAct 主循环每步检查。
// 用于解决「点击停止后 ReAct 仍在继续执行」的问题。
let _abortRequested = false
function requestAbort() {
  _abortRequested = true
  console.log('[ReAct] 收到用户中断请求，将在当前步骤后停止')
}
function clearAbort() {
  _abortRequested = false
}
function isAbortRequested() {
  return _abortRequested
}
const MAX_LOG_LENGTH = 8000
const CHECKPOINT_DIR = path.join(os.homedir(), '.ai-terminal', 'muse', 'checkpoints')

// ========== 断点恢复 ==========

function commandHash(command) {
  // 简单哈希：取命令前200字符的稳定摘要作为文件名
  const normalized = command.slice(0, 200).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 80)
  let hash = 0
  for (let i = 0; i < command.length; i++) {
    hash = ((hash << 5) - hash + command.charCodeAt(i)) | 0
  }
  return `${normalized}_${Math.abs(hash).toString(36)}`
}

function shouldSaveCheckpoint(steps, error) {
  // 1. 最低步数：至少执行了 3 步才有恢复价值
  if (steps.length < 3) return false

  // 2. 成功率：成功步骤占比 ≥ 40%，否则说明方向就错了
  const successCount = steps.filter(s => s.success).length
  if (successCount / steps.length < 0.4) return false

  // 3. 有文件产物：至少有一次成功的文件写入/编辑，说明有实际产出
  const hasFileOutput = steps.some(s => s.success && ['write_file', 'edit_file', 'apply_patch', 'append_file'].includes(s.actionName))
  if (!hasFileOutput) return false

  // 4. 中断原因：只有超时/超步数值得恢复
  const recoverableErrors = ['执行超时', '超出最大步数', 'AI调用失败', '时间预算不足']
  if (error && !recoverableErrors.some(e => error.includes(e))) return false

  return true
}

function saveCheckpoint(command, steps, workspace, error) {
  if (!shouldSaveCheckpoint(steps, error)) {
    console.log(`[ReAct] 跳过断点保存: 不满足恢复条件 (${steps.length}步, 成功${steps.filter(s => s.success).length}, 原因: ${error})`)
    return
  }
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true })
    const stepsSummary = steps.map(s => {
      const obsPreview = (s.observation || '').slice(0, 150)
      return `Step ${s.step}: [${s.actionName}] ${s.success ? '✓' : '✗'} — ${(s.thought || '').slice(0, 100)} → ${obsPreview}`
    }).join('\n')
    const lastSuccessfulStep = [...steps].reverse().find(s => s.success)
    const checkpoint = {
      command,
      workspace,
      totalSteps: steps.length,
      stepsSummary,
      lastSuccessfulAction: lastSuccessfulStep ? `${lastSuccessfulStep.actionName}: ${(lastSuccessfulStep.observation || '').slice(0, 300)}` : '',
      interruptReason: error || '未知',
      createdAt: new Date().toISOString(),
    }
    const filePath = path.join(CHECKPOINT_DIR, `${commandHash(command)}.json`)
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8')
    console.log(`[ReAct] 断点已保存: ${filePath}`)
  } catch (err) {
    console.warn('[ReAct] 断点保存失败:', err.message)
  }
}

function loadCheckpoint(command) {
  try {
    const filePath = path.join(CHECKPOINT_DIR, `${commandHash(command)}.json`)
    if (!fs.existsSync(filePath)) return null
    const checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    // 超过24小时的断点视为过期
    const age = Date.now() - new Date(checkpoint.createdAt).getTime()
    if (age > 24 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath)
      return null
    }
    return checkpoint
  } catch {
    return null
  }
}

function clearCheckpoint(command) {
  try {
    const filePath = path.join(CHECKPOINT_DIR, `${commandHash(command)}.json`)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

/**
 * Handoff: 生成结构化交接文档
 * 借鉴 Claude Code Handoff skill (Matt Pocock)
 * 任务中断/超时/步数耗尽时，将当前会话压缩为 markdown 文档
 * 包含：任务目的、已完成内容、未完成项、修改的文件、建议的后续步骤
 */
function generateHandoffDoc(command, steps, interruptReason, workspace) {
  const successSteps = steps.filter(s => s.success)
  const failedSteps = steps.filter(s => !s.success)
  const fileOps = steps.filter(s =>
    ['write_file', 'edit_file', 'apply_patch'].includes(s.actionName) && s.success
  )

  // 收集修改的文件
  const modifiedFiles = new Set()
  for (const op of fileOps) {
    const inp = op.actionInput || {}
    if (inp.path) modifiedFiles.add(inp.path)
    if (inp.patch) {
      const matches = inp.patch.match(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)
      if (matches) matches.forEach(m => modifiedFiles.add(m.replace(/^\*\*\* (?:Add|Update|Delete) File: /, '')))
    }
  }

  // 已完成的子任务（从 plan_done 标记推断）
  const completedTasks = steps
    .filter(s => s.actionName === 'plan_check' || s.thought)
    .map(s => s.thought?.slice(0, 100))
    .filter(Boolean)
    .slice(-5)

  const doc = `# Handoff: ${command.slice(0, 80)}

## 任务目的
${command}

## 中断原因
${interruptReason}

## 执行进度
- 总步数: ${steps.length}
- 成功: ${successSteps.length} / 失败: ${failedSteps.length}
- 工作目录: ${workspace}

## 修改的文件 (${modifiedFiles.size})
${[...modifiedFiles].map(f => `- ${f}`).join('\n') || '(无文件修改)'}

## 已完成步骤（最后 5 步）
${successSteps.slice(-5).map(s => `- Step ${s.step}: [${s.actionName}] ${(s.thought || '').slice(0, 80)}`).join('\n') || '(无)'}

## 失败步骤
${failedSteps.slice(-3).map(s => `- Step ${s.step}: [${s.actionName}] ${(s.observation || '').slice(0, 100)}`).join('\n') || '(无)'}

## 建议的后续步骤
1. 检查已修改文件是否符合预期
2. 修复失败步骤中报告的错误
3. 继续未完成的子任务
4. 完成后运行验证测试
`

  // 保存到 ~/.muse/handoffs/
  const handoffDir = path.join(os.homedir(), '.muse', 'handoffs')
  try {
    if (!fs.existsSync(handoffDir)) fs.mkdirSync(handoffDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `handoff-${ts}.md`
    const filePath = path.join(handoffDir, fileName)
    fs.writeFileSync(filePath, doc, 'utf-8')
    console.log(`[ReAct] Handoff 文档已保存: ${filePath}`)
    return { filePath, doc }
  } catch (err) {
    console.warn('[ReAct] Handoff 保存失败:', err.message)
    return { filePath: null, doc }
  }
}

// ========== 工具函数 ==========

function truncateLog(text, maxLength = MAX_LOG_LENGTH) {
  if (!text || text.length <= maxLength) return text || ''
  return `...(已截断前部)...\n${text.slice(-maxLength)}`
}

/**
 * Context Mode: 智能过滤 shell 输出噪音
 * 借鉴 Claude Code Context Mode skill (16.3k stars)
 * 过滤 npm/pip/git/build 进度日志、重复行、警告噪音，只保留关键信息
 * 在 observation 进入 history 前调用，减少 context token 浪费
 */
function filterObservation(text) {
  if (!text || typeof text !== 'string') return text || ''
  const lines = text.split('\n')
  const filtered = []
  let noiseCount = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // npm/yarn/pnpm 进度噪音
    if (/^(npm|yarn|pnpm)\s+(WARN|notice)/i.test(trimmed)) { noiseCount++; continue }
    if (/^\s*[╭╰│┌┐└┘├┤┬┴┼─━┃┆┇┊┋]/.test(trimmed)) { noiseCount++; continue } // npm 框架线
    if (/^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(trimmed)) { noiseCount++; continue } // spinner

    // pip/poetry 噪音
    if (/^(Requirement|Collecting|Downloading|Using cached|Installing|Successfully installed|WARNING:)/i.test(trimmed)
        && !/error|fail|exception/i.test(trimmed)) {
      noiseCount++; continue
    }

    // git 进度
    if (/^(Counting objects|Compressing|Writing objects|Resolving deltas)/.test(trimmed)) { noiseCount++; continue }

    // webpack/vite/tsc build 进度
    if (/^(webpack|BABEL|Babel|typescript|tsc|vite|esbuild)/i.test(trimmed)
        && !/error|fail|warning|warn/i.test(trimmed)) {
      noiseCount++; continue
    }
    if (/\[Babel\]|\[webpack\]/.test(trimmed) && /compiled|generated|built/i.test(trimmed)) { noiseCount++; continue }

    // eslint/prettier 格式化噪音
    if (/^\s*(checking|fixing|formatting)\s.+\.{3}$/i.test(trimmed)) { noiseCount++; continue }

    // 空行压缩（连续空行只留一个）
    if (trimmed === '' && filtered.length > 0 && filtered[filtered.length - 1] === '') { noiseCount++; continue }

    filtered.push(line)
  }

  // 如果过滤掉了大量噪音，添加标记让 AI 知道
  const result = filtered.join('\n')
  if (noiseCount > 5 && result.length < text.length * 0.7) {
    return `(已过滤 ${noiseCount} 行噪音)\n${result}`
  }
  return result
}

/**
 * 对 observation 先过滤噪音再截断
 */
function cleanObservation(text, maxLength = MAX_LOG_LENGTH) {
  return truncateLog(filterObservation(text), maxLength)
}

/**
 * git-commit-writer: 从 steps 历史自动生成 Conventional Commits 消息
 * 借鉴 Claude Code git-commit-writer skill (116 installs, 最热门)
 * 分析最近的文件操作步骤，生成 feat/fix/refactor/docs/chore 类型的提交消息
 */
function generateCommitMessage(steps, command) {
  const fileOps = steps.filter(s =>
    ['write_file', 'edit_file', 'apply_patch'].includes(s.actionName) && s.success
  )
  if (fileOps.length === 0) return `chore: ${command.slice(0, 50)}`

  // 收集所有涉及的文件路径
  const paths = new Set()
  for (const op of fileOps) {
    const inp = op.actionInput || {}
    if (inp.path) paths.add(inp.path)
    if (inp.patch) {
      const matches = inp.patch.match(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)
      if (matches) matches.forEach(m => paths.add(m.replace(/^\*\*\* (?:Add|Update|Delete) File: /, '')))
    }
  }

  // 判断 commit 类型
  const cmd = command.toLowerCase()
  let type = 'feat'
  if (/fix|bug|修复|fix/.test(cmd)) type = 'fix'
  else if (/refactor|重构|重命名/.test(cmd)) type = 'refactor'
  else if (/doc|readme|文档/.test(cmd)) type = 'docs'
  else if (/test|测试/.test(cmd)) type = 'test'
  else if (/deploy|build|ci|部署/.test(cmd)) type = 'chore'

  // 从文件路径推断 scope
  const allPaths = [...paths]
  let scope = ''
  if (allPaths.length === 1) {
    const parts = allPaths[0].split('/')
    scope = parts.length > 1 ? parts[parts.length - 2] : parts[0].replace(/\.(js|ts|tsx|jsx|py|html|css)$/, '')
  } else if (allPaths.length > 1) {
    // 找公共目录
    const firstParts = allPaths[0].split('/')
    for (let i = 0; i < firstParts.length; i++) {
      if (allPaths.every(p => p.split('/')[i] === firstParts[i])) {
        scope = firstParts[i]
      } else break
    }
  }

  // 简短描述
  const desc = command.slice(0, 60).replace(/\n/g, ' ').trim()
  const scopeStr = scope ? `(${scope})` : ''
  const fileList = allPaths.length <= 3 ? '' : ` [${allPaths.length} files]`

  return `${type}${scopeStr}: ${desc}${fileList}`
}

let _cachedShellEnv = null
let _cachedMergedEnv = null

function loadUserShellEnv() {
  if (_cachedShellEnv) return _cachedShellEnv
  const home = os.homedir()
  const rcFiles = ['.zprofile', '.zshrc', '.bash_profile', '.bashrc']
  const envMap = {}

  for (const rcFile of rcFiles) {
    const rcPath = path.join(home, rcFile)
    if (!fs.existsSync(rcPath)) continue
    try {
      const content = fs.readFileSync(rcPath, 'utf-8')
      const exportPattern = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm
      let match
      while ((match = exportPattern.exec(content)) !== null) {
        let value = match[2].trim()
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1)
        }
        value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
          return envMap[name] || process.env[name] || ''
        })
        envMap[match[1]] = value
      }
    } catch {}
  }
  _cachedShellEnv = envMap
  return envMap
}

function getMergedEnv() {
  if (_cachedMergedEnv) return _cachedMergedEnv
  _cachedMergedEnv = { ...process.env, ...loadUserShellEnv() }
  return _cachedMergedEnv
}

// ========== 内置工具集 ==========

function resolveWorkspacePath(workspace, targetPath = '.') {
  const workspacePath = path.resolve(workspace)
  const requestedPath = targetPath || '.'
  const expanded = requestedPath.startsWith('~')
    ? requestedPath.replace(/^~(?=$|\/)/, os.homedir())
    : requestedPath
  const resolved = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspacePath, expanded)

  if (resolved !== workspacePath && !resolved.startsWith(workspacePath + path.sep)) {
    throw new Error(`路径超出工作区范围: ${resolved}`)
  }

  let existingPath = resolved
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) break
    existingPath = parent
  }

  const realWorkspace = fs.realpathSync(workspacePath)
  const realExisting = fs.realpathSync(existingPath)
  if (realExisting !== realWorkspace && !realExisting.startsWith(realWorkspace + path.sep)) {
    throw new Error(`路径通过符号链接超出工作区范围: ${resolved}`)
  }
  return resolved
}

async function toolShell(input, cwd, toolTimeout) {
  const cmd = input.cmd || ''
  let workDir
  try {
    workDir = resolveWorkspacePath(cwd, input.cwd || '.')
  } catch (err) {
    return `命令执行错误: ${err.message}`
  }
  const timeout = toolTimeout || TOOL_TIMEOUT
  return new Promise((resolve) => {
    let resolved = false
    const finish = (result) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(result)
    }

    const child = spawn('bash', ['-c', cmd], {
      cwd: workDir,
      env: getMergedEnv()
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { if (!resolved) stdout += d.toString() })
    child.stderr.on('data', d => { if (!resolved) stderr += d.toString() })
    child.on('close', (code) => {
      if (code === 0) {
        finish(truncateLog(stdout) || '(命令执行成功，无输出)')
      } else {
        finish(`退出码 ${code}\nstdout: ${truncateLog(stdout)}\nstderr: ${truncateLog(stderr)}`)
      }
    })
    child.on('error', (err) => {
      finish(`命令执行错误: ${err.message}`)
    })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(`命令超时 (>${timeout / 1000}s)`)
    }, timeout)
  })
}

async function toolReadFile(input, cwd) {
  const filePath = input.path || ''
  try {
    const expanded = resolveWorkspacePath(cwd, filePath)
    if (!fs.existsSync(expanded)) return `文件不存在: ${filePath} (解析为: ${expanded})`
    let content = fs.readFileSync(expanded, 'utf-8')
    const startLine = input.start_line
    const endLine = input.end_line
    if (startLine || endLine) {
      const lines = content.split('\n')
      const total = lines.length
      const s = Math.max(0, (startLine || 1) - 1)
      const e = Math.min(total, endLine || total)
      content = `[行 ${s + 1}-${e}/${total}]\n` + lines.slice(s, e).join('\n')
    }
    return truncateLog(content)
  } catch (err) {
    return `读取失败: ${err.message}`
  }
}

async function toolEditFile(input, cwd) {
  const filePath = input.path || ''
  const oldString = input.old_string
  const newString = input.new_string

  if (oldString === undefined || oldString === null || oldString === '') {
    return '编辑失败: old_string 不能为空，请提供要替换的原始文本。'
  }
  if (newString === undefined || newString === null) {
    return '编辑失败: 缺少 new_string 参数。'
  }

  try {
    const expanded = resolveWorkspacePath(cwd, filePath)
    if (!fs.existsSync(expanded)) return `文件不存在: ${filePath} (解析为: ${expanded})`
    const content = fs.readFileSync(expanded, 'utf-8')
    const occurrences = content.split(oldString).length - 1
    if (occurrences === 0) return '未找到匹配内容，请用 read_file 确认当前文件内容后重试。'
    if (occurrences > 1) return `找到 ${occurrences} 处匹配，请提供更精确的 old_string 以确保唯一匹配。`
    const newContent = content.replace(oldString, newString)
    fs.writeFileSync(expanded, newContent, 'utf-8')
    return `已编辑 ${expanded}（精确替换1处）`
  } catch (err) {
    return `编辑失败: ${err.message}`
  }
}

async function toolWriteFile(input, cwd) {
  const filePath = input.path || ''
  const content = input.content || ''
  try {
    const expanded = resolveWorkspacePath(cwd, filePath)
    const dir = path.dirname(expanded)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(expanded, content, 'utf-8')
    // 写后验证
    if (!fs.existsSync(expanded)) {
      return `写入失败: 文件写入后未能在磁盘找到 ${expanded}`
    }
    const stat = fs.statSync(expanded)
    return `已写入 ${expanded} (${stat.size} bytes)`
  } catch (err) {
    return `写入失败: ${err.message}`
  }
}

/**
 * 追加写入文件 — 用于大文件分块写入
 * 解决 LLM 输出 token 上限导致 write_file 截断的问题
 * 策略：write_file 写第一块 → append_file 追加后续块
 */
async function toolAppendFile(input, cwd) {
  const filePath = input.path || ''
  const content = input.content || ''
  const mode = input.mode || 'append' // append | prepend
  try {
    const expanded = resolveWorkspacePath(cwd, filePath)
    if (!fs.existsSync(expanded)) {
      return `追加失败: 文件不存在 ${expanded}（追加模式需要文件已存在，首次写入请用 write_file）`
    }
    const existing = fs.readFileSync(expanded, 'utf-8')
    const newContent = mode === 'prepend' ? content + existing : existing + content
    fs.writeFileSync(expanded, newContent, 'utf-8')
    const stat = fs.statSync(expanded)
    return `已追加到 ${expanded} (当前总大小: ${stat.size} bytes, 本次追加: ${content.length} 字符)`
  } catch (err) {
    return `追加失败: ${err.message}`
  }
}

async function toolListDir(input, cwd) {
  const dirPath = input.path || cwd
  const depth = Math.min(Math.max(input.depth || 1, 1), 3)

  try {
    const expanded = resolveWorkspacePath(cwd, dirPath === cwd ? '.' : dirPath)
    if (!fs.existsSync(expanded)) return `目录不存在: ${dirPath}`
    const entries = []
    function walk(current, currentDepth, prefix) {
      if (currentDepth > depth || entries.length >= 200) return
      let items
      try { items = fs.readdirSync(current) } catch { return }
      items.sort().forEach(name => {
        if (name.startsWith('.')) return
        if (entries.length >= 200) return
        const fullPath = path.join(current, name)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.isDirectory()) {
            entries.push(`${prefix}${name}/`)
            if (currentDepth < depth) walk(fullPath, currentDepth + 1, prefix + '  ')
          } else {
            entries.push(`${prefix}${name} (${stat.size}B)`)
          }
        } catch {}
      })
    }
    walk(expanded, 1, '')
    return entries.join('\n') || '(空目录)'
  } catch (err) {
    return `列目录失败: ${err.message}`
  }
}

async function toolSearchFile(input, cwd, toolTimeout) {
  const pattern = input.pattern || ''
  const searchPath = input.path || cwd
  const maxResults = Math.min(input.max_results || 20, 50)
  const timeout = toolTimeout || TOOL_TIMEOUT

  let expanded
  try {
    expanded = resolveWorkspacePath(cwd, searchPath === cwd ? '.' : searchPath)
  } catch (err) {
    return `搜索失败: ${err.message}`
  }

  // 禁止在 home 目录或根目录直接搜索
  const dangerousPaths = [os.homedir(), '/', '/Users', '/home', '/tmp']
  if (dangerousPaths.includes(expanded)) {
    return `搜索失败: 禁止在 "${expanded}" 根级目录搜索，范围过大。请指定更具体的子目录。`
  }

  // 验证正则有效性
  try { new RegExp(pattern) } catch (regexErr) {
    return `搜索失败: 正则表达式无效 — ${regexErr.message}`
  }

  // 使用 grep 异步搜索，避免同步 I/O 阻塞事件循环
  return new Promise((resolve) => {
    let resolved = false
    const finish = (result) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(result)
    }

    const excludeDirs = ['.git', 'node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build', 'coverage', '.next', '.nuxt', 'target', 'vendor', '.cache']
    const excludeArgs = excludeDirs.flatMap(d => ['--exclude-dir', d])
    const grepArgs = ['-r', '-i', '-n', '--include=*', '-m', String(maxResults), ...excludeArgs, pattern, expanded]

    const child = spawn('grep', grepArgs, { cwd })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { if (!resolved) stdout += d.toString() })
    child.stderr.on('data', d => { if (!resolved) stderr += d.toString() })
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        // code 1 = no matches
        const lines = stdout.trim().split('\n').filter(Boolean).slice(0, maxResults)
        const formatted = lines.map(l => l.length > 300 ? l.slice(0, 300) + '...' : l)
        finish(formatted.length > 0 ? formatted.join('\n') : '未找到匹配结果')
      } else {
        finish(`搜索失败: ${(stderr || '').slice(0, 300)}`)
      }
    })
    child.on('error', (err) => finish(`搜索失败: ${err.message}`))
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(`搜索超时 (>${timeout / 1000}s)`)
    }, timeout)
  })
}

async function toolHttpRequest(input) {
  const method = (input.method || 'GET').toUpperCase()
  const url = input.url || ''
  const headers = input.headers || {}
  const body = input.body || null

  try {
    const response = await axios({
      method, url, headers,
      data: body,
      timeout: TOOL_TIMEOUT,
      validateStatus: () => true
    })
    return `HTTP ${response.status}\n${truncateLog(typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2))}`
  } catch (err) {
    return `HTTP 请求失败: ${err.message}`
  }
}

async function toolGit(input, cwd) {
  const action = input.action || ''
  const message = input.message || 'auto checkpoint'
  const ref = input.ref || 'HEAD~1'

  function runGit(args) {
    return new Promise((resolve) => {
      const child = spawn('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d.toString() })
      child.stderr.on('data', d => { stderr += d.toString() })
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          resolve(`git错误: ${(stderr || stdout || '').slice(0, 300)}`)
        }
      })
      child.on('error', (err) => {
        resolve(`git错误: ${err.message}`)
      })
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve('git错误: 操作超时 (>10s)')
      }, 10000)
    })
  }

  // 确保 .gitignore 存在且包含常见大目录排除
  const gitignorePath = path.join(cwd, '.gitignore')
  const requiredIgnores = ['node_modules/', '.git/', 'dist/', 'build/', '__pycache__/', 'venv/', '.venv/', '*.pyc', '.DS_Store', 'coverage/', '.next/', '.nuxt/', 'target/', 'vendor/']
  try {
    let existing = ''
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf-8')
    }
    const missing = requiredIgnores.filter(ig => !existing.includes(ig.replace('/', '')))
    if (missing.length > 0) {
      const addition = (existing ? '\n' : '') + '# Auto-added by Muse\n' + missing.join('\n') + '\n'
      fs.appendFileSync(gitignorePath, addition, 'utf-8')
    }
  } catch {}

  // 目录过大保护：超过阈值时跳过 checkpoint
  const MAX_TRACKED_FILES = 5000
  async function isRepoTooLarge() {
    const result = await runGit(['ls-files', '--others', '--exclude-standard'])
    if (result.startsWith('git错误')) return false
    const fileCount = result.split('\n').filter(Boolean).length
    return fileCount > MAX_TRACKED_FILES
  }

  // 确保 repo 存在
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    await runGit(['init'])
    await runGit(['config', 'user.email', 'muse@local'])
    await runGit(['config', 'user.name', 'Muse Agent'])
    await runGit(['add', '-A'])
    await runGit(['commit', '-m', 'muse: initial', '--allow-empty'])
  }

  if (action === 'checkpoint') {
    // 未追踪文件过多时跳过，避免阻塞
    if (await isRepoTooLarge()) {
      return '(跳过 checkpoint: 未追踪文件超过 5000 个，请检查 .gitignore)'
    }
    await runGit(['add', '-A'])
    const status = await runGit(['status', '--porcelain'])
    if (!status || status.startsWith('git错误')) return '(无变更)'
    await runGit(['commit', '-m', `muse: ${message}`, '--allow-empty'])
    return await runGit(['rev-parse', '--short', 'HEAD'])
  } else if (action === 'diff') {
    return truncateLog(await runGit(['diff', ref, '--stat']), 3000)
  } else if (action === 'log') {
    return await runGit(['log', '--oneline', `-${input.count || 10}`])
  } else if (action === 'rollback') {
    return await runGit(['reset', '--hard', ref])
  }
  return `未知 git action: ${action}`
}

async function toolPythonEval(input, cwd, toolTimeout) {
  const code = input.code || ''
  const timeout = toolTimeout || TOOL_TIMEOUT
  const tmpFile = path.join(os.tmpdir(), `muse_eval_${Date.now()}.py`)
  let workDir
  try {
    workDir = resolveWorkspacePath(cwd, input.cwd || '.')
  } catch (err) {
    return `Python 执行错误: ${err.message}`
  }
  fs.writeFileSync(tmpFile, code, 'utf-8')

  return new Promise((resolve) => {
    let resolved = false
    const finish = (result) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      try { fs.unlinkSync(tmpFile) } catch {}
      resolve(result)
    }

    const child = spawn('python3', [tmpFile], {
      cwd: workDir,
      env: getMergedEnv()
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { if (!resolved) stdout += d.toString() })
    child.stderr.on('data', d => { if (!resolved) stderr += d.toString() })
    child.on('close', (code) => {
      if (code === 0) {
        finish(truncateLog(stdout) || '(执行成功，无输出)')
      } else {
        finish(`执行失败\nstdout: ${truncateLog(stdout)}\nstderr: ${truncateLog(stderr)}`)
      }
    })
    child.on('error', (err) => {
      finish(`Python 执行错误: ${err.message}`)
    })
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish(`Python 执行超时 (>${timeout / 1000}s)`)
    }, timeout)
  })
}

// ========== apply_patch：原子性多文件编辑 ==========

/**
 * 解析并应用 patch 格式的文件修改。
 *
 * 支持三种操作：
 *   *** Add File: <path>     — 新建文件
 *   *** Update File: <path>  — 修改已有文件（基于上下文行定位）
 *   *** Delete File: <path>  — 删除文件
 *
 * Update File 使用类 unified diff hunk：
 *   context line（无前缀）— 必须与原文匹配，用于定位
 *   -old line             — 要删除的行
 *   +new line             — 要插入的行
 *   @@                     — hunk 分隔符（可选，用于同一文件多段修改）
 *
 * 示例（一次修改两个文件）：
 *   *** Begin Patch
 *   *** Add File: src/utils.js
 *   +export function util() { return 42 }
 *   *** End File
 *   *** Update File: src/index.js
 *   import { foo } from './old'
 *   -import { foo } from './old'
 *   +import { util } from './utils'
 *   *** End File
 *   *** End Patch
 */

function parsePatch(patchText) {
  const lines = patchText.split('\n')
  const ops = []
  let i = 0

  // 跳过直到 *** Begin Patch
  while (i < lines.length && !lines[i].startsWith('*** Begin Patch')) i++
  if (i >= lines.length) return { error: '未找到 *** Begin Patch 标记' }
  i++

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('*** End Patch')) break
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length).trim()
      i++
      const contentLines = []
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        // Add File 中每行以 + 开头，去掉 + 前缀
        if (lines[i].startsWith('+')) {
          contentLines.push(lines[i].slice(1))
        } else {
          contentLines.push(lines[i])
        }
        i++
      }
      // 末尾换行处理：如果最后一个 + 后面是 *** End File，不加额外换行
      // 检查是否有 *** End File 标记
      if (i < lines.length && lines[i].startsWith('*** End File')) i++
      ops.push({ type: 'add', path: filePath, content: contentLines.join('\n') })
    } else if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length).trim()
      i++
      const hunks = []
      let currentHunk = []
      while (i < lines.length && !lines[i].startsWith('*** End File') && !lines[i].startsWith('*** End Patch')) {
        if (lines[i] === '@@') {
          if (currentHunk.length > 0) hunks.push(currentHunk)
          currentHunk = []
          i++
          continue
        }
        currentHunk.push(lines[i])
        i++
      }
      if (currentHunk.length > 0) hunks.push(currentHunk)
      if (i < lines.length && lines[i].startsWith('*** End File')) i++
      ops.push({ type: 'update', path: filePath, hunks })
    } else if (line.startsWith('*** Delete File: ')) {
      const filePath = line.slice('*** Delete File: '.length).trim()
      i++
      ops.push({ type: 'delete', path: filePath })
    } else {
      i++
    }
  }

  return { ops }
}

/**
 * 在原文中查找 hunk 的最佳匹配位置。
 * 使用 context + removal 行作为搜索锚点，返回匹配起始索引。
 */
function findHunkMatch(originalLines, hunk) {
  // 提取锚点行（context 行和 - 行，不含 + 行）
  const anchorLines = hunk
    .filter(l => !l.startsWith('+'))
    .map(l => l.startsWith('-') ? l.slice(1) : l)

  if (anchorLines.length === 0) {
    // 纯插入（只有 + 行），插入到文件末尾
    return { index: originalLines.length, anchor: [] }
  }

  // 在原文中查找第一个完全匹配的位置
  for (let start = 0; start <= originalLines.length - anchorLines.length; start++) {
    let match = true
    for (let j = 0; j < anchorLines.length; j++) {
      if (originalLines[start + j] !== anchorLines[j]) {
        match = false
        break
      }
    }
    if (match) {
      return { index: start, anchor: anchorLines }
    }
  }

  // 模糊匹配：忽略首尾空白差异
  for (let start = 0; start <= originalLines.length - anchorLines.length; start++) {
    let match = true
    for (let j = 0; j < anchorLines.length; j++) {
      if (originalLines[start + j].trim() !== anchorLines[j].trim()) {
        match = false
        break
      }
    }
    if (match) {
      return { index: start, anchor: anchorLines }
    }
  }

  return { index: -1, anchor: anchorLines }
}

/**
 * 对单个文件应用一个 hunk。
 * 返回 { success, newLines, error }
 */
function applyHunk(originalLines, hunk) {
  const { index, anchor } = findHunkMatch(originalLines, hunk)
  if (index === -1) {
    return {
      success: false,
      error: `无法定位修改位置。锚点行:\n${anchor.map(l => '  ' + l).join('\n')}`,
    }
  }

  // 构建 hunk 对应的新行序列
  let originalIdx = index

  // 保留 hunk 之前的原文
  const before = originalLines.slice(0, index)

  // 处理 hunk 中的每一行
  const processed = []
  for (const hunkLine of hunk) {
    if (hunkLine.startsWith('+')) {
      processed.push(hunkLine.slice(1))
    } else if (hunkLine.startsWith('-')) {
      // 跳过原文中对应的行（删除）
      originalIdx++
    } else {
      // context 行，保留原文
      processed.push(hunkLine)
      originalIdx++
    }
  }

  // 保留 hunk 之后的原文
  const after = originalLines.slice(originalIdx)

  return {
    success: true,
    newLines: [...before, ...processed, ...after],
  }
}

async function toolApplyPatch(input, cwd) {
  const patchText = input.patch || ''
  if (!patchText.trim()) {
    return '编辑失败: patch 内容为空，请提供 *** Begin Patch ... *** End Patch 格式的补丁。'
  }

  const { ops, error: parseError } = parsePatch(patchText)
  if (parseError) return `编辑失败: ${parseError}`
  if (!ops || ops.length === 0) return '编辑失败: 未解析到任何文件操作。'

  // 预检查：解析所有路径，收集结果
  const results = []
  const appliedFiles = []
  let resolvedOps
  try {
    resolvedOps = ops.map(op => ({
      ...op,
      resolvedPath: resolveWorkspacePath(cwd, op.path),
    }))
  } catch (err) {
    return `原子性失败 — 路径预检未通过: ${err.message}\n未应用任何修改。`
  }

  for (const op of resolvedOps) {
    const expanded = op.resolvedPath

    if (op.type === 'add') {
      try {
        if (fs.existsSync(expanded)) {
          results.push(`⚠ 文件已存在，将被覆盖: ${op.path}`)
        }
        const dir = path.dirname(expanded)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(expanded, op.content, 'utf-8')
        appliedFiles.push(op.path)
        results.push(`✓ 新建 ${op.path} (${op.content.length} bytes)`)
      } catch (err) {
        return `原子性失败 — 创建文件 ${op.path} 时出错: ${err.message}\n已应用的修改: ${appliedFiles.join(', ') || '无'}\n请用 git rollback 回滚。`
      }
    } else if (op.type === 'update') {
      try {
        if (!fs.existsSync(expanded)) {
          return `原子性失败 — 文件不存在: ${op.path}\n已应用的修改: ${appliedFiles.join(', ') || '无'}\n请用 git rollback 回滚。`
        }
        const content = fs.readFileSync(expanded, 'utf-8')
        let lines = content.split('\n')

        for (let hi = 0; hi < op.hunks.length; hi++) {
          const hunkResult = applyHunk(lines, op.hunks[hi])
          if (!hunkResult.success) {
            return `原子性失败 — 修改 ${op.path} 第 ${hi + 1} 段时出错: ${hunkResult.error}\n已应用的修改: ${appliedFiles.join(', ') || '无'}\n请用 git rollback 回滚。`
          }
          lines = hunkResult.newLines
        }

        fs.writeFileSync(expanded, lines.join('\n'), 'utf-8')
        appliedFiles.push(op.path)
        const hunkCount = op.hunks.length
        results.push(`✓ 更新 ${op.path} (${hunkCount} 段修改)`)
      } catch (err) {
        return `原子性失败 — 修改文件 ${op.path} 时出错: ${err.message}\n已应用的修改: ${appliedFiles.join(', ') || '无'}\n请用 git rollback 回滚。`
      }
    } else if (op.type === 'delete') {
      try {
        if (!fs.existsSync(expanded)) {
          results.push(`⚠ 文件不存在，跳过删除: ${op.path}`)
          continue
        }
        fs.unlinkSync(expanded)
        appliedFiles.push(op.path)
        results.push(`✓ 删除 ${op.path}`)
      } catch (err) {
        return `原子性失败 — 删除文件 ${op.path} 时出错: ${err.message}\n已应用的修改: ${appliedFiles.join(', ') || '无'}\n请用 git rollback 回滚。`
      }
    }
  }

  return `已应用 ${appliedFiles.length} 个文件操作:\n${results.join('\n')}`
}

// 工具注册表
const TOOLS = {
  shell: toolShell,
  read_file: toolReadFile,
  edit_file: toolEditFile,
  write_file: toolWriteFile,
  append_file: toolAppendFile,
  apply_patch: toolApplyPatch,
  list_dir: toolListDir,
  search_file: toolSearchFile,
  http_request: toolHttpRequest,
  git: toolGit,
  python_eval: toolPythonEval,
}

// 失败关键词集合（用于判断工具执行是否成功）
const FAILURE_PREFIXES = [
  '错误：', '执行失败', '文件不存在:', '目录不存在:',
  '读取失败:', '编辑失败:', '写入失败:', '列目录失败:',
  '搜索失败:', 'HTTP 请求失败:', '命令执行错误:',
  '命令超时', 'Python 执行错误:', 'Python 执行超时',
  'git错误:', '未知 git action:', '工具执行异常:',
  '未找到匹配内容', '退出码 '
]

function isToolFailure(observation) {
  if (!observation) return true
  for (const prefix of FAILURE_PREFIXES) {
    if (observation.startsWith(prefix)) return true
  }
  return false
}

async function executeTool(actionName, actionInput, cwd, toolTimeout) {
  const toolFn = TOOLS[actionName]
  if (!toolFn) return `错误：未知工具 '${actionName}'，可用: ${Object.keys(TOOLS).join(', ')}`
  try {
    return await toolFn(actionInput, cwd, toolTimeout)
  } catch (err) {
    return `工具执行异常: ${err.message}`
  }
}

async function authorizeToolAction(actionName, actionInput, onNeedConfirm, step, workspace) {
  if (actionName !== 'shell') return { allowed: true, needsAuth: false }

  const command = (actionInput && actionInput.cmd) || ''
  const policy = evaluateCommand(command, { workspace, lang: 'bash' })
  const workspaceEscape = policy.workspaceEscape
  const safety = {
    needsAuth: policy.requiresConfirmation,
    riskLevel: policy.riskLevel,
    reason: policy.reason,
    details: { hardAnalysis: policy.analysis, workspaceEscape },
  }
  if (!policy.requiresConfirmation) return { allowed: true, needsAuth: false, safety }

  const authorizationReason = policy.reason

  if (typeof onNeedConfirm !== 'function') {
    return { allowed: false, needsAuth: true, safety, workspaceEscape, authorizationReason, reason: '缺少用户授权通道' }
  }

  const allowed = await onNeedConfirm({
    step,
    command,
    riskLevel: safety.riskLevel,
    reason: authorizationReason,
    details: { ...safety.details, workspaceEscape },
  })
  return { allowed: !!allowed, needsAuth: true, safety, workspaceEscape, authorizationReason, reason: allowed ? '' : '用户拒绝授权' }
}

// ========== 元认知监控层 ==========

class MetaCognitiveMonitor {
  constructor(command, maxSteps) {
    this.command = command
    this.maxSteps = maxSteps
    this.actionHistory = []
    this.failureStreak = 0
    this.totalFailures = 0
    this.repeatedActions = {}
    this.signals = []
  }

  _signature(actionName, actionInput) {
    const keys = Object.keys(actionInput || {}).slice(0, 3).sort()
    const summary = keys.map(k => `${k}=${String(actionInput[k]).slice(0, 30)}`).join('|')
    return `${actionName}:${summary}`
  }

  observe(stepNum, latestSuccess, actionName, actionInput, elapsedMs) {
    this.signals = []
    const sig = this._signature(actionName, actionInput)
    this.actionHistory.push(sig)
    this.repeatedActions[sig] = (this.repeatedActions[sig] || 0) + 1

    // 循环检测
    if (this.repeatedActions[sig] >= 3) {
      this.signals.push(
        `⚠️ 循环检测：'${actionName}' 已用相似参数调用 ${this.repeatedActions[sig]} 次，请切换策略。`
      )
    }

    if (this.actionHistory.length >= 3) {
      const recent = this.actionHistory.slice(-3).map(s => s.split(':')[0])
      if (new Set(recent).size === 1 && !['read_file', 'search_file'].includes(recent[0])) {
        this.signals.push(`⚠️ 策略单一：最近3步都在使用 '${recent[0]}'，考虑组合其他工具。`)
      }
    }

    // 置信度追踪
    if (latestSuccess) {
      this.failureStreak = 0
    } else {
      this.failureStreak++
      this.totalFailures++
    }
    if (this.failureStreak >= 3) {
      this.signals.push(`⚠️ 连续失败 ${this.failureStreak} 次，当前策略可能无效。建议换一种方式。`)
    } else if (this.failureStreak === 2) {
      this.signals.push('⚠️ 连续2次失败，请仔细分析错误原因后再行动。')
    }

    // 进度检查
    const ratio = stepNum / this.maxSteps
    if (ratio > 0.6 && this.totalFailures > stepNum * 0.5) {
      this.signals.push(`⚠️ 已用 ${stepNum}/${this.maxSteps} 步，失败率>50%。建议简化目标。`)
    }
    if (ratio > 0.7 && this.failureStreak === 0) {
      this.signals.push(`📍 已用 ${stepNum}/${this.maxSteps} 步，请评估是否可以收敛。`)
    }

    return this.signals
  }

  getInjectionText() {
    if (!this.signals.length) return ''
    return '\n\n【元认知监控信号 — 请在 thought 中回应】\n' + this.signals.join('\n')
  }
}

// ========== 推理轨迹存储 ==========

class ReasoningTraceStore {
  constructor() {
    this.storePath = path.join(os.homedir(), '.muse', 'reasoning-traces.json')
    this._cache = null // 内存缓存，避免每次读磁盘
    const dir = path.dirname(this.storePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  _load() {
    if (this._cache) return this._cache
    try {
      if (fs.existsSync(this.storePath)) {
        this._cache = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'))
        return this._cache
      }
    } catch {}
    this._cache = []
    return this._cache
  }

  _save(traces) {
    this._cache = traces
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(traces, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[TraceStore] 保存失败:', err.message)
    }
  }

  saveTrace({ command, steps, success, totalSteps, durationMs, metacogSignals = 0 }) {
    const traces = this._load()

    // 提取任务特征
    const features = new Set()
    const words = command.toLowerCase().split(/[\s,，。、；;：:!！?？()\[\]{}/\\|]+/)
    words.forEach(w => { if (w.length >= 2) features.add(w.slice(0, 20)) })
    steps.forEach(s => { if (s.actionName) features.add(s.actionName) })

    // 提取障碍
    const obstacles = steps
      .filter(s => !s.success)
      .slice(0, 10)
      .map((s, i) => {
        const next = steps[steps.indexOf(s) + 1]
        return {
          description: (s.observation || '').slice(0, 150),
          action: s.actionName || '',
          resolution: next?.success ? (next.thought || next.actionName || '').slice(0, 100) : ''
        }
      })

    // 计算整合强度
    const successRate = steps.length > 0
      ? steps.filter(s => s.success).length / steps.length
      : (success ? 1 : 0)
    const efficiency = Math.max(0, 1 - totalSteps / 20)
    const noAnomaly = Math.max(0, 1 - metacogSignals / 5)
    const integrationScore = Math.round((
      successRate * 0.4 + (success ? 1 : 0) * 0.3 + efficiency * 0.2 + noAnomaly * 0.1
    ) * 1000) / 1000

    const trace = {
      id: String(Date.now()),
      command: command.slice(0, 500),
      taskFeatures: [...features].slice(0, 30),
      steps: steps.slice(0, 30).map(s => ({
        thought: (s.thought || '').slice(0, 150),
        action: s.actionName || '',
        success: !!s.success
      })),
      obstacles,
      integrationScore,
      success,
      totalSteps,
      duration: Math.round(durationMs / 1000),
      metacogSignals,
      created_at: new Date().toISOString()
    }

    traces.unshift(trace)
    if (traces.length > 100) traces.length = 100
    this._save(traces)
    console.log(`[TraceStore] 保存轨迹: success=${success}, score=${integrationScore}, steps=${totalSteps}`)
    return trace
  }

  search(keyword, limit = 5) {
    if (!keyword) return []
    const keywords = keyword.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
    if (!keywords.length) return []

    const traces = this._load()
    const scored = []
    for (const trace of traces) {
      const searchable = [trace.command, ...(trace.taskFeatures || [])].join(' ').toLowerCase()
      const matchCount = keywords.filter(kw => searchable.includes(kw)).length
      if (!matchCount) continue
      const relevance = matchCount / keywords.length
      const successBonus = trace.success ? 1 : 0.3
      const score = relevance * 0.4 + (trace.integrationScore || 0) * 0.3 + successBonus * 0.3
      scored.push({ ...trace, _score: Math.round(score * 1000) / 1000 })
    }
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  }
}

const traceStore = new ReasoningTraceStore()

// ========== Prompt 构建 ==========

const TOOLS_SCHEMA = `
可用工具（Action 名称 → 参数 JSON）：

1. shell — 执行 shell 命令
   {"cmd": "命令字符串", "cwd": "工作目录（可选）"}

2. http_request — 发送 HTTP 请求
   {"method": "GET|POST|PUT|DELETE", "url": "完整URL", "headers": {}, "body": "请求体（可选）"}

3. read_file — 读取文件内容
   {"path": "文件路径", "start_line": 起始行(可选), "end_line": 结束行(可选)}

4. apply_patch — 原子性多文件编辑（首选！一次修改多个文件）
   {"patch": "补丁文本"}

   补丁格式：
   *** Begin Patch
   *** Add File: 新文件路径
   +文件内容行
   *** End File
   *** Update File: 已有文件路径
   上下文行（无前缀，用于定位）
   -要删除的行
   +要新增的行
   @@
   上下文行
   -旧行
   +新行
   *** End File
   *** Delete File: 要删除的文件路径
   *** End Patch

5. edit_file — 精确编辑单个文件（仅小范围修改时用）
   {"path": "文件路径", "old_string": "要替换的原文（必须唯一匹配）", "new_string": "替换后内容"}

6. write_file — 写入文件（整文件覆盖，仅用于新建）
   {"path": "文件路径", "content": "文件内容"}

6.5. append_file — 追加内容到已有文件（大文件分块写入专用）
   {"path": "文件路径", "content": "追加内容", "mode": "append(默认)|prepend"}
   ⚠️ 单次响应中文件内容超过 ~200 行时，必须用 write_file + append_file 分块写入，否则会被截断

7. git — 本地 Git 版本管理
   {"action": "checkpoint|diff|log|rollback", "message": "提交信息", "ref": "目标commit", "count": 10}

8. python_eval — 执行 Python 代码片段
   {"code": "Python代码", "cwd": "工作目录（可选）"}

9. list_dir — 列出目录内容
   {"path": "目录路径", "depth": 递归深度(默认1,最大3)}

10. search_file — 在文件中搜索文本（正则）
   {"pattern": "搜索正则", "path": "搜索目录或文件", "max_results": 20}
`

// ========== 系统级编码规范（借鉴 Claude Code 生态最佳实践） ==========

/**
 * Karpathy 四条编码铁律（Encoded Preference）
 * 来源：Andrej Karpathy 公开的 LLM 编码观察，144k stars
 * 始终注入，不可关闭
 */
const KARPATHY_RULES = `## 编码铁律
1. 先想再写：显式声明假设。多种理解时列出选项让主人选，不要默默选一个就跑。
2. 极简主义：最小代码解决问题。不加超出要求的功能和抽象。200行能50行就重写。
3. 外科手术式修改：只碰必须碰的。不改相邻代码或格式。匹配现有风格即使你觉得有更好的。发现无关死代码只报告不删除。
4. 目标驱动：定义成功标准并循环验证。“加校验”→“写失败测试→通过测试”。`

/**
 * code-simplifier：final 前自检规则（Encoded Preference）
 * 来源：Anthropic 官方内部插件
 * 在输出 final 前强制自检，只提升可读性不改行为
 */
const CODE_SIMPLIFIER_CHECK = `## 代码清理（final 前自检）
- 去重复：相同逻辑出现2次以上→提取函数
- 扁平化：超过3层嵌套→提前返回/提取子函数
- 命名：变量名自解释，禁用 tmp/data/val/info 等无意义名
- 绝不改行为：只提升可读性，不改变逻辑`

/**
 * frontend-design：反 AI slop 设计规范（Encoded Preference）
 * 来源：Anthropic 官方 Skill，110k+ weekly installs
 * 检测到前端/UI/网页任务时自动注入
 */
const FRONTEND_DESIGN_GUIDE = `## 前端设计规范（生成 UI/网页时必须遵守）
### 禁止 AI slop
- 禁用字体：Inter, Roboto, Arial, Space Grotesk, system-ui
- 禁用配色：紫色渐变、Tailwind 默认蓝(#3B82F6)、灰色卡片背景(bg-gray-100)
- 禁用布局：居中卡片+紫色按钮+Inter字体的千篇一律组合
### 强制选择设计方向（选一个并贯彻到底）
极简主义 / 野兽派 / 编辑感杂志风 / 复古未来 / 玻璃拟物 / 手绘温暖感
### 设计要求
- 字体配对：标题用衬线或显示字体(如 Playfair Display, Bricolage Grotesque, Fraunces)，正文用清晰无衬线(如 DM Sans, Manrope, Outfit)
- 色彩：选择有意义的调色板。主色+辅色+中性色三色体系。不要用默认色板。
- 动效：有目的的动画(引导注意力/反馈交互)，不是装饰性动画
- 排版：大胆的字号对比(标题 48px+，正文 16px)，不要全场 16px
- 间距：用有节奏的间距系统(8px 基准)，不要随手 10px/15px`

/**
 * React 性能规则精简版（Encoded Preference）
 * 来源：Vercel React Best Practices，133k weekly installs
 * 检测到 React/前端任务时自动注入
 */
const REACT_PERFORMANCE_RULES = `## React 性能规则
- 消除请求瀑布：用 Suspense 流式加载，避免顺序 await
- 禁用 barrel imports：import Button from '@/components/Button' 而非 from '@/components'
- 重型组件用 next/dynamic 或 React.lazy 懒加载
- 长列表用 CSS content-visibility 或虚拟滚动
- 派生状态用 useMemo/useCallback，但不要过度优化简单值
- 避免在 render 中创建新对象/数组引用
- 状态提升到最近公共父级，不要全局化
- useEffect 只做副作用，不做数据转换
- key 用稳定 ID 不用数组索引
- 组件超过 200 行考虑拆分`

/**
 * 检测任务是否涉及前端/UI 生成
 */
function detectFrontendTask(command) {
  const patterns = [
    /网页|网站|页面|前端|UI|界面|landing|page|website|frontend/i,
    /html|css|tailwind|react|vue|jsx|tsx|component|组件/i,
    /按钮|表单|卡片|导航|布局|弹窗|modal|dialog|sidebar|navbar/i,
    /样式|动画|渐变|字体|配色|主题|style|animation|gradient|font|theme/i,
    /游戏|canvas|webgl|three\.js|pixi|phaser/i,
  ]
  return patterns.some(p => p.test(command))
}

/**
 * Grill Me: 复杂任务首步澄清规则（Encoded Preference）
 * 来源：Matt Pocock 的 grill-me skill，156k installs
 * 防止 AI 带着错误假设冲上前
 */
const GRILL_ME_RULE = `## 首步澄清（复杂任务）
- plan >= 3 项的复杂任务，首个 thought 必须列出：
  1. 关键假设（技术选型、设计方向、数据结构）
  2. 需要主人确认的分歧点（多种合理方案时列出选项，不要默默选一个）
  3. 验证标准（怎样算完成）
- 简单任务（plan < 3 项）可直接执行，无需澄清`

/**
 * /simplify: final 前自动自审（Capability Uplift）
 * 来源：Anthropic 官方内置 /simplify skill
 * 在 plan 全部完成后、真正 final 前，强制自审一轮：
 * 1. 代码复用：是否有重复逻辑可提取？
 * 2. 代码质量：命名是否清晰？嵌套是否过深？
 * 3. 效率：是否有不必要的计算/IO/重复读取？
 */
const SIMPLIFY_SELF_REVIEW = `## 自审检查（final 前强制）
请审查刚刚完成的全部工作，逐项确认：
1. 代码复用：是否有相同逻辑出现2次以上？可提取公共函数？
2. 代码质量：变量名是否自解释？嵌套是否超过3层？有无冗余条件？
3. 效率：是否有不必要的重复计算/文件读取/网络请求？能否合并？
如有问题，用 edit_file 或 apply_patch 修复后再输出 final。如无问题，直接输出 final。`

function buildReactPrompt(command, context, history, taskPlan = null) {
  const workspace = context.workspace || process.cwd()
  const profile = context.profile || ''
  const memories = context.memories || ''
  const skills = context.skills || ''
  const activeSkillDoc = context.activeSkillDoc || ''
  const previousTask = context.previousTask || null

  // 检测前端任务，条件注入设计规范
  const isFrontend = detectFrontendTask(command)

  // 查找相似历史轨迹，提供经验参考
  const pastTraces = traceStore.search(command, 2)
  let traceHint = ''
  if (pastTraces.length > 0) {
    const traceLines = pastTraces.map(t => {
      const stepsUsed = (t.steps || []).map(s => s.action).filter(Boolean).join('→')
      return `- "${t.command.slice(0, 80)}" (${t.success ? '成功' : '失败'}, ${t.totalSteps}步, 工具链: ${stepsUsed.slice(0, 100)})`
    })
    traceHint = `\n## 历史经验（相似任务的执行轨迹）\n${traceLines.join('\n')}\n`
  }

  // 完整 system prompt（仅第 1 步使用）
  const fullSystemPrompt = `你是缪斯（Muse），一个高效的自主执行智能体。你需要逐步完成任务，每轮输出严格 JSON。

## 环境
- 工作目录: ${workspace}
- 系统: macOS (Darwin)
${profile ? `- 主人画像: ${profile.slice(0, 200)}` : ''}
${memories ? `\n## 记忆\n${memories.slice(0, 800)}\n` : ''}
${skills ? `\n## 可用技能\n${skills.slice(0, 500)}\n` : ''}
${activeSkillDoc ? `\n## 当前激活技能文档\n${activeSkillDoc.slice(0, 2000)}\n` : ''}
${previousTask ? `\n## 上轮任务上下文\n- 命令: ${previousTask.command}\n- 结果: ${(previousTask.answer || '').slice(0, 300)}\n${previousTask.artifacts ? `- 产物: ${previousTask.artifacts}` : ''}\n` : ''}## 工具
${TOOLS_SCHEMA}
${traceHint}
## 输出格式（必须返回且仅返回一个合法 JSON 对象）

工具调用（首次需带 plan）：
{"type":"action","thought":"分析与计划","plan":[{"id":1,"desc":"子任务描述"}],"action":"工具名","input":{参数JSON}}

批量工具调用（多个独立操作合并为一步，减少往返）：
{"type":"batch","thought":"创建所有源文件","actions":[{"action":"write_file","input":{"path":"a.js","content":"..."}},{"action":"write_file","input":{"path":"b.js","content":"..."}}],"plan_done":[1,2]}

标记子任务完成（在任意 action 或 final 中可带 plan_done）：
{"type":"action","thought":"...","plan_done":[1,2],"action":"工具名","input":{...}}

任务完成（plan 全部 done 后才可输出）：
{"type":"final","thought":"完成总结","plan_done":[3],"answer":"结果摘要"}

## 策略
- 先探索再行动：不确定时先 list_dir 或 search_file
- **批量创建文件优先用 batch**：多个独立文件创建/写入用 {"type":"batch","actions":[...]} 一次完成，不要一个文件一个 step
- 多文件修改优先用 apply_patch：一次调用修改多个文件，原子性保证，比多次 edit_file 更高效
- 小范围修改可用 edit_file：仅改一处时用 edit_file 更简洁
- 新建文件用 batch(write_file) 或 apply_patch 的 Add File
- ⚠️ 大文件分块写入：预计超过 200 行的文件，用 write_file 写前 ~100 行，再用 append_file 追加后续内容。单次响应嵌入过长的 content 会被 LLM 输出截断导致写入失败
- 分步验证：每完成一个子目标验证后再继续
- 写文件前先读：修改文件时先 read_file 了解现有内容
- 完整完成：plan 中所有子任务标记 done 后才输出 final，不可提前终止
- 禁止假设工具执行结果，必须等 Observation

${KARPATHY_RULES}
${GRILL_ME_RULE}
${CODE_SIMPLIFIER_CHECK}
${isFrontend ? FRONTEND_DESIGN_GUIDE : ''}
${isFrontend ? REACT_PERFORMANCE_RULES : ''}`

  if (!history.length) {
    // 检测断点恢复
    const checkpoint = context._resumeCheckpoint
    if (checkpoint) {
      return `${fullSystemPrompt}

【断点恢复】这是一个之前因"${checkpoint.interruptReason}"而中断的任务，已执行过 ${checkpoint.totalSteps} 步。
请基于之前的进展继续执行，不要重复已完成的工作。

## 之前的执行进展
${checkpoint.stepsSummary}

## 最后成功的操作
${checkpoint.lastSuccessfulAction || '无'}

## 任务
${command}

请先用 list_dir 或 read_file 确认之前的产物是否还在，然后从中断处继续。`
    }

    return `${fullSystemPrompt}

【重要】这是第一步，请先分析任务并制定执行计划。

1. 在 thought 中分析任务，拆分为 2-6 个子任务
2. 在 plan 字段中列出所有子任务
3. 如果第一个子任务在此步即可完成，用 plan_done 标记其 id
4. 然后执行第一个子任务的第一步

输出格式（action 类型）：
{"type":"action","thought":"分析+计划","plan":[{"id":1,"desc":"子任务描述"},...],"plan_done":[1],"action":"工具名","input":{...}}

如果任务很简单不需拆分，plan 中只列 1 项即可。

## 任务
${command}`
  }

  // 后续步骤：API 有状态（服务端通过 sessionId 维护上下文），只发最近一步的 observation + 继续指令
  const lastEntry = history[history.length - 1]
  const lastObs = lastEntry.observation && lastEntry.observation.length > 2000
    ? lastEntry.observation.slice(0, 800) + '\n...(省略)...\n' + lastEntry.observation.slice(-800)
    : (lastEntry.observation || '')

  // 构建 plan 进度块
  let planSection = ''
  if (taskPlan && taskPlan.length > 0) {
    const lines = taskPlan.map(item =>
      `${item.done ? '✅' : '⏳'} ${item.id}. ${item.desc}`
    ).join('\n')
    planSection = `\n\n【计划进度】\n${lines}\n\n继续执行。如果当前子任务已完成，请在响应中包含 "plan_done":[已完成的id数组]，然后开始下一个未完成的子任务。`
  }

  return `[Step ${lastEntry.step}] Observation:
${lastObs}

继续执行 Step ${history.length + 1}。${planSection}`
}

// ========== JSON 解析 ==========

function parseReactResponse(response) {
  let cleaned = (response || '').trim()
  // 去除 markdown code fence
  if (cleaned.startsWith('```')) {
    const firstNl = cleaned.indexOf('\n')
    const lastFence = cleaned.lastIndexOf('```')
    if (lastFence > firstNl) cleaned = cleaned.slice(firstNl + 1, lastFence).trim()
  }

  // 尝试直接解析
  let parsed = null
  try { parsed = JSON.parse(cleaned) } catch {}

  if (!parsed) {
    // 提取第一个完整 JSON 对象
    const braceStart = cleaned.indexOf('{')
    if (braceStart >= 0) {
      let depth = 0, endPos = -1
      let inString = false, escape = false
      for (let i = braceStart; i < cleaned.length; i++) {
        const ch = cleaned[i]
        if (escape) { escape = false; continue }
        if (ch === '\\') { escape = true; continue }
        if (ch === '"') { inString = !inString; continue }
        if (inString) continue
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { endPos = i + 1; break } }
      }
      if (endPos > 0) {
        try { parsed = JSON.parse(cleaned.slice(braceStart, endPos)) } catch {}
      } else {
        // JSON 不完整（没有找到匹配的闭合括号）→ 响应被截断
        const partial = cleaned.slice(braceStart)
        const hasWriteFile = /"(?:action|action_name)"\s*:\s*"write_file"/.test(partial)
        const hasApplyPatch = /"(?:action|action_name)"\s*:\s*"apply_patch"/.test(partial)
        const hasAppendFile = /"(?:action|action_name)"\s*:\s*"append_file"/.test(partial)
        if (hasWriteFile || hasApplyPatch || hasAppendFile) {
          // 尝试提取文件路径
          const pathMatch = partial.match(/"path"\s*:\s*"([^"]*)"/)
          const filePath = pathMatch ? pathMatch[1] : '(未知)'
          return {
            type: 'truncated',
            thought: `⚠️ 响应被截断：正在写入文件 ${filePath} 时 JSON 不完整。这通常是因为文件内容过长超出了单次输出限制。请改用分块策略：write_file 写入第一部分（前 ~100 行），然后 append_file 追加后续部分。`,
            actionName: '',
            actionInput: {},
            truncatedFile: filePath,
          }
        }
      }
    }
  }

  if (parsed && typeof parsed === 'object' && parsed.type) {
    const type = (parsed.type || '').toLowerCase()
    // 提取 plan_done（AI 可在任何响应中标记完成的子任务）
    const planDone = Array.isArray(parsed.plan_done)
      ? parsed.plan_done
      : (parsed.plan_done != null ? [parsed.plan_done] : null)

    if (type === 'final') {
      return {
        type: 'final',
        thought: parsed.thought || '',
        finalAnswer: parsed.answer || parsed.final_answer || '',
        planDone,
      }
    }
    if (type === 'action') {
      // 提取 plan（仅首次 action 响应会带 plan）
      const plan = Array.isArray(parsed.plan)
        ? parsed.plan.map((p, i) => ({
            id: p.id || (i + 1),
            desc: p.desc || p.description || p.task || String(p),
            done: false,
          }))
        : null
      return {
        type: 'action',
        thought: parsed.thought || '',
        actionName: (parsed.action || parsed.action_name || '').toLowerCase(),
        actionInput: parsed.input || parsed.action_input || {},
        plan,
        planDone,
      }
    }
    // AI 返回 think 类型：在思考但未输出 action/final，不当作解析失败
    if (type === 'think') {
      return {
        type: 'think',
        thought: parsed.thought || '',
        actionName: '',
        actionInput: {},
        planDone,
      }
    }
    // AI 返回 batch 类型：一次输出多个独立工具调用，减少往返轮次
    if (type === 'batch' && Array.isArray(parsed.actions)) {
      return {
        type: 'batch',
        thought: parsed.thought || '',
        actions: parsed.actions.map(a => ({
          actionName: (a.action || a.action_name || '').toLowerCase(),
          actionInput: a.input || a.action_input || {},
        })),
        plan,
        planDone,
      }
    }
  }

  // Fallback: 正则
  const finalMatch = response.match(/Final Answer[:\s]+(.*)/is)
  if (finalMatch) return { type: 'final', thought: '', finalAnswer: finalMatch[1].trim() }

  // 无法解析为有效 JSON action 时，标记为解析失败
  // 返回 type=unparseable，主循环会计数并在连续失败时终止
  // 但先检查是否是截断导致的不完整 JSON
  const braceStartCheck = cleaned.indexOf('{')
  if (braceStartCheck >= 0) {
    let depth = 0, endPosCheck = -1, inStr = false, esc = false
    for (let i = braceStartCheck; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { endPosCheck = i + 1; break } }
    }
    if (endPosCheck === -1 && cleaned.length > 200) {
      return {
        type: 'truncated',
        thought: '⚠️ 响应被截断：JSON 不完整。如果正在写入大文件，请改用分块策略：write_file 写第一部分 → append_file 追加后续部分。',
        actionName: '',
        actionInput: {},
      }
    }
  }
  return { type: 'unparseable', thought: cleaned.slice(0, 300), actionName: '', actionInput: {} }
}

// ========== ReAct 主循环 ==========

/**
 * 执行 ReAct 循环
 * @param {string} command - 任务描述
 * @param {object} context - { workspace, profile, sessionId, systemTools }
 * @param {object} callbacks - { onStepStart, onObservation, onFinal, onError }
 * @param {object} options - { maxSteps, totalTimeout }
 * @returns {Promise<{success, finalAnswer, steps, totalSteps, error}>}
 */
async function executeReAct(command, context = {}, callbacks = {}, options = {}) {
  const maxSteps = options.maxSteps || REACT_MAX_STEPS
  const totalTimeout = options.totalTimeout || REACT_TOTAL_TIMEOUT
  const workspace = context.workspace || process.cwd()
  const sessionId = context.sessionId || `react_${Date.now()}`

  // 初始化全链路日志
  const { ReactLogSession } = require('./react-logger')
  const logSession = new ReactLogSession({
    userInput: command.slice(0, 2000),
    sessionId,
    source: options.source || 'react_engine',
    intentClassification: options.intentClassification || null,
  })
  logSession.logContext(context)

  // 检测是否有可恢复的断点
  const resumeCheckpoint = loadCheckpoint(command)
  if (resumeCheckpoint) {
    console.log(`[ReAct] 发现断点: ${resumeCheckpoint.totalSteps} steps, 中断原因: ${resumeCheckpoint.interruptReason}`)
    // 将断点信息注入 context，供 buildReactPrompt 使用
    context._resumeCheckpoint = resumeCheckpoint
  }

  // 新任务开始：清除上一次可能残留的中断标志
  clearAbort()

  const metacog = new MetaCognitiveMonitor(command, maxSteps)
  const history = []
  const steps = []
  const startTime = Date.now()
  let consecutiveParseFailures = 0
  let pendingCheckpoint = false // 延迟 git checkpoint 标记
  let taskPlan = null              // plan 数组 [{id, desc, done}]
  let prematureFinalCount = 0     // 被拦截的 final 次数（安全阀，3 次后放行）
  let hasSelfReviewed = false      // /simplify 自审标记，final 前强制一轮

  function finishLog(success, finalAnswer, totalSteps, error) {
    // 任务结束时刷掉待处理的 git checkpoint
    if (pendingCheckpoint) {
      const commitMsg = generateCommitMessage(steps, command)
      try { toolGit({ action: 'checkpoint', message: commitMsg }, workspace).catch(() => {}) } catch {}
      pendingCheckpoint = false
    }
    // 成功完成 → 清除断点；失败/中断 → 保存断点 + 生成 Handoff 文档
    if (success) {
      clearCheckpoint(command)
    } else {
      saveCheckpoint(command, steps, workspace, error)
      generateHandoffDoc(command, steps, error || '未知中断', workspace)
    }
    logSession.logResult({ success, finalAnswer, totalSteps, error })
    logSession.flush()
  }

  for (let stepNum = 1; stepNum <= maxSteps; stepNum++) {
    const elapsed = Date.now() - startTime

    // 用户主动中断检查（每步开始时）— 优先级高于超时/步数
    if (isAbortRequested()) {
      clearAbort()
      const finalAnswer = `任务已被用户中断（执行了 ${stepNum - 1} 步）。`
      traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: elapsed, metacogSignals: metacog.totalFailures })
      finishLog(false, finalAnswer, stepNum - 1, '用户主动中断')
      if (callbacks.onAbort) {
        callbacks.onAbort({ answer: finalAnswer, totalSteps: stepNum - 1 })
      } else if (callbacks.onError) {
        callbacks.onError({ error: '用户主动中断', totalSteps: stepNum - 1, aborted: true })
      }
      return { success: false, aborted: true, finalAnswer, steps, totalSteps: stepNum - 1, error: '用户主动中断' }
    }

    // 超时检查
    if (elapsed >= totalTimeout) {
      const result = { success: false, finalAnswer: '', steps, totalSteps: stepNum - 1, error: '执行超时' }
      traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: elapsed, metacogSignals: metacog.totalFailures })
      finishLog(false, '', stepNum - 1, '执行超时')
      if (callbacks.onError) callbacks.onError({ error: '执行超时', totalSteps: stepNum - 1 })
      return result
    }

    // 剩余不足30s且已有进展时主动收尾
    if (totalTimeout - elapsed < 30000 && history.length >= 3) {
      const finalAnswer = `任务执行了 ${stepNum - 1} 步后时间不足，已有进展但未完全完成。`
      traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: elapsed, metacogSignals: metacog.totalFailures })
      finishLog(false, finalAnswer, stepNum - 1, '时间预算不足')
      if (callbacks.onError) callbacks.onError({ error: '时间预算不足', totalSteps: stepNum - 1, partialProgress: true })
      return { success: false, partialProgress: true, finalAnswer, steps, totalSteps: stepNum - 1, error: '时间预算不足' }
    }

    // 构建 prompt + 元认知注入（带任务摘要，防止 stateful 模式下 AI 丢失上下文）
    let prompt = buildReactPrompt(command, context, history, taskPlan)
    const injection = metacog.getInjectionText()
    if (injection) {
      prompt += `\n\n【任务提醒】${command.slice(0, 150)}`
      prompt += injection
    }
    logSession.logPrompt(stepNum, prompt)

    // 调用 AI（带中断轮询：用户点停止后 500ms 内中断当前请求）
    let aiResponse
    const aiStartTime = Date.now()
    const promptLen = prompt.length
    console.log(`[ReAct][Token] 📤 Step ${stepNum} 输入: ${promptLen} 字 (≈${Math.round(promptLen / 3)} tokens) | session ...${sessionId.slice(-8)}`)
    let abortInterval
    try {
      const remainingMs = totalTimeout - (Date.now() - startTime)
      const stepTimeout = Math.min(120000, Math.max(30000, remainingMs - 10000))
      const aiPromise = callAI(prompt, { sessionId, timeout: stepTimeout })
      // 中断轮询器：每 500ms 检查 abort flag，命中则 reject
      const abortPoller = new Promise((_, reject) => {
        abortInterval = setInterval(() => {
          if (isAbortRequested()) {
            clearInterval(abortInterval)
            reject(new Error('ABORT_REQUESTED'))
          }
        }, 500)
      })
      aiResponse = await Promise.race([aiPromise, abortPoller])
      // Token 监控：记录每次 ReAct API 调用
      const responseLen = aiResponse ? aiResponse.length : 0
      const aiDurationMs = Date.now() - aiStartTime
      console.log(`[ReAct][Token] 📥 Step ${stepNum} 输出: ${responseLen} 字 (≈${Math.round(responseLen / 3)} tokens) | 总计 ≈${Math.round((promptLen + responseLen) / 3)} tokens | ${aiDurationMs}ms`)
      tokenMonitor.recordCall({
        source: 'react',
        input: prompt,
        output: aiResponse || '',
        sessionId,
        contextMode: stepNum === 1 ? 'full' : 'light',
        contextSize: promptLen,
        intentMatched: false,
      })
    } catch (err) {
      // 用户中断：立即退出，不等当前 callAI 完成
      if (err.message === 'ABORT_REQUESTED' || isAbortRequested()) {
        clearAbort()
        const finalAnswer = `任务已被用户中断（执行了 ${stepNum - 1} 步）。`
        traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
        finishLog(false, finalAnswer, stepNum - 1, '用户主动中断')
        if (callbacks.onAbort) {
          callbacks.onAbort({ answer: finalAnswer, totalSteps: stepNum - 1 })
        } else if (callbacks.onError) {
          callbacks.onError({ error: '用户主动中断', totalSteps: stepNum - 1, aborted: true })
        }
        return { success: false, aborted: true, finalAnswer, steps, totalSteps: stepNum - 1, error: '用户主动中断' }
      }
      logSession.logAIResponse(stepNum, null, { type: 'error' }, Date.now() - aiStartTime)
      if (history.length >= 2) {
        const finalAnswer = `AI 调用失败但已有部分进展（${stepNum - 1} 步）。`
        const error = `AI调用失败: ${err.message}`
        traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
        finishLog(false, finalAnswer, stepNum - 1, error)
        if (callbacks.onError) callbacks.onError({ error, totalSteps: stepNum - 1, partialProgress: true })
        return { success: false, partialProgress: true, finalAnswer, steps, totalSteps: stepNum - 1, error }
      }
      traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
      finishLog(false, '', stepNum - 1, `AI调用失败: ${err.message}`)
      if (callbacks.onError) callbacks.onError({ error: `AI 调用失败: ${err.message}`, totalSteps: stepNum - 1 })
      return { success: false, finalAnswer: '', steps, totalSteps: stepNum - 1, error: err.message }
    } finally {
      if (abortInterval) clearInterval(abortInterval)
    }

    const aiDurationMs = Date.now() - aiStartTime
    const parsed = parseReactResponse(aiResponse)
    logSession.logAIResponse(stepNum, aiResponse, parsed, aiDurationMs)

    // ========== Plan 状态管理 ==========
    // 提取 plan（仅首次 action 响应会带 plan）
    if (!taskPlan && parsed.plan && parsed.plan.length > 0) {
      taskPlan = parsed.plan
      console.log(`[ReAct] Plan 已建立: ${taskPlan.length} 项 — ${taskPlan.map(p => p.desc.slice(0, 20)).join(' | ')}`)
      if (callbacks.onPlanUpdate) {
        callbacks.onPlanUpdate({ plan: taskPlan })
      }
    }

    // 更新 plan 完成状态（AI 可在任何响应中标记 plan_done）
    if (taskPlan && parsed.planDone && parsed.planDone.length > 0) {
      let updated = false
      for (const doneId of parsed.planDone) {
        const item = taskPlan.find(p => String(p.id) === String(doneId))
        if (item && !item.done) {
          item.done = true
          updated = true
        }
      }
      if (updated) {
        console.log(`[ReAct] Plan 更新: ${taskPlan.filter(p => p.done).length}/${taskPlan.length} 完成`)
        if (callbacks.onPlanUpdate) {
          callbacks.onPlanUpdate({ plan: taskPlan })
        }
      }
    }

    // Final — 检查 plan 是否全部完成
    if (parsed.type === 'final') {
      // Plan 完成检查：有未完成项且未达到安全阀上限时拦截
      if (taskPlan && taskPlan.length > 0 && prematureFinalCount < 3) {
        const incomplete = taskPlan.filter(item => !item.done)
        if (incomplete.length > 0) {
          prematureFinalCount++
          console.log(`[ReAct] Step ${stepNum}: final 被拦截（plan 未完成，${incomplete.length} 项剩余，第 ${prematureFinalCount} 次拦截）`)
          // 注入提醒作为 observation，不终止循环
          const reminder = `⚠️ 任务尚未全部完成！以下子任务还未完成：\n${incomplete.map(i => `- ${i.desc}`).join('\n')}\n请继续执行未完成的子任务，全部完成后再输出 final。`
          history.push({
            step: stepNum,
            observation: reminder,
            thought: parsed.thought || '',
            actionName: 'plan_check',
            actionInput: {},
            success: false,
          })
          if (callbacks.onObservation) {
            callbacks.onObservation({ step: stepNum, observation: reminder, success: false })
          }
          continue
        }
      }

      // Plan 全部完成（或无 plan / 达到安全阀），允许终止
      // /simplify: plan 完成后强制自审一轮（仅首次，且任务有实际文件修改）
      if (!hasSelfReviewed && steps.some(s => ['write_file', 'edit_file', 'apply_patch', 'append_file'].includes(s.actionName))) {
        hasSelfReviewed = true
        console.log(`[ReAct] Step ${stepNum}: final 被拦截（触发 /simplify 自审）`)
        history.push({
          step: stepNum,
          observation: SIMPLIFY_SELF_REVIEW,
          thought: parsed.thought || '',
          actionName: 'self_review',
          actionInput: {},
          success: false,
        })
        if (callbacks.onObservation) {
          callbacks.onObservation({ step: stepNum, observation: '🔍 触发 /simplify 自审...', success: false })
        }
        continue
      }

      // 自审通过，允许终止
      traceStore.saveTrace({ command, steps, success: true, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
      finishLog(true, parsed.finalAnswer, stepNum - 1, null)
      if (callbacks.onFinal) callbacks.onFinal({ answer: parsed.finalAnswer, totalSteps: stepNum - 1 })
      return { success: true, finalAnswer: parsed.finalAnswer, steps, totalSteps: stepNum - 1, error: null }
    }

    // 响应截断：LLM 输出超限导致 JSON 不完整
    if (parsed.type === 'truncated') {
      consecutiveParseFailures++  // 截断也算解析失败，但单独计数
      const truncMsg = parsed.thought || '⚠️ 响应被截断。'
      console.warn(`[ReAct] Step ${stepNum}: 响应截断 (连续 ${consecutiveParseFailures} 次): ${(parsed.truncatedFile || 'N/A')}`)
      // 注入截断提示作为 observation，引导 AI 改用分块策略
      const obsText = `${truncMsg}\n\n【系统提示】你的上一次响应被截断，文件内容未写入。请采用分块写入策略：\n1. write_file 写入文件的前 ~100 行（确保完整）\n2. append_file 追加后续内容，每次 ~100 行\n3. 如果文件很大，可拆成 3-5 次 append_file\n4. 避免在单次响应中嵌入超过 200 行的文件内容`
      const stepRecord = { step: stepNum, thought: parsed.thought || '', actionName: 'truncated', actionInput: {}, observation: obsText, success: false }
      steps.push(stepRecord)
      history.push(stepRecord)
      logSession.logToolExecution(stepNum, 'truncated', {}, obsText, false, 0)
      if (callbacks.onObservation) {
        callbacks.onObservation({ step: stepNum, observation: obsText, success: false })
      }
      if (consecutiveParseFailures >= 5) {
        const fallbackAnswer = '任务执行中断：多次响应截断。建议拆分任务为更小的步骤。'
        traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
        finishLog(false, fallbackAnswer, stepNum - 1, '连续5次响应截断')
        if (callbacks.onFinal) callbacks.onFinal({ answer: fallbackAnswer, totalSteps: stepNum - 1 })
        return { success: true, finalAnswer: fallbackAnswer, steps, totalSteps: stepNum - 1, error: null }
      }
      continue
    }

    // 解析失败：AI 没有返回有效 JSON
    if (parsed.type === 'unparseable') {
      consecutiveParseFailures++
      console.warn(`[ReAct] Step ${stepNum}: AI 返回无法解析为 JSON (连续 ${consecutiveParseFailures} 次)`)

      if (consecutiveParseFailures >= 3) {
        // === 关键：JSON 解析失败不等于任务失败，先检查 plan 完成度 ===
        const allPlanDone = !taskPlan || taskPlan.length === 0 || taskPlan.every(item => item.done)

        // 收集已创建/修改的文件
        const outputFiles = steps
          .filter(s => ['write_file', 'edit_file', 'apply_patch', 'append_file'].includes(s.actionName))
          .map(s => s.actionInput?.path || s.actionInput?.file || '')
          .filter(Boolean)
        const uniqueFiles = [...new Set(outputFiles)]

        if (allPlanDone && uniqueFiles.length > 0) {
          // Plan 全部完成 + 文件已产出 → 判定成功
          const successAnswer = `任务已完成。共执行 ${stepNum - 1} 步，产出 ${uniqueFiles.length} 个文件：\n${uniqueFiles.map(f => `- ${f}`).join('\n')}`
          console.log(`[ReAct] Step ${stepNum}: JSON 解析失败但 plan 已全部完成 (${taskPlan?.filter(p => p.done).length}/${taskPlan?.length})，判定成功`)
          traceStore.saveTrace({ command, steps, success: true, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
          finishLog(true, successAnswer, stepNum - 1, 'JSON解析失败但plan已完成')
          if (callbacks.onFinal) callbacks.onFinal({ answer: successAnswer, totalSteps: stepNum - 1 })
          return { success: true, finalAnswer: successAnswer, steps, totalSteps: stepNum - 1, error: null }
        }

        // Plan 未完成 → 详细失败原因
        const planStatus = taskPlan && taskPlan.length > 0
          ? `Plan 完成度: ${taskPlan.filter(p => p.done).length}/${taskPlan.length}（${taskPlan.filter(p => !p.done).map(p => p.desc).join('、') || '全部完成'}）`
          : '无 plan'
        const fileList = uniqueFiles.length > 0
          ? `已产出文件 (${uniqueFiles.length}): ${uniqueFiles.slice(0, 10).join(', ')}${uniqueFiles.length > 10 ? '...' : ''}`
          : '无文件产出'
        const successSteps = steps.filter(s => s.success !== false).length
        const rawSnippet = (parsed.thought || '').replace(/\{[\s\S]*?\}/g, '[JSON对象]').slice(0, 200)
        const fallbackAnswer = `任务未完成：连续 ${consecutiveParseFailures} 次 JSON 解析失败。\n\n${planStatus}\n${fileList}\n成功步骤: ${successSteps}/${steps.length}\nAI 最后返回: ${rawSnippet}`

        console.warn(`[ReAct] Step ${stepNum}: 连续 ${consecutiveParseFailures} 次 JSON 解析失败，退出。${planStatus} | ${fileList}`)
        traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum - 1, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
        finishLog(false, fallbackAnswer, stepNum - 1, `连续${consecutiveParseFailures}次JSON解析失败`)
        if (callbacks.onFinal) callbacks.onFinal({ answer: fallbackAnswer, totalSteps: stepNum - 1 })
        return { success: false, finalAnswer: fallbackAnswer, steps, totalSteps: stepNum - 1, error: `连续${consecutiveParseFailures}次JSON解析失败` }
      }
      continue
    }

    // Think：AI 返回了思考但未输出 action/final，不当作解析失败
    if (parsed.type === 'think') {
      console.log(`[ReAct] Step ${stepNum}: AI 返回 think 类型（思考中，无 action），继续`)
      consecutiveParseFailures = 0  // think 是有效响应，重置失败计数
      const thinkText = parsed.thought || '(AI 在思考但未输出 action)'
      const obsText = `${thinkText}\n\n【系统提示】请输出一个 action 或 final 类型的 JSON 响应。如果你认为任务已完成，请输出 {"type":"final","answer":"..."}。如果需要继续执行，请输出 {"type":"action","action":"...","input":{...}}。`
      const stepRecord = { step: stepNum, thought: thinkText, actionName: 'think', actionInput: {}, observation: obsText, success: false }
      steps.push(stepRecord)
      history.push(stepRecord)
      logSession.logToolExecution(stepNum, 'think', {}, obsText, false, 0)
      if (callbacks.onObservation) {
        callbacks.onObservation({ step: stepNum, observation: '思考中...', success: false })
      }
      continue
    }

    // Batch：多个独立工具调用一次执行，合并 observation（减少 LLM 往返）
    if (parsed.type === 'batch' && parsed.actions && parsed.actions.length > 0) {
      const batchThought = parsed.thought || ''
      const batchActions = parsed.actions
      console.log(`[ReAct] Step ${stepNum}: batch 模式，${batchActions.length} 个 action`)

      if (callbacks.onStepStart) {
        callbacks.onStepStart({ step: stepNum, thought: batchThought, action: `batch(${batchActions.length})`, input: {} })
      }

      const batchObservations = []
      let batchAllSuccess = true
      let batchAborted = false

      for (let i = 0; i < batchActions.length; i++) {
        const bActionName = batchActions[i].actionName
        const bActionInput = batchActions[i].actionInput

        // 中断检查
        if (isAbortRequested()) { batchAborted = true; break }

        // 危险 shell 默认拒绝；只有明确的用户授权才能执行。
        const batchAuthorization = await authorizeToolAction(bActionName, bActionInput, callbacks.onNeedConfirm, stepNum, workspace)
        if (!batchAuthorization.allowed) {
          batchObservations.push(`[${i+1}/${batchActions.length}] ${bActionName}: 已拒绝 (${batchAuthorization.reason})`)
          batchAllSuccess = false
          continue
        }

        // 执行工具（超时按 batch 内均分）
        const bToolStart = Date.now()
        const bRemainingMs = totalTimeout - (bToolStart - startTime)
        const bTimeout = Math.min(60000, Math.max(5000, Math.floor(bRemainingMs * 0.8 / batchActions.length)))
        const bObs = await executeTool(bActionName, bActionInput, workspace, bTimeout)
        const bDuration = Date.now() - bToolStart
        const bSuccess = !isToolFailure(bObs)
        logSession.logToolExecution(stepNum, bActionName, bActionInput, bObs, bSuccess, bDuration)

        const bObsShort = cleanObservation(bObs, 300)
        batchObservations.push(`[${i+1}/${batchActions.length}] ${bActionName} ${bSuccess ? '✅' : '❌'}: ${bObsShort}`)
        if (!bSuccess) batchAllSuccess = false
        if (bSuccess && ['edit_file', 'write_file', 'apply_patch', 'append_file'].includes(bActionName)) {
          pendingCheckpoint = true
        }
        if (callbacks.onObservation) {
          callbacks.onObservation({ step: stepNum, observation: `[${i+1}/${batchActions.length}] ${bActionName} ${bSuccess ? '✅' : '❌'}`, success: bSuccess })
        }
      }

      // 中断
      if (batchAborted) {
        clearAbort()
        const finalAnswer = `任务已被用户中断（batch 执行到 ${batchObservations.length}/${batchActions.length}）。`
        traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
        finishLog(false, finalAnswer, stepNum, '用户主动中断(batch)')
        if (callbacks.onAbort) { callbacks.onAbort({ answer: finalAnswer, totalSteps: stepNum }) }
        return { success: false, aborted: true, finalAnswer, steps, totalSteps: stepNum, error: '用户主动中断' }
      }

      // 合并 observation 推回 history
      const combinedObs = batchObservations.join('\n')
      const stepRecord = { step: stepNum, thought: batchThought, actionName: `batch(${batchActions.length})`, actionInput: {}, observation: combinedObs, success: batchAllSuccess }
      steps.push(stepRecord)
      history.push(stepRecord)

      if (pendingCheckpoint && stepNum % 3 === 0) {
        const commitMsg = generateCommitMessage(steps, command)
        try { await toolGit({ action: 'checkpoint', message: commitMsg }, workspace) } catch {}
        pendingCheckpoint = false
      }

      const signals = metacog.observe(stepNum, batchAllSuccess, 'batch', {}, Date.now() - startTime)
      logSession.logMetacogSignals(stepNum, signals)
      console.log(`[ReAct] Step ${stepNum}: batch 完成，${batchObservations.filter(o => o.includes('✅')).length}/${batchActions.length} 成功`)
      continue
    }

    // 有效解析重置计数
    consecutiveParseFailures = 0

    // Action
    const { thought, actionName, actionInput } = parsed

    if (callbacks.onStepStart) {
      callbacks.onStepStart({ step: stepNum, thought, action: actionName, input: actionInput })
    }

    // ========== 危险 shell 命令拦截：命中危险规则时阻塞等待用户「点击继续」 ==========
    // 仅拦截 shell 工具，复用 analyzeScriptSafety 的硬规则（rm -rf、git push --force、磁盘操作等）。
    const authorization = await authorizeToolAction(actionName, actionInput, callbacks.onNeedConfirm, stepNum, workspace)
    if (!authorization.allowed) {
      const observation = `危险命令未执行（${authorization.reason}；${authorization.authorizationReason}）。`
      const stepRecord = { step: stepNum, thought, actionName, actionInput, observation, success: false }
      steps.push(stepRecord)
      history.push(stepRecord)
      logSession.logToolExecution(stepNum, actionName, actionInput, observation, false, 0)
      if (callbacks.onObservation) callbacks.onObservation({ step: stepNum, observation, success: false })
      const signals = metacog.observe(stepNum, false, actionName, actionInput, Date.now() - startTime)
      logSession.logMetacogSignals(stepNum, signals)
      continue
    }

    // 执行工具（动态超时：取剩余时间的80%，上限120s，下限10s）
    const toolStartTime = Date.now()
    const toolRemainingMs = totalTimeout - (toolStartTime - startTime)
    const dynamicToolTimeout = Math.min(120000, Math.max(10000, Math.floor(toolRemainingMs * 0.8)))
    const observation = await executeTool(actionName, actionInput, workspace, dynamicToolTimeout)
    const toolDurationMs = Date.now() - toolStartTime
    const stepSuccess = !isToolFailure(observation)
    logSession.logToolExecution(stepNum, actionName, actionInput, observation, stepSuccess, toolDurationMs)

    // 用户中断检查（工具执行后）— 当前步骤的产物已落地，记录后立即停止，不进入下一步
    if (isAbortRequested()) {
      clearAbort()
      const stepRecord = { step: stepNum, thought, actionName, actionInput, observation: cleanObservation(observation, 2000), success: stepSuccess }
      steps.push(stepRecord)
      const finalAnswer = `任务已被用户中断（执行了 ${stepNum} 步）。`
      traceStore.saveTrace({ command, steps, success: false, totalSteps: stepNum, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
      finishLog(false, finalAnswer, stepNum, '用户主动中断')
      if (callbacks.onAbort) {
        callbacks.onAbort({ answer: finalAnswer, totalSteps: stepNum })
      } else if (callbacks.onError) {
        callbacks.onError({ error: '用户主动中断', totalSteps: stepNum, aborted: true })
      }
      return { success: false, aborted: true, finalAnswer, steps, totalSteps: stepNum, error: '用户主动中断' }
    }

    // 文件修改后标记待 checkpoint（延迟到每3步或任务结束时批量执行）
    if (stepSuccess && ['edit_file', 'write_file', 'apply_patch', 'append_file'].includes(actionName)) {
      pendingCheckpoint = true
    }
    if (pendingCheckpoint && stepNum % 3 === 0) {
      const commitMsg = generateCommitMessage(steps, command)
      try { await toolGit({ action: 'checkpoint', message: commitMsg }, workspace) } catch {}
      pendingCheckpoint = false
    }

    const stepRecord = { step: stepNum, thought, actionName, actionInput, observation: cleanObservation(observation, 2000), success: stepSuccess }
    steps.push(stepRecord)
    history.push(stepRecord)

    if (callbacks.onObservation) {
      callbacks.onObservation({ step: stepNum, observation: cleanObservation(observation, 2000), success: stepSuccess })
    }

    // 元认知监控
    const signals = metacog.observe(stepNum, stepSuccess, actionName, actionInput, Date.now() - startTime)
    logSession.logMetacogSignals(stepNum, signals)
  }

  // 超出步数
  traceStore.saveTrace({ command, steps, success: false, totalSteps: maxSteps, durationMs: Date.now() - startTime, metacogSignals: metacog.totalFailures })
  finishLog(false, '', maxSteps, `超出最大步数 (${maxSteps})`)
  if (callbacks.onError) callbacks.onError({ error: `超出最大步数 (${maxSteps})`, totalSteps: maxSteps })
  return { success: false, finalAnswer: '', steps, totalSteps: maxSteps, error: `超出最大步数 (${maxSteps})` }
}

// ========== 导出 ==========

module.exports = {
  executeReAct,
  requestAbort,
  clearAbort,
  isAbortRequested,
  traceStore,
  MetaCognitiveMonitor,
  ReasoningTraceStore,
  TOOLS,
  _internals: {
    parseReactResponse,
    shouldSaveCheckpoint,
    resolveWorkspacePath,
    isToolFailure,
    authorizeToolAction,
    findShellWorkspaceEscape: findWorkspaceEscape,
  },
}

'use strict'

/**
 * 系统日志采集模块
 * 每次 folio 启动时执行一次，按天覆盖文件
 * 采集：运行中的 App、git log、shell 历史命令、浏览器标签标题、用户信息、日志日期
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { SYSLOG_DIR } = require('./config')

fs.mkdirSync(SYSLOG_DIR, { recursive: true })

/**
 * 安全执行 shell 命令，失败时返回 null
 */
function safeExec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 8000, ...options }).trim()
  } catch {
    return null
  }
}

/**
 * 采集当前运行中的 App 列表（macOS）
 */
function collectRunningApps() {
  const raw = safeExec(
    `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`
  )
  if (!raw) return []
  return raw.split(', ').map(s => s.trim()).filter(Boolean)
}

/**
 * 采集浏览器已打开的标签页标题（Safari + Chrome）
 */
function collectBrowserTabs() {
  const tabs = []

  // Safari
  const safariTabs = safeExec(
    `osascript -e 'tell application "Safari" to get name of every tab of every window'`
  )
  if (safariTabs) {
    safariTabs.split(',').forEach(t => {
      const title = t.trim().replace(/^\{|\}$/g, '').trim()
      if (title && title !== 'missing value') tabs.push({ browser: 'Safari', title })
    })
  }

  // Chrome
  const chromeTabs = safeExec(
    `osascript -e 'tell application "Google Chrome" to get title of every tab of every window'`
  )
  if (chromeTabs) {
    chromeTabs.split(',').forEach(t => {
      const title = t.trim().replace(/^\{|\}$/g, '').trim()
      if (title && title !== 'missing value') tabs.push({ browser: 'Chrome', title })
    })
  }

  return tabs
}

/**
 * 采集 git log（当前工作目录，最近 20 条）
 */
function collectGitLog(cwd) {
  const targetDir = cwd || process.cwd()
  const raw = safeExec(
    `git log --oneline --no-merges -20 --format="%h|%ai|%an|%s"`,
    { cwd: targetDir }
  )
  if (!raw) return []

  return raw.split('\n').filter(Boolean).map(line => {
    const [hash, datetime, author, ...subjectParts] = line.split('|')
    return { hash, datetime, author, subject: subjectParts.join('|') }
  })
}

/**
 * 采集 shell 历史命令（最近 50 条，去重）
 */
function collectShellHistory() {
  const homeDir = process.env.HOME || ''

  // 优先读 zsh history
  const zshHistoryFile = path.join(homeDir, '.zsh_history')
  const bashHistoryFile = path.join(homeDir, '.bash_history')

  let historyFile = null
  if (fs.existsSync(zshHistoryFile)) {
    historyFile = zshHistoryFile
  } else if (fs.existsSync(bashHistoryFile)) {
    historyFile = bashHistoryFile
  }

  if (!historyFile) return []

  try {
    const raw = fs.readFileSync(historyFile, 'utf8')
    const lines = raw.split('\n').filter(Boolean)

    // zsh history 格式：`: 时间戳:0;命令` 或裸命令
    const commands = lines
      .map(line => {
        const zshMatch = line.match(/^:\s*\d+:\d+;(.+)$/)
        return zshMatch ? zshMatch[1].trim() : line.trim()
      })
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('#'))
      .slice(-50)

    // 去重，保留最后出现的顺序
    const seen = new Set()
    return [...commands].reverse().filter(cmd => {
      if (seen.has(cmd)) return false
      seen.add(cmd)
      return true
    }).reverse()
  } catch {
    return []
  }
}

/**
 * 采集用户基本信息
 */
function collectUserInfo() {
  return {
    username: safeExec('whoami') || process.env.USER || 'unknown',
    hostname: safeExec('hostname') || 'unknown',
    homeDir: process.env.HOME || '',
    shell: process.env.SHELL || 'unknown',
    platform: process.platform,
    nodeVersion: process.version
  }
}

/**
 * 执行完整系统日志采集，写入按天覆盖的 JSON 文件
 */
function collectSyslog() {
  const today = new Date().toISOString().slice(0, 10)
  const outputFile = path.join(SYSLOG_DIR, `${today}.json`)

  const syslog = {
    date: today,
    collectedAt: new Date().toISOString(),
    user: collectUserInfo(),
    runningApps: collectRunningApps(),
    browserTabs: collectBrowserTabs(),
    gitLog: collectGitLog(),
    shellHistory: collectShellHistory()
  }

  fs.writeFileSync(outputFile, JSON.stringify(syslog, null, 2), 'utf8')
  console.log(`[syslog] 系统日志已采集 → ${outputFile}`)

  return syslog
}

/**
 * 读取指定日期（默认今天）的系统日志
 */
function readSyslog(date) {
  const targetDate = date || new Date().toISOString().slice(0, 10)
  const file = path.join(SYSLOG_DIR, `${targetDate}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

module.exports = {
  collectSyslog,
  readSyslog
}

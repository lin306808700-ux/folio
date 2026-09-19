'use strict'

/**
 * 核心模块
 * 提供工具函数和初始化逻辑
 */

const fs = require('fs')
const path = require('path')
const { JOURNAL_DIR, INSIGHTS_DIR, PROFILE_DIR, WORKSPACE_DIR } = require('./config')

// 确保目录存在
for (const dir of [JOURNAL_DIR, INSIGHTS_DIR, PROFILE_DIR, WORKSPACE_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * 写入日志
 */
function writeJournal(content, type = 'thought') {
  const file = path.join(JOURNAL_DIR, `${new Date().toISOString().slice(0, 10)}.md`)
  const entry = `\n## ${new Date().toLocaleTimeString('zh-CN')} [${type}]\n${content}\n`
  fs.appendFileSync(file, entry, 'utf8')
}

/**
 * 写入洞察
 */
function writeInsight(title, content) {
  const file = path.join(INSIGHTS_DIR, `${Date.now()}_${title.replace(/\s+/g, '_')}.md`)
  fs.writeFileSync(file, `# ${title}\n\n${content}\n`, 'utf8')
}

/**
 * 更新画像
 */
function updateProfile(name, content) {
  const file = path.join(PROFILE_DIR, `${name}.md`)
  // 确保每段信息都带日期前缀，便于判断时效性
  const today = new Date().toISOString().slice(0, 10)
  const dated = content
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      // 跳过空行、标题行、已有日期标记的行
      if (!trimmed || trimmed.startsWith('#') || /^\[?\d{4}-\d{2}-\d{2}\]?/.test(trimmed) || trimmed.startsWith('- [')) {
        return line
      }
      return `[${today}] ${line}`
    })
    .join('\n')
  fs.writeFileSync(file, dated, 'utf8')
}

/**
 * 在工作区创建文件
 */
function createInWorkspace(filename, content) {
  const file = path.join(WORKSPACE_DIR, filename)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

/**
 * 初始化
 */
function init(mainWindow) {
  const { setMainWindow } = require('./mailbox')
  setMainWindow(mainWindow)
  
  // 首次启动时加载上下文（仅一次）
  const { loadInitialContext } = require('./context')
  loadInitialContext()

  // 启动时采集系统日志（按天覆盖）
  const { collectSyslog } = require('./syslog')
  setImmediate(() => collectSyslog())

  // 清理过期 ReAct 日志
  const { cleanupOldLogs } = require('./react-logger')
  setImmediate(() => cleanupOldLogs())

  console.log('[Muse] 已初始化，模块已加载')
}

/**
 * 获取状态
 */
function getStatus() {
  const { getHeartbeatStatus } = require('./heartbeat')
  
  // 读取目录列表（按修改时间倒序，最新的在前）
  const listDir = (dir) => {
    try {
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'))
      return files.sort((a, b) => {
        try {
          const statA = fs.statSync(path.join(dir, a))
          const statB = fs.statSync(path.join(dir, b))
          return statB.mtimeMs - statA.mtimeMs
        } catch {
          return 0
        }
      })
    } catch {
      return []
    }
  }
  
  return {
    museHome: require('./config').MUSE_HOME,
    workspace: WORKSPACE_DIR,
    heartbeat: getHeartbeatStatus(),
    journals: listDir(JOURNAL_DIR),
    insights: listDir(INSIGHTS_DIR),
    profileSections: listDir(PROFILE_DIR),
    workspaceFiles: listDir(WORKSPACE_DIR)
  }
}

module.exports = {
  init,
  getStatus,
  writeJournal,
  writeInsight,
  updateProfile,
  createInWorkspace,
  WORKSPACE_DIR
}

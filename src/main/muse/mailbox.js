'use strict'

const { Letters } = require('../database')

let _mainWindow = null

/**
 * 设置主窗口引用
 */
function setMainWindow(window) {
  _mainWindow = window
}

/**
 * 推送信件到前端
 */
function pushLetterToFrontend(letter) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('muse:newLetter', letter)
  }
}

/**
 * 创建并推送一封信
 */
function sendLetter({ title, content, priority = 'normal', source = 'heartbeat', taskId = null }) {
  const letter = Letters.create({ title, content, priority, source, taskId })
  console.log(`[Muse] ✉️ 发送信件: ${title} (${priority})`)
  pushLetterToFrontend(letter)
  return letter
}

/**
 * P0改进：推送任务执行进度到前端
 * @param {Object} progress - 进度信息
 * @param {string} progress.taskId - 任务ID
 * @param {string} progress.subtaskId - 子任务ID（可选）
 * @param {string} progress.status - 状态：executing|completed|failed|repairing
 * @param {string} progress.message - 进度消息
 * @param {number} progress.current - 当前步骤
 * @param {number} progress.total - 总步骤数
 * @param {string} progress.error - 错误信息（失败时）
 * @param {number} progress.repairAttempts - 修复尝试次数
 */
function pushTaskProgress(progress) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('muse:taskProgress', {
      ...progress,
      timestamp: new Date().toISOString()
    })
    console.log(`[Muse] 📊 推送任务进度:`, progress.status, progress.message)
  }
}

/**
 * 获取主窗口引用（供其他模块直接发送 IPC 事件）
 */
function getMainWindow() {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    return _mainWindow
  }
  return null
}

/**
 * 推送日志到前端气泡，同时保留终端输出
 * @param {string} message
 * @param {'info'|'warn'|'error'|'success'} level
 * @param {string|null} taskId
 */
function pushLog(message, level, taskId) {
  console.log('[Muse]', message)
  const win = getMainWindow()
  if (win) {
    win.webContents.send('muse:log', { message, level: level || 'info', taskId: taskId || null, timestamp: Date.now() })
  }
}

module.exports = {
  setMainWindow,
  getMainWindow,
  sendLetter,
  pushLetterToFrontend,
  pushTaskProgress,
  pushLog
}

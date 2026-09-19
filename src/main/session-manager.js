'use strict'

const path = require('path')
const fs = require('fs')
const { app } = require('electron')

// 追踪 sessionId 变化，用于新 session 首次调用时注入完整记忆
let lastSessionId = null

// ========== 上下文窗口管理 — Session 上下文状态追踪 ==========
let sessionContextState = {
  sessionId: null,
  requestCount: 0,
  injectedSystemPrompt: false,
  injectedMemories: false,
  lastMemoryHash: '',
}

function resetContextState() {
  sessionContextState = {
    sessionId: null,
    requestCount: 0,
    injectedSystemPrompt: false,
    injectedMemories: false,
    lastMemoryHash: '',
  }
}

// 简单字符串哈希 — 用于检测内容变化
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash.toString(36)
}

// Session 持久化管理
function getCurrentSessionId() {
  const sessionFile = path.join(app.getPath('userData'), 'data', 'currentSession.json')
  try {
    if (fs.existsSync(sessionFile)) {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'))
      if (data && data.sessionId) {
        return data.sessionId
      }
    }
  } catch (e) {
    console.warn('[Session] 读取 session 文件失败:', e.message)
  }
  const newId = `ai_terminal_${Date.now()}`
  try {
    const dataDir = path.join(app.getPath('userData'), 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(sessionFile, JSON.stringify({
      sessionId: newId,
      createdAt: new Date().toISOString()
    }), 'utf-8')
  } catch (e) {
    console.warn('[Session] 写入 session 文件失败:', e.message)
  }
  return newId
}

function resetSessionId() {
  const newId = `ai_terminal_${Date.now()}`
  const sessionFile = path.join(app.getPath('userData'), 'data', 'currentSession.json')
  try {
    const dataDir = path.join(app.getPath('userData'), 'data')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    fs.writeFileSync(sessionFile, JSON.stringify({
      sessionId: newId,
      createdAt: new Date().toISOString()
    }), 'utf-8')
  } catch (e) {
    console.warn('[Session] 重置 session 文件失败:', e.message)
  }
  lastSessionId = newId
  resetContextState()
  return newId
}

module.exports = {
  getCurrentSessionId,
  resetSessionId,
  getContextState: () => sessionContextState,
  resetContextState,
  simpleHash,
  getLastSessionId: () => lastSessionId,
  setLastSessionId: (id) => { lastSessionId = id },
}

'use strict'

const { History, Memories, MemorySummary, Ideas } = require('../database')
const sessionManager = require('../session-manager')
const { listTemplates } = require('../prompt-templates')
const { loadRules } = require('../craft-checker')

function register(ipcMain) {
  // 场景模板列表（供前端 @ 触发器使用）
  ipcMain.handle('db:promptTemplates:list', () => {
    try {
      return listTemplates()
    } catch (e) {
      console.warn('[IPC] promptTemplates:list 失败:', e.message)
      return []
    }
  })

  // Craft 规则列表（供前端 / 命令使用）
  ipcMain.handle('db:craft:list', () => {
    try {
      return loadRules().map(r => ({ name: r.name, category: r.category, severity: r.severity, description: r.description }))
    } catch (e) {
      console.warn('[IPC] craft:list 失败:', e.message)
      return []
    }
  })
  // Session 管理
  ipcMain.handle('session:getCurrent', () => {
    return { sessionId: sessionManager.getCurrentSessionId() }
  })

  ipcMain.handle('session:reset', () => {
    return { sessionId: sessionManager.resetSessionId() }
  })

  // 对话历史
  ipcMain.handle('db:history:getAll', () => History.getAll())
  ipcMain.handle('db:history:add', (event, item) => History.add(item))
  ipcMain.handle('db:history:delete', (event, id) => History.delete(id))
  ipcMain.handle('db:history:clearAll', () => History.clearAll())
  ipcMain.handle('db:history:search', (event, keyword, limit) => History.search(keyword, limit))

  // 记忆中心
  ipcMain.handle('db:memories:getAll', () => Memories.getAll())
  ipcMain.handle('db:memories:add', (event, content) => Memories.add(content))
  ipcMain.handle('db:memories:delete', (event, id) => Memories.delete(id))

  // 记忆总结
  ipcMain.handle('db:memorySummary:getAll', () => MemorySummary.getAll())
  ipcMain.handle('db:memorySummary:update', (event, { id, item }) => MemorySummary.update(id, item))
  ipcMain.handle('db:memorySummary:delete', (event, id) => MemorySummary.delete(id))

  // 灵感采集
  ipcMain.handle('db:ideas:getAll', () => Ideas.getAll())
  ipcMain.handle('db:ideas:add', (event, item) => Ideas.add(item))
  ipcMain.handle('db:ideas:delete', (event, id) => Ideas.delete(id))
}

module.exports = { register }

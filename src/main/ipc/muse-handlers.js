// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const { ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const museAgent = require('../muse-agent')
const { WORKSPACE_DIR } = require('../muse/config')
const staticServer = require('../muse/static-server')
const artifactStore = require('../muse/artifact-store')
const knowledge = require('../muse/knowledge')
const learningMaps = require('../muse/learning-maps').store
const learningPrefetch = require('../muse/learning-prefetch')
const { callAIStream } = require('../../shared/ai-client')

let _mainWindow = null

/**
 * 注册缪斯智能体的 IPC handlers
 */
function registerMuseHandlers(mainWindow) {
  _mainWindow = mainWindow
  const learningResponse = action => {
    try {
      return { success: true, data: action() }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  ipcMain.handle('muse:learning:list', () => learningResponse(() => learningMaps.list()))
  // 批量视图只回元数据，章节正文按需用 getNode 单取
  ipcMain.handle('muse:learning:listMeta', () => learningResponse(() => learningMaps.listMeta()))
  ipcMain.handle('muse:learning:get', (_event, { mapId }) => learningResponse(() => learningMaps.get(mapId)))
  ipcMain.handle('muse:learning:getNode', (_event, { mapId, nodeId }) => learningResponse(() => learningMaps.getNode(mapId, nodeId)))
  ipcMain.handle('muse:learning:create', (_event, payload) => learningResponse(() => learningMaps.create(payload)))
  ipcMain.handle('muse:learning:updateMap', (_event, { mapId, updates }) => learningResponse(() => learningMaps.updateMap(mapId, updates)))
  ipcMain.handle('muse:learning:deleteMap', (_event, { mapId }) => learningResponse(() => learningMaps.deleteMap(mapId)))
  ipcMain.handle('muse:learning:addNode', (_event, { mapId, ...payload }) => learningResponse(() => learningMaps.addNode(mapId, payload)))
  ipcMain.handle('muse:learning:deleteNode', (_event, { mapId, nodeId }) => learningResponse(() => learningMaps.deleteNode(mapId, nodeId)))
  ipcMain.handle('muse:learning:updateNode', (_event, { mapId, nodeId, updates }) => learningResponse(() => learningMaps.updateNode(mapId, nodeId, updates)))
  ipcMain.handle('muse:learning:setCurrent', (_event, { mapId, nodeId }) => learningResponse(() => learningMaps.setCurrent(mapId, nodeId)))

  // ========== 学习图谱 AI 流式通道（活的书：写章节/圈选提问/下钻衍生） ==========
  // 每个 requestId 一个 AbortController，支持中途停止
  const learningAiRequests = new Map()
  const { buildLearningPrompt } = require('../muse/learning-prompts')

  // 后台预生成管线：空闲时逐章预制，打开节点即可读
  learningPrefetch.start(() => _mainWindow)

  ipcMain.handle('muse:learning:prefetchStatus', () => ({ success: true, data: learningPrefetch.getStatus() }))
  ipcMain.handle('muse:learning:prefetchBump', (_event, { mapId, nodeId } = {}) => {
    learningPrefetch.bump(mapId, nodeId)
    return { success: true }
  })

  // 学习图谱本地偏好：后台预制可关闭（持续调模型的能力必须是用户可见、可关的）
  const learningSettings = require('../muse/learning-settings')
  ipcMain.handle('muse:learning:getSettings', () => ({ success: true, data: learningSettings.getSettings() }))
  ipcMain.handle('muse:learning:setSettings', (_event, patch = {}) => {
    const next = learningSettings.updateSettings(patch)
    if (typeof patch.prefetchEnabled === 'boolean') learningPrefetch.setEnabled(patch.prefetchEnabled)
    return { success: true, data: next }
  })

  ipcMain.handle('muse:learning:aiAsk', (_event, payload) => {
    const { requestId } = payload || {}
    if (!requestId || learningAiRequests.has(requestId)) {
      return { success: false, error: '无效的请求 ID' }
    }
    // 交互式请求抢占后台预生成，避免用户排在章节生成后面等待
    learningPrefetch.preemptForInteractive()
    const controller = new AbortController()
    learningAiRequests.set(requestId, controller)
    const send = (channel, data) => {
      if (_mainWindow && !_mainWindow.isDestroyed()) _mainWindow.webContents.send(channel, data)
    }
    ;(async () => {
      try {
        const prompt = buildLearningPrompt(payload)
        const stream = callAIStream(prompt, { signal: controller.signal })
        let content = ''
        for await (const frame of stream) {
          content = frame.content || content
          if (frame.delta) send('muse:learning:aiChunk', { requestId, delta: frame.delta, content })
          if (frame.streamEnd) break
        }
        send('muse:learning:aiEnd', { requestId, success: true, content })
      } catch (error) {
        const aborted = controller.signal.aborted
        send('muse:learning:aiEnd', { requestId, success: !aborted, content: '', error: aborted ? '已停止生成' : (error.message || 'AI 调用失败') })
      } finally {
        learningAiRequests.delete(requestId)
      }
    })()
    return { success: true }
  })

  ipcMain.handle('muse:learning:aiAbort', (_event, { requestId } = {}) => {
    const controller = learningAiRequests.get(requestId)
    if (controller) controller.abort()
    return { success: true }
  })
  // 执行直接指令
  ipcMain.handle('muse:executeCommand', async (_event, { command } = {}) => {
    return await museAgent.executeCommand(command)
  })

  // 获取缪斯状态
  ipcMain.handle('muse:getStatus', async () => {
    return museAgent.getStatus()
  })

  // 打开工作空间目录
  ipcMain.handle('muse:openWorkspace', async () => {
    try {
      await shell.openPath(WORKSPACE_DIR)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 获取工作空间文件列表（带 URL，递归扫描）
  ipcMain.handle('muse:getWorkspaceFiles', async () => {
    try {
      const allFiles = []
      
      // 忽略的目录名
      const IGNORED_DIRS = new Set([
        'node_modules', 'dist', 'build', '.git', '.svn',
        '__pycache__', '.cache', '.tmp', 'coverage',
        '.next', '.nuxt', '.output', 'vendor'
      ])

      // 递归扫描目录
      function scanDir(dir, baseDir = '') {
        const entries = fs.readdirSync(dir)
        
        for (const entry of entries) {
          // 跳过隐藏文件和忽略目录
          if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue
          
          const fullPath = path.join(dir, entry)
          const relativePath = baseDir ? path.join(baseDir, entry) : entry
          const stat = fs.statSync(fullPath)
          
          if (stat.isDirectory()) {
            // 递归扫描子目录
            scanDir(fullPath, relativePath)
          } else {
            // 添加文件
            allFiles.push({
              name: entry,
              path: relativePath,
              size: stat.size,
              modified: stat.mtime,
              isDirectory: false,
              url: `http://localhost:${staticServer.PORT}/workspace/${relativePath}`
            })
          }
        }
      }
      
      scanDir(WORKSPACE_DIR)
      
      // 排序：HTML 文件优先，然后按修改时间倒序
      const htmlExtensions = ['.html', '.htm']
      allFiles.sort((a, b) => {
        const aIsHtml = htmlExtensions.includes(path.extname(a.path).toLowerCase())
        const bIsHtml = htmlExtensions.includes(path.extname(b.path).toLowerCase())
        
        // HTML 文件排在前面
        if (aIsHtml && !bIsHtml) return -1
        if (!aIsHtml && bIsHtml) return 1
        
        // 同类文件按修改时间倒序
        return new Date(b.modified) - new Date(a.modified)
      })
      
      return { success: true, files: allFiles }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ========== 创作产物 API ==========
  ipcMain.handle('artifacts:getRecent', async (_event, { limit } = {}) => {
    return artifactStore.getRecent(limit || 50)
  })

  ipcMain.handle('artifacts:search', async (_event, { keyword } = {}) => {
    return artifactStore.search(keyword || '', 20)
  })

  ipcMain.handle('artifacts:getBySession', async (_event, { sessionId } = {}) => {
    return artifactStore.getBySession(sessionId || '')
  })

  // ========== 知识检索 API ==========
  ipcMain.handle('muse:knowledge:search', async (_event, { keyword, limit } = {}) => {
    return knowledge.searchKnowledge(keyword || '', limit || 20)
  })

  ipcMain.handle('muse:knowledge:consolidate', async () => {
    return await knowledge.consolidateMemories()
  })

  ipcMain.handle('muse:knowledge:retrieveRelevant', async (_event, { taskCommand, limit } = {}) => {
    const result = knowledge.retrieveRelevant(taskCommand, limit || 5)
    return { experience: result }
  })

  console.log('[Muse] IPC handlers 已注册')
}

module.exports = { registerMuseHandlers }

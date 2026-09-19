
'use strict'

const path = require('path')
const taskEngine = require('../task-engine')
const taskStateManager = require('../task-engine/state')
const securityAnalyzer = require('../security-analyzer')
const semanticCache = require('../semantic-cache')
const tokenMonitor = require('../token-monitor')

function register(ipcMain, mainWindow) {
  // ========== 安全分析 ==========
  ipcMain.handle('security:analyze', (event, { command }) => {
    return securityAnalyzer.analyze(command)
  })

  // ========== 任务持久化 ==========

  // 获取未完成的任务列表（前端启动时调用）
  ipcMain.handle('task:getUnfinished', () => {
    return { success: true, data: taskStateManager.getUnfinishedTasks() }
  })

  // 清除指定未完成任务
  ipcMain.handle('task:clearUnfinished', (event, { taskId }) => {
    return taskStateManager.clearUnfinishedTask(taskId)
  })

  // 清除所有未完成任务
  ipcMain.handle('task:clearAllUnfinished', () => {
    return taskStateManager.clearAllUnfinished()
  })

  // 获取任务历史
  ipcMain.handle('task:getHistory', (event, { limit } = {}) => {
    return { success: true, data: taskStateManager.getTaskHistory(limit || 20) }
  })

  // ========== 任务引擎 ==========

  // 获取截图文件
  ipcMain.handle('task:getScreenshot', async (event, filename) => {
    try {
      const screenshotDir = path.join(process.env.HOME || '', '.folio', 'screenshots')
      const filepath = path.join(screenshotDir, filename)

      if (!filepath.startsWith(screenshotDir)) {
        return { success: false, error: '非法文件路径' }
      }

      const fs = require('fs').promises
      const data = await fs.readFile(filepath)

      return {
        success: true,
        data: data.toString('base64'),
        mimeType: 'image/png',
        fullPath: filepath
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 打开截图文件所在目录
  ipcMain.handle('task:openInFolder', async (event, filename) => {
    try {
      const screenshotDir = path.join(process.env.HOME || '', '.folio', 'screenshots')
      const filepath = path.join(screenshotDir, filename)

      if (!filepath.startsWith(screenshotDir)) {
        return { success: false, error: '非法文件路径' }
      }

      const { shell } = require('electron')
      await shell.showItemInFolder(filepath)

      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 确认并继续执行任务
  ipcMain.handle('task:confirm', async (event, { taskId, confirmed, modifiedStep }) => {
    console.log('[Main] 任务确认:', taskId, confirmed, modifiedStep ? '(带修改步骤)' : '')

    return await taskEngine.confirmTask(taskId, confirmed, {
      modifiedStep: modifiedStep,
      onStepStart: (step, current, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:stepStart', { step, current, total })
        }
      },
      onStepComplete: (step, result, current, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:stepComplete', { step, result, current, total })
        }
      },
      onNeedConfirm: (step, preview, tid) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:needConfirm', { step, preview, taskId: tid })
        }
      },
      onComplete: (summary, context) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:complete', { taskId, summary, context })
        }
      },
      onError: (error, stepIndex) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:error', { taskId, error: error.message, stepIndex })
        }
      }
    })
  })

  // 取消任务
  ipcMain.handle('task:cancel', (event, { taskId }) => {
    console.log('[Main] 取消任务:', taskId)
    return taskEngine.cancelTask(taskId)
  })

  // 获取任务状态
  ipcMain.handle('task:status', (event, { taskId }) => {
    return taskEngine.getTaskStatus(taskId)
  })

  // 暂停任务
  ipcMain.handle('task:pause', async (event, { taskId }) => {
    console.log('[Main] 暂停任务:', taskId)
    const result = await taskEngine.pause(taskId)
    
    if (result.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task:paused', { taskId })
    }
    
    return result
  })

  // 恢复任务
  ipcMain.handle('task:resume', async (event, { taskId, modifiedSteps }) => {
    console.log('[Main] 恢复任务:', taskId, modifiedSteps ? '(带修改步骤)' : '')
    
    const callbacks = {
      onStepStart: (step, current, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:stepStart', { step, current, total })
        }
      },
      onStepComplete: (step, result, current, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:stepComplete', { step, result, current, total })
        }
      },
      onNeedConfirm: (step, preview, tid) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:needConfirm', { step, preview, taskId: tid })
        }
      },
      onComplete: (summary, context) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:complete', { taskId, summary, context })
        }
      },
      onError: (error, stepIndex) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:error', { taskId, error: error.message, stepIndex })
        }
      }
    }
    
    const result = await taskEngine.resume(taskId, modifiedSteps, callbacks)
    return result
  })

  // 任务干预（Python engine 已移除，干预功能暂不支持）
  ipcMain.handle('task:intervene', async (event, { taskId, message }) => {
    console.log('[Main] 任务干预:', taskId, '指令:', message)
    return { success: false, error: '干预功能尚未在 Node.js ReAct 引擎中实现' }
  })

  // ========== 语义缓存 ==========

  ipcMain.handle('cache:getStats', async () => {
    try {
      const stats = await semanticCache.getStats()
      return { success: true, data: stats }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('cache:getReport', async () => {
    try {
      const report = await semanticCache.cacheManager.getReport()
      return { success: true, data: report }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('cache:cleanup', async () => {
    try {
      const count = await semanticCache.cleanup()
      return { success: true, cleanedCount: count }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('cache:reset', async () => {
    try {
      await semanticCache.reset()
      return { success: true, message: '缓存已重置' }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('cache:testQuery', async (event, { query }) => {
    try {
      const result = await semanticCache.query(query)
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // ========== 系统状态 ==========

  ipcMain.handle('system:getStats', async () => {
    try {
      const cacheStats = await semanticCache.getStats()
      const tokenStats = tokenMonitor.getStats()
      return {
        success: true,
        data: {
          cache: cacheStats,
          token: tokenStats,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
        }
      }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { register }

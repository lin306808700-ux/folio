const { app, BrowserWindow, ipcMain, shell } = require('electron')

// 品牌迁移（必须在任何业务模块读写数据目录前执行）：
// userData：ai-terminal / AI Terminal → Folio
const path = require('path')
const fs = require('fs')
try {
  const appData = app.getPath('appData')
  const targetUserData = path.join(appData, 'Folio')
  if (!fs.existsSync(targetUserData)) {
    for (const legacy of ['ai-terminal', 'AI Terminal']) {
      const legacyDir = path.join(appData, legacy)
      if (fs.existsSync(legacyDir)) {
        fs.renameSync(legacyDir, targetUserData)
        console.log(`[Main] 已迁移 userData 目录：${legacy} → Folio`)
        break
      }
    }
  }
} catch (error) {
  console.warn('[Main] 数据目录迁移失败:', error.message)
}
// 家目录迁移（~/.ai-terminal → ~/.folio，含双目录并存的图谱合并）：
// config.js 在 require 时自行执行，这里提前加载确保先于任何 ~/.folio 读写
require('./muse/config')

// 过滤 macOS 系统级 Electron 噪音日志，不影响其他输出
const originalStderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string' && chunk.includes('representedObject is not a WeakPtrToElectronMenuModelAsNSObject')) {
    if (typeof encoding === 'function') encoding()
    else if (typeof callback === 'function') callback()
    return true
  }
  return originalStderrWrite(chunk, encoding, callback)
}

// 应用内模型设置（userData 持久化）— 必须在业务模块加载前注入 env，
// 否则 model-provider 会以默认 openai 模式加载配置
const settingsStore = require('./settings-store')
const _settingsResult = settingsStore.applySettingsToEnv(settingsStore.loadSettings())
if (!_settingsResult.applied) {
  console.warn('[Main] 未找到应用内模型配置，首次使用请在「设置」中填写模型地址与密钥')
}

const semanticCache = require('./semantic-cache')

// 业务模块
const windowManager = require('./window-manager')
const terminalManager = require('./terminal-manager')
const chatHandler = require('./chat-handler')
const contextBuilder = require('./context-builder')
const tokenMonitor = require('./token-monitor')
const taskStateManager = require('./task-engine/state')
const taskEngine = require('./task-engine')
const museAgent = require('./muse-agent')
const { startServer: startStaticServer } = require('./muse/static-server')
// Python engine 已迁移到 Node.js react-engine，不再需要启动外部进程

// 功能减法：内置浏览器自动化（BrowserViewManager/browserTool）与变更分析（arch-designer）已下线

// IPC handlers
const dbHandlers = require('./ipc/db-handlers')
const aiHandlers = require('./ipc/ai-handlers')
const taskHandlers = require('./ipc/task-handlers')
const workspaceHandlers = require('./ipc/workspace-handlers')
const snapshotHandlers = require('./ipc/snapshot-handlers')
const { registerMuseHandlers } = require('./ipc/muse-handlers')
const pluginHandlers = require('./ipc/plugin-handlers')
const pluginSystem = require('./plugin-system')

// 应用生命周期

app.whenReady().then(async () => {
  // 启动 Muse 静态文件服务
  try {
    await startStaticServer()
  } catch (err) {
    console.error('[Main] 启动静态文件服务失败:', err.message)
  }
  
  const mainWindow = windowManager.createWindow()

  // 注入 mainWindow 引用
  terminalManager.init(mainWindow)
  chatHandler.init(mainWindow)
  contextBuilder.init(mainWindow)

  // Muse Router 接管对话入口，chat-handler 降级为执行器
  const museRouter = require('./muse/router')
  museRouter.init(mainWindow, chatHandler)
  tokenMonitor.setWindow(mainWindow)

  // 加载持久化的任务数据
  const restoredTasks = taskStateManager.loadPersistedData()
  taskEngine.restoreTasks(restoredTasks)

  // Shell IPC（preload 中 shell 不可用，需通过主进程转发）
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
  ipcMain.handle('shell:showItemInFolder', (_, filePath) => shell.showItemInFolder(filePath))

  // 注册所有 IPC handlers
  terminalManager.registerHandlers(ipcMain)
  dbHandlers.register(ipcMain)
  aiHandlers.register(ipcMain, mainWindow)
  taskHandlers.register(ipcMain, mainWindow)
  workspaceHandlers.register(ipcMain)
  snapshotHandlers.register()
  registerMuseHandlers(mainWindow)
  pluginHandlers.register(ipcMain)
  require('./ipc/settings-handlers').register()

  // 加载插件系统
  try {
    pluginSystem.loadAll({ logger: console })
    pluginSystem.watchDir(() => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('plugins:changed')
      }
    })
    console.log('[Main] 插件系统已加载')
  } catch (e) {
    console.warn('[Main] 插件系统加载失败:', e.message)
  }

  // ReAct 引擎已内置于 Node.js，无需启动外部进程
  console.log('[Main] Node.js ReAct 引擎就绪')

  // 缪斯智能体：注入窗口引用
  museAgent.init(mainWindow)

  // 心跳默认关闭，不随启动调度

  // 初始化语义缓存并启动定期清理
  try {
    await semanticCache.initialize()
    await semanticCache.cleanup()
    setInterval(async () => {
      try { await semanticCache.cleanup() } catch (e) { /* 静默失败 */ }
    }, 60 * 60 * 1000)
    console.log('[Main] 语义缓存初始化完成，已启用定期清理')
  } catch (e) {
    console.warn('[Main] 语义缓存初始化失败，将在首次调用时重试:', e.message)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowManager.createWindow()
  }
})

app.on('before-quit', () => {
  taskStateManager.flush()
  terminalManager.cleanup()
  museAgent.stopHeartbeat()
  // 卸载插件系统
  pluginSystem.stopWatch()
  pluginSystem.unloadAll()
})

// 全局异常处理
process.on('uncaughtException', (error) => {
  console.error('[Main] 未捕获的异常:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] 未处理的 Promise 拒绝:', reason)
})

// 导出 BrowserViewManager 供其他模块使用（功能减法：浏览器已下线，恒返 null，调用方均有空值守卫）
module.exports = {
  getBrowserViewManager: () => null
}

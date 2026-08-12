const { app, BrowserWindow, ipcMain, shell } = require('electron')

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
const { Skills } = require('./database')
const museAgent = require('./muse-agent')
const { startServer: startStaticServer } = require('./muse/static-server')
// Python engine 已迁移到 Node.js react-engine，不再需要启动外部进程
// 钉钉集成可选：通过 MUSE_DINGTALK_ENABLED=true 启用
const _dingtalkEnabled = process.env.MUSE_DINGTALK_ENABLED === 'true'
const dingtalkServer = _dingtalkEnabled ? require('./muse/dingtalk-server') : null

// 功能减法：内置浏览器自动化（BrowserViewManager/browserTool）与变更分析（arch-designer）已下线

// IPC handlers
const dbHandlers = require('./ipc/db-handlers')
const aiHandlers = require('./ipc/ai-handlers')
const skillHandlers = require('./ipc/skill-handlers')
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
  skillHandlers.register(ipcMain)
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

  // 缪斯智能体：注入窗口引用并启动心跳
  museAgent.init(mainWindow)

  // 钉钉 Outgoing 机器人服务（可选）
  if (_dingtalkEnabled && dingtalkServer) {
    try {
      dingtalkServer.startServer(mainWindow)
    } catch (err) {
      console.warn('[Main] 钉钉 Outgoing 服务启动失败:', err.message)
    }
  }
  
  // 功能减法：自主探索已隐藏，不再在启动时触发晨间回顾
  // triggerMorningReviewOnStartup()
  
  // 心跳默认关闭，需在 Muse 页面手动开启
  // museAgent.startHeartbeat()

  // 启动 skills 目录监听，变化时通知前端刷新
  Skills.onChanged(() => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('skills:changed')
    }
  })
  Skills.watchDir()

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
  // engineLauncher 已移除（ReAct 内置于 Node.js）
  if (dingtalkServer) dingtalkServer.stopServer()
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

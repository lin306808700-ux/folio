'use strict'

/**
 * 浏览器 IPC 处理器
 * 提供浏览器控制相关的 IPC 通道
 */

function register(ipcMain, browserViewManager) {
  // 切换到浏览器模式
  ipcMain.handle('browser:switchToBrowser', async () => {
    try {
      // 惰性初始化：首次切换时创建 BrowserView
      if (!browserViewManager.isReady()) {
        await browserViewManager.attach()
      }
      const result = await browserViewManager.show()
      return result || { success: true }
    } catch (error) {
      console.error('[BrowserHandlers] 切换到浏览器失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 切换到终端模式
  ipcMain.handle('browser:switchToTerminal', async () => {
    try {
      browserViewManager.hide()
      return { success: true }
    } catch (error) {
      console.error('[BrowserHandlers] 切换到终端失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 导航到 URL
  ipcMain.handle('browser:navigate', async (event, { url }) => {
    try {
      if (!url) {
        return { success: false, error: 'URL 不能为空' }
      }

      // 自动补全协议
      let targetUrl = url
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
        if (url.startsWith('/')) {
          // 本地绝对路径，使用 file:// 协议
          targetUrl = `file://${url}`
        } else {
          targetUrl = `https://${url}`
        }
      }

      return await browserViewManager.navigate(targetUrl)
    } catch (error) {
      console.error('[BrowserHandlers] 导航失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取当前页面信息
  ipcMain.handle('browser:getInfo', async () => {
    try {
      return await browserViewManager.getInfo()
    } catch (error) {
      console.error('[BrowserHandlers] 获取页面信息失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取页面详细内容
  ipcMain.handle('browser:getPageContent', async (event, options = {}) => {
    try {
      return await browserViewManager.getPageContent(options)
    } catch (error) {
      console.error('[BrowserHandlers] 获取页面内容失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 截图
  ipcMain.handle('browser:screenshot', async (event, params = {}) => {
    try {
      return await browserViewManager.screenshot(params)
    } catch (error) {
      console.error('[BrowserHandlers] 截图失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 刷新页面
  ipcMain.handle('browser:reload', async () => {
    try {
      return await browserViewManager.reload()
    } catch (error) {
      console.error('[BrowserHandlers] 刷新失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 后退
  ipcMain.handle('browser:goBack', async () => {
    try {
      return await browserViewManager.goBack()
    } catch (error) {
      console.error('[BrowserHandlers] 后退失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 前进
  ipcMain.handle('browser:goForward', async () => {
    try {
      return await browserViewManager.goForward()
    } catch (error) {
      console.error('[BrowserHandlers] 前进失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 设置 BrowserView 边界（前端调用）
  // 前端传来的是屏幕绝对坐标（screenX/Y），这里转换为窗口内相对坐标
  ipcMain.handle('browser:setBounds', async (event, bounds) => {
    try {
      let windowBounds = bounds

      // 如果前端传来的是屏幕绝对坐标（含 screenX/screenY 字段），则转换为窗口内坐标
      if (typeof bounds.screenX === 'number' && typeof bounds.screenY === 'number') {
        const win = browserViewManager.mainWindow
        const [winX, winY] = win.getPosition()
        windowBounds = {
          x: Math.round(bounds.screenX - winX),
          y: Math.round(bounds.screenY - winY),
          width: bounds.width,
          height: bounds.height
        }
        console.log('[BrowserHandlers] 屏幕坐标转窗口坐标:', { screen: { x: bounds.screenX, y: bounds.screenY }, window: { x: windowBounds.x, y: windowBounds.y }, winPos: [winX, winY] })
      }

      browserViewManager.setBounds(windowBounds)
      return { success: true }
    } catch (error) {
      console.error('[BrowserHandlers] 设置边界失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 检查浏览器是否就绪
  ipcMain.handle('browser:isReady', async () => {
    try {
      const ready = browserViewManager.isReady()
      return { success: true, data: { ready } }
    } catch (error) {
      console.error('[BrowserHandlers] 检查就绪状态失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 弹出独立窗口
  ipcMain.handle('browser:popOut', async () => {
    try {
      return await browserViewManager.popOut()
    } catch (error) {
      console.error('[BrowserHandlers] 弹出窗口失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 收回到右侧面板
  ipcMain.handle('browser:popIn', async () => {
    try {
      return await browserViewManager.popIn()
    } catch (error) {
      console.error('[BrowserHandlers] 收回面板失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 获取弹出状态
  ipcMain.handle('browser:isPoppedOut', async () => {
    try {
      return { success: true, data: { poppedOut: browserViewManager.isPoppedOut } }
    } catch (error) {
      console.error('[BrowserHandlers] 获取弹出状态失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 临时隐藏 BrowserView（模态窗口打开时调用，不影响 isVisible 状态）
  ipcMain.handle('browser:temporaryHide', async () => {
    try {
      if (browserViewManager.browserView && browserViewManager.isVisible) {
        browserViewManager.browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
      return { success: true }
    } catch (error) {
      console.error('[BrowserHandlers] 临时隐藏失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 恢复 BrowserView（模态窗口关闭时调用）
  ipcMain.handle('browser:temporaryShow', async () => {
    try {
      if (browserViewManager.browserView && browserViewManager.isVisible) {
        browserViewManager.browserView.setBounds(browserViewManager.currentBounds)
      }
      return { success: true }
    } catch (error) {
      console.error('[BrowserHandlers] 恢复显示失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 在 BrowserView 中执行 JavaScript 代码
  ipcMain.handle('browser:executeScript', async (event, { code }) => {
    try {
      if (!code) {
        return { success: false, error: 'code 不能为空' }
      }
      return await browserViewManager.executeScript(code)
    } catch (error) {
      console.error('[BrowserHandlers] 执行脚本失败:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = { register }
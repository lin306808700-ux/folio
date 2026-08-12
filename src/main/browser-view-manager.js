'use strict'

const { BrowserView, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

/**
 * BrowserView 管理器
 * 负责管理右侧面板的浏览器视图，与 BrowserTool 协同工作
 * 支持弹出独立窗口 / 收回到右侧面板
 */
class BrowserViewManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow
    this.browserView = null
    this.browserTool = null
    this.isVisible = false
    this.isPoppedOut = false      // 是否弹出到独立窗口
    this.popOutWindow = null      // 独立窗口引用
    this.currentBounds = { x: 0, y: 0, width: 0, height: 0 }
  }

  /**
   * 附加 BrowserTool（可选），并创建 BrowserView
   * BrowserView 独立工作，不依赖 Puppeteer
   * @param {Object} [browserTool] - BrowserTool 实例（可选，用于自动化协同）
   */
  async attach(browserTool) {
    if (browserTool) {
      this.browserTool = browserTool
    }

    // 检查已有的 BrowserView 是否仍然有效（webContents 可能被 Electron 内部销毁）
    if (this.browserView && this.browserView.webContents?.isDestroyed()) {
      console.log('[BrowserViewManager] 检测到已销毁的 BrowserView，清理后重建')
      try { this.mainWindow.removeBrowserView(this.browserView) } catch { /* ignore */ }
      this.browserView = null
    }

    // 创建 BrowserView
    if (!this.browserView) {
      console.log('[BrowserViewManager] 创建 BrowserView')
      this.browserView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true
        }
      })

      // 拦截 window.open / target="_blank" → 在当前 BrowserView 内导航，避免弹出新窗口
      this.browserView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[BrowserViewManager] 拦截新窗口请求，在当前视图内导航:', url)
        if (url && url !== 'about:blank') {
          this.browserView.webContents.loadURL(url)
        }
        return { action: 'deny' }
      })

      try {
        this.mainWindow.setBrowserView(this.browserView)
      } catch (err) {
        console.error('[BrowserViewManager] setBrowserView 失败，BrowserView 可能已被销毁:', err.message)
        this.browserView = null
        return { success: false, error: err.message }
      }
      this.setBounds(this.currentBounds)

      // 初始隐藏
      this.hide()
    }

    return { success: true }
  }

  /**
   * 设置 BrowserView 边界
   * @param {Object} bounds - { x, y, width, height }
   */
  setBounds(bounds) {
    if (!bounds) return

    this.currentBounds = { ...bounds }

    if (this.browserView && this.isVisible) {
      this.browserView.setBounds(bounds)
      // console.log('[BrowserViewManager 更新边界:', bounds)
    }
  }

  /**
   * 显示 BrowserView
   */
  show() {
    if (!this.browserView) {
      console.warn('[BrowserViewManager] BrowserView 未创建，无法显示')
      return { success: false, error: 'BrowserView 未创建' }
    }

    this.isVisible = true

    // 重新将 BrowserView 附加到主窗口
    try {
      this.mainWindow.setBrowserView(this.browserView)
    } catch (err) {
      console.error('[BrowserViewManager] show 时 setBrowserView 失败:', err.message)
      return { success: false, error: err.message }
    }

    // 如果 bounds 还是初始的 0 值（前端尚未同步），使用主窗口右半部分作为默认
    // 注意：前端的 BrowserView.tsx 会通过 ResizeObserver 主动同步精确坐标，
    // 这里的默认值仅作为极端情况下的兜底，通常不会被用到
    if (this.currentBounds.width === 0 || this.currentBounds.height === 0) {
      const [winW, winH] = this.mainWindow.getContentSize()
      const defaultWidth = Math.min(580, Math.floor(winW * 0.45))
      // macOS titleBarStyle:'hidden' 时内容区从 y=0 开始（标题栏透明叠加），
      // 但实际可交互内容区顶部约有 28px 的拖拽区域，这里留出足够空间
      const topOffset = process.platform === 'darwin' ? 28 : 0
      this.currentBounds = {
        x: winW - defaultWidth,
        y: topOffset,
        width: defaultWidth,
        height: winH - topOffset
      }
      console.log('[BrowserViewManager] 使用默认边界:', this.currentBounds)
    }

    this.browserView.setBounds(this.currentBounds)

    console.log('[BrowserViewManager] 显示 BrowserView')
    return { success: true }
  }

  /**
   * 隐藏 BrowserView（从主窗口移除，彻底不可见）
   */
  hide() {
    if (!this.browserView) return

    this.isVisible = false
    // 从主窗口移除 BrowserView，彻底消除残留像素
    try {
      this.mainWindow.removeBrowserView(this.browserView)
    } catch (err) {
      console.warn('[BrowserViewManager] hide 时 removeBrowserView 失败:', err.message)
    }

    console.log('[BrowserViewManager] 隐藏 BrowserView')
  }

  /**
   * 导航到指定 URL
   * 优先使用 BrowserView 的 webContents，不依赖 Puppeteer
   * @param {string} url - 目标 URL
   */
  async navigate(url) {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      console.log('[BrowserViewManager] 导航到:', url)
      await this.browserView.webContents.loadURL(url)
      return { success: true, data: { url } }
    } catch (error) {
      console.error('[BrowserViewManager] 导航失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取当前页面信息
   * 从 BrowserView 的 webContents 获取，避免 Puppeteer detached frame 问题
   */
  async getInfo() {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      const url = this.browserView.webContents.getURL()
      const title = this.browserView.webContents.getTitle()

      return {
        success: true,
        data: { url: url || '', title: title || '' }
      }
    } catch (error) {
      console.error('[BrowserViewManager] 获取页面信息失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取页面详细内容
   * 提取页面的 meta、标题、文本、表单、表格、链接等信息
   * @param {Object} options - 选项
   * @param {number} options.contentLimit - 内容字符数上限，默认 1500
   */
  async getPageContent(options = {}) {
    const contentLimit = options.contentLimit || 1500

    // 检查 BrowserView 是否存在
    if (!this.browserView) {
      console.log('[BrowserViewManager] getPageContent: BrowserView 未创建')
      return { success: true, data: { active: false } }
    }

    try {
      const url = this.browserView.webContents.getURL()

      // 检查是否为空白页
      if (!url || url === 'about:blank') {
        console.log('[BrowserViewManager] getPageContent: 页面为空白')
        return { success: true, data: { active: false } }
      }

      // 在页面中执行 JS 提取信息
      const code = `
        (function() {
          try {
            const result = {
              url: location.href,
              title: document.title,
              metaDescription: '',
              headings: [],
              textContent: '',
              forms: [],
              tables: [],
              links: [],
              images: []
            };
            
            // meta description
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) result.metaDescription = metaDesc.getAttribute('content') || '';
            
            // headings
            document.querySelectorAll('h1, h2, h3').forEach((h, i) => {
              if (i < 20) result.headings.push(h.tagName.toLowerCase() + ': ' + h.textContent.trim().substring(0, 100));
            });
            
            // text content - 取 body 的文本，去除 script/style
            const clone = document.body.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, svg, iframe').forEach(el => el.remove());
            result.textContent = clone.textContent.replace(/\\s+/g, ' ').trim().substring(0, ${contentLimit});
            
            // forms
            document.querySelectorAll('form').forEach((form, i) => {
              if (i >= 3) return;
              const fields = [];
              form.querySelectorAll('input, select, textarea').forEach((field, j) => {
                if (j >= 10) return;
                fields.push({
                  tag: field.tagName.toLowerCase(),
                  type: field.type || '',
                  name: field.name || '',
                  placeholder: field.placeholder || ''
                });
              });
              result.forms.push({ action: form.action || '', fields });
            });
            
            // tables
            document.querySelectorAll('table').forEach((table, i) => {
              if (i >= 3) return;
              const headers = [];
              table.querySelectorAll('th').forEach((th, j) => {
                if (j < 10) headers.push(th.textContent.trim().substring(0, 50));
              });
              result.tables.push({ headers, rowCount: table.querySelectorAll('tr').length });
            });
            
            // links
            document.querySelectorAll('a[href]').forEach((a, i) => {
              if (i >= 15) return;
              const text = a.textContent.trim().substring(0, 50);
              if (text) result.links.push({ text, href: a.href });
            });

            // images - 提取页面中有效的图片 URL（过滤追踪像素和 SVG 图标）
            const imageUrls = new Set();
            document.querySelectorAll('img').forEach(img => {
              const src = img.currentSrc || img.src || img.dataset.src || img.dataset.lazy || img.dataset.original || '';
              if (!src || src.startsWith('data:') || src === 'about:blank') return;
              const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0');
              const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0');
              // 过滤追踪像素（宽高均小于 10）
              if (w > 0 && h > 0 && w < 10 && h < 10) return;
              imageUrls.add(src);
            });
            // 兜底：提取 CSS background-image 中的 URL
            if (imageUrls.size < 5) {
              document.querySelectorAll('[style*="background-image"]').forEach(el => {
                const match = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
                if (match && match[1] && !match[1].startsWith('data:')) imageUrls.add(match[1]);
              });
            }
            result.images = Array.from(imageUrls).slice(0, 20);
            
            return result;
          } catch(e) {
            return { error: e.message };
          }
        })()
      `

      const pageData = await this.browserView.webContents.executeJavaScript(code)

      // 检查页面脚本执行是否有错误
      if (pageData.error) {
        console.error('[BrowserViewManager] getPageContent 页面脚本错误:', pageData.error)
        return { success: false, error: pageData.error }
      }

      console.log('[BrowserViewManager] getPageContent 成功提取页面内容')
      return {
        success: true,
        data: {
          active: true,
          ...pageData
        }
      }
    } catch (error) {
      console.error('[BrowserViewManager] getPageContent 失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 截图
   * @param {Object} params - 截图参数
   */
  async screenshot(params = {}) {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      const image = await this.browserView.webContents.capturePage()
      const { filename = `screenshot-${Date.now()}.png` } = typeof params === 'object' ? params : {}

      // 保存截图文件到 ~/.folio/screenshots/
      const screenshotDir = path.join(process.env.HOME || '', '.folio', 'screenshots')
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true })
      }
      const filepath = path.join(screenshotDir, filename)
      fs.writeFileSync(filepath, image.toPNG())

      console.log(`[BrowserViewManager] 截图已保存: ${filepath}`)
      return {
        success: true,
        data: {
          image: image.toDataURL(),
          filename,
          filepath
        }
      }
    } catch (error) {
      console.error('[BrowserViewManager] 截图失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 刷新当前页面
   */
  async reload() {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      this.browserView.webContents.reload()
      return { success: true }
    } catch (error) {
      console.error('[BrowserViewManager] 刷新失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 后退
   */
  async goBack() {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      if (this.browserView.webContents.canGoBack()) {
        this.browserView.webContents.goBack()
        return { success: true }
      }
      return { success: false, error: '无法后退' }
    } catch (error) {
      return { success: false, error: '无法后退' }
    }
  }

  /**
   * 前进
   */
  async goForward() {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }

    try {
      if (this.browserView.webContents.canGoForward()) {
        this.browserView.webContents.goForward()
        return { success: true }
      }
      return { success: false, error: '无法前进' }
    } catch (error) {
      return { success: false, error: '无法前进' }
    }
  }

  /**
   * 在 BrowserView 页面中执行 JavaScript 代码
   * @param {string} code - 要执行的 JS 代码
   * @returns {Promise<{success: boolean, data?: any, error?: string}>}
   */
  async executeScript(code) {
    if (!this.browserView) {
      return { success: false, error: 'BrowserView 未创建' }
    }
    console.log('[BrowserViewManager] executeScript 调用:', code.substring(0, 100))
    try {
      const result = await this.browserView.webContents.executeJavaScript(code)
      return { success: true, data: result }
    } catch (error) {
      console.error('[BrowserViewManager] executeScript 失败:', error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 检查浏览器是否已启动
   */
  isReady() {
    return !!this.browserView && !this.browserView.webContents?.isDestroyed()
  }

  /**
   * 通知前端切换面板模式
   * @param {string} mode - 'browser' | 'terminal'
   */
  notifyFrontend(mode) {
    const win = this.mainWindow
    if (win && !win.isDestroyed()) {
      win.webContents.send('browser:switchMode', mode)
    }
  }

  /**
   * 弹出独立窗口
   */
  async popOut() {
    if (!this.browserView || this.isPoppedOut) return { success: false, error: '无法弹出' }

    const currentURL = this.browserView.webContents.getURL()

    // 从主窗口移除 BrowserView
    this.mainWindow.removeBrowserView(this.browserView)
    this.browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })

    // 创建独立窗口
    this.popOutWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'AI Browser',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    this.popOutWindow.addBrowserView(this.browserView)
    const [w, h] = this.popOutWindow.getContentSize()
    this.browserView.setBounds({ x: 0, y: 0, width: w, height: h })

    this.isPoppedOut = true
    this.isVisible = false

    // 独立窗口 resize 时同步 BrowserView 大小
    this.popOutWindow.on('resize', () => {
      if (this.popOutWindow && this.browserView) {
        const [nw, nh] = this.popOutWindow.getContentSize()
        this.browserView.setBounds({ x: 0, y: 0, width: nw, height: nh })
      }
    })

    // 监听独立窗口关闭 → 自动收回（重建 BrowserView）
    this.popOutWindow.on('closed', () => {
      this.popOutWindow = null
      this.isPoppedOut = false
      // 旧 BrowserView 随窗口销毁，重新创建
      this.browserView = null
      this.attach()
      // 通知前端刷新状态
      this.notifyFrontend('browser')
    })

    console.log('[BrowserViewManager] 已弹出独立窗口')
    return { success: true }
  }

  /**
   * 从独立窗口收回到右侧面板
   */
  async popIn() {
    if (!this.isPoppedOut || !this.popOutWindow) return { success: false, error: '未处于弹出状态' }

    // 从独立窗口移除 BrowserView
    this.popOutWindow.removeBrowserView(this.browserView)
    this.popOutWindow.close()
    this.popOutWindow = null
    this.isPoppedOut = false

    // 重新附加到主窗口
    this.mainWindow.addBrowserView(this.browserView)
    this.setBounds(this.currentBounds)
    this.show()

    console.log('[BrowserViewManager] 已收回到右侧面板')
    return { success: true }
  }

  /**
   * 销毁 BrowserView
   */
  destroy() {
    if (this.popOutWindow) {
      this.popOutWindow.close()
      this.popOutWindow = null
    }
    this.isPoppedOut = false

    if (this.browserView) {
      try {
        if (!this.browserView.webContents?.isDestroyed()) {
          this.mainWindow.removeBrowserView(this.browserView)
          this.browserView.webContents.destroy()
        }
      } catch (err) {
        console.warn('[BrowserViewManager] destroy 时忽略错误:', err.message)
      }
      this.browserView = null
    }
    this.isVisible = false
    console.log('[BrowserViewManager] BrowserView 已销毁')
  }
}

module.exports = BrowserViewManager
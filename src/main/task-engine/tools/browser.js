const path = require('path')
const fs = require('fs').promises

/**
 * 浏览器自动化工具（BrowserView 版）
 * 通过 Electron BrowserView 的 webContents API 实现，替代 Puppeteer
 *
 * === 能力 ===
 * - 页面感知：getInteractiveElements / getPageStructure
 * - 日志捕获：console 环形缓冲 + getConsoleLogs / getNetworkLogs
 * - 智能操作：smartClick / smartType / smartSelect（按文本/label 定位）
 */

class BrowserTool {
  constructor() {
    this.name = 'browser'
    this._manager = null // BrowserViewManager 引用
    this.screenshotDir = path.join(__dirname, '..', '..', '..', '..', 'screenshots')
    this._ensureScreenshotDir()

    // === 日志环形缓冲区 ===
    this._consoleLogs = []
    this._consoleMaxSize = 200
    this._networkLogs = []
    this._networkMaxSize = 150
    this._listenersAttached = false
  }

  async _ensureScreenshotDir() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true })
    } catch (e) {
      // 忽略错误
    }
  }

  /**
   * 注入 BrowserViewManager
   */
  setManager(bvm) {
    this._manager = bvm
  }

  /**
   * 获取 BrowserViewManager
   */
  get manager() {
    return this._manager
  }

  /**
   * 获取 webContents（核心访问点）
   */
  get webContents() {
    return this._manager?.browserView?.webContents
  }

  /**
   * 自动确保 BrowserView 已创建并通知前端切换
   */
  async _ensureReady() {
    if (!this._manager) throw new Error('BrowserViewManager 未初始化')
    if (!this._manager.isReady()) await this._manager.attach()
    this._manager.show()
    this._manager.notifyFrontend('browser')
    this._setupListeners()
  }

  // ═══════════════════════════════════════════
  //  日志基础设施
  // ═══════════════════════════════════════════

  /**
   * 为 webContents 注册 console 监听器（幂等）
   */
  _setupListeners() {
    const wc = this.webContents
    if (!wc || this._listenersAttached) return

    this._onConsoleMessage = (_event, level, message, line, sourceId) => {
      const typeMap = { 0: 'log', 1: 'warn', 2: 'error' }
      const entry = {
        type: typeMap[level] || 'log',
        text: message,
        timestamp: Date.now(),
        url: sourceId || '',
        lineNumber: line || 0
      }
      this._consoleLogs.push(entry)
      if (this._consoleLogs.length > this._consoleMaxSize) {
        this._consoleLogs.shift()
      }
    }

    wc.on('console-message', this._onConsoleMessage)
    this._listenersAttached = true
  }

  /**
   * 移除监听器
   */
  _removeListeners() {
    const wc = this.webContents
    if (!wc || !this._listenersAttached) return
    if (this._onConsoleMessage) wc.off('console-message', this._onConsoleMessage)
    this._listenersAttached = false
  }

  /**
   * 清空日志缓冲区
   */
  _clearLogBuffers() {
    this._consoleLogs = []
    this._networkLogs = []
  }

  // ═══════════════════════════════════════════
  //  基础操作
  // ═══════════════════════════════════════════

  /**
   * 启动浏览器（确保 BrowserView 就绪）
   */
  async launch(options = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      console.log('[BrowserTool] BrowserView 模式，跳过 Puppeteer 启动')
      return {
        success: true,
        data: { mode: 'browserview', message: 'Using embedded BrowserView' },
        needConfirm: false
      }
    }
    // 原有逻辑
    try {
      await this._ensureReady()
      return {
        success: true,
        data: { message: '浏览器已就绪（BrowserView 模式）' },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 关闭浏览器（隐藏 BrowserView，不销毁）
   */
  async close() {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      console.log('[BrowserTool] BrowserView 模式，跳过浏览器关闭')
      return {
        success: true,
        data: { mode: 'browserview', message: 'BrowserView kept alive' },
        needConfirm: false
      }
    }
    // 原有逻辑
    try {
      this._removeListeners()
      this._clearLogBuffers()
      if (this._manager) {
        this._manager.hide()
      }
      return {
        success: true,
        data: { message: '浏览器已隐藏' },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 访问 URL
   */
  async goto(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { url } = typeof params === 'object' ? params : { url: params }
      console.log('[BrowserTool] goto via BrowserView:', url)
      const result = await this.manager.navigate(url)
      if (result.success) {
        // 等待页面加载
        await new Promise(r => setTimeout(r, 1500))
      }
      return { ...result, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { url } = typeof params === 'object' ? params : { url: params }

      await this._ensureReady()

      // 导航前清空日志
      this._clearLogBuffers()

      await this._manager.navigate(url)

      // 等待页面基本加载
      await this._waitForLoad(10000)

      return {
        success: true,
        data: { url, title: this.webContents.getTitle() },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 截图
   */
  async screenshot(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      console.log('[BrowserTool] screenshot via BrowserView')
      const res = await this.manager.screenshot(params || {})
      return { ...res, needConfirm: false }
    }
    // 原有逻辑
    try {
      const {
        fullPage = false,
        selector,
        filename = `screenshot-${Date.now()}.png`
      } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      const image = await this.webContents.capturePage()
      const filepath = path.join(this.screenshotDir, filename)
      const buffer = image.toPNG()
      await fs.writeFile(filepath, buffer)

      return {
        success: true,
        data: { filepath, filename, fullPage },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 使用 Puppeteer page.pdf() 直接导出当前页面为 PDF 文件
   * 绕过浏览器打印对话框，适用于页面下载按钮触发 window.print() 的场景
   */
  async savePdf(params = {}) {
    try {
      const {
        filename = `export-${Date.now()}.pdf`,
        printBackground = true,
        format = 'A4',
        margin = { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }
      } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      if (!this.page) {
        return { success: false, error: '浏览器页面未初始化', needConfirm: false }
      }

      await this._ensureScreenshotDir()
      const filepath = path.join(this.screenshotDir, filename)

      await this.page.pdf({
        path: filepath,
        printBackground,
        format,
        margin
      })

      return {
        success: true,
        data: { filepath, filename, format },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 点击元素
   */
  async click(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { selector } = typeof params === 'object' ? params : { selector: params }
      const safeSelector = selector.replace(/'/g, "\\'")
      const script = `
        (function() {
          const el = document.querySelector('${safeSelector}');
          if (el) { el.click(); return { clicked: true, text: el.textContent?.trim()?.substring(0, 50) }; }
          return { clicked: false, error: 'Element not found: ${safeSelector}' };
        })()
      `
      const result = await this.manager.executeScript(script)
      if (result.success && result.data?.clicked) {
        return { success: true, data: result.data, needConfirm: false }
      }
      return { success: false, error: result.data?.error || result.error || 'Click failed', needConfirm: false }
    }
    // 原有逻辑
    try {
      const { selector, text, xpath } = typeof params === 'object' ? params : { selector: params }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() {
          let el = null;
          ${selector ? `el = document.querySelector(${JSON.stringify(selector)});` : ''}
          ${text ? `
          if (!el) {
            const xpathExpr = "//*[contains(text(), ${JSON.stringify(text).replace(/"/g, "'")})]";
            const xResult = document.evaluate(xpathExpr, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            el = xResult.singleNodeValue;
          }` : ''}
          ${xpath ? `
          if (!el) {
            const xResult = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            el = xResult.singleNodeValue;
          }` : ''}
          if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            el.click();
            return { clicked: true };
          }
          return { clicked: false };
        })()
      `)

      if (!result.clicked) {
        return {
          success: false,
          error: `未找到元素: ${selector || text || xpath}`,
          needConfirm: false
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500))

      return {
        success: true,
        data: { clicked: selector || text || xpath },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 输入文本
   */
  async type(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { selector, text } = typeof params === 'object' ? params : { text: params }
      if (!selector) {
        return { success: false, error: '需要指定 selector 参数', needConfirm: false }
      }
      const safeSelector = selector.replace(/'/g, "\\'")
      const safeText = text.replace(/'/g, "\\'").replace(/\n/g, '\\n')
      const script = `
        (function() {
          const el = document.querySelector('${safeSelector}');
          if (el) {
            el.focus();
            el.value = '${safeText}';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { typed: true, selector: '${safeSelector}' };
          }
          return { typed: false, error: 'Element not found: ${safeSelector}' };
        })()
      `
      const result = await this.manager.executeScript(script)
      if (result.success && result.data?.typed) {
        return { success: true, data: result.data, needConfirm: false }
      }
      return { success: false, error: result.data?.error || result.error || 'Type failed', needConfirm: false }
    }
    // 原有逻辑
    try {
      const { selector, text, clear = true } = typeof params === 'object' ? params : { text: params }

      if (!selector) {
        return { success: false, error: '需要指定 selector 参数', needConfirm: false }
      }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { found: false };
          el.focus();
          ${clear ? `el.value = '';` : ''}
          el.value += ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true };
        })()
      `)

      if (!result.found) {
        return {
          success: false,
          error: `未找到元素: ${selector}`,
          needConfirm: false
        }
      }

      return {
        success: true,
        data: { typed: text, into: selector },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 等待元素出现（轮询实现）
   */
  async waitForSelector(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { selector, timeout = 5000 } = typeof params === 'object' ? params : { selector: params }
      const maxWait = timeout || 5000
      const interval = 200
      let elapsed = 0
      while (elapsed < maxWait) {
        const result = await this.manager.executeScript(`!!document.querySelector('${selector.replace(/'/g, "\\'")}')`)
        if (result.success && result.data) {
          return { success: true, data: { selector, found: true }, needConfirm: false }
        }
        await new Promise(r => setTimeout(r, interval))
        elapsed += interval
      }
      return { success: false, error: `Timeout waiting for selector: ${selector}`, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { selector, timeout = 5000 } = typeof params === 'object' ? params : { selector: params }

      await this._ensureReady()

      const pollInterval = 200
      const startTime = Date.now()

      while (Date.now() - startTime < timeout) {
        const found = await this.webContents.executeJavaScript(`
          !!document.querySelector(${JSON.stringify(selector)})
        `)
        if (found) {
          return { success: true, data: { found: selector }, needConfirm: false }
        }
        await new Promise(r => setTimeout(r, pollInterval))
      }

      return {
        success: false,
        error: `等待元素超时: ${selector}`,
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 等待页面上出现包含指定文本的元素
   */
  async waitForText(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { text, timeout = 120000, pollInterval = 2000 } = typeof params === 'object' ? params : { text: params }
      if (!text) {
        return { success: false, error: '需要指定 text 参数', needConfirm: false }
      }
      const maxWait = timeout || 120000
      const interval = pollInterval || 2000
      let elapsed = 0
      while (elapsed < maxWait) {
        const safeText = text.replace(/'/g, "\\'").replace(/"/g, '\\"')
        const result = await this.manager.executeScript(`document.body.innerText.includes("${safeText}")`)
        if (result.success && result.data) {
          return { success: true, data: { text, found: true, waitedMs: elapsed }, needConfirm: false }
        }
        await new Promise(r => setTimeout(r, interval))
        elapsed += interval
      }
      return { success: false, error: `Timeout waiting for text: ${text}`, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { text, timeout = 120000, pollInterval = 2000 } = typeof params === 'object' ? params : { text: params }

      if (!text) {
        return { success: false, error: '需要指定 text 参数', needConfirm: false }
      }

      await this._ensureReady()

      const startTime = Date.now()
      while (Date.now() - startTime < timeout) {
        const found = await this.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector('body');
            return el && el.innerText && el.innerText.includes(${JSON.stringify(text)});
          })()
        `)

        if (found) {
          return {
            success: true,
            data: { text, waitedMs: Date.now() - startTime },
            needConfirm: false
          }
        }
        await new Promise(r => setTimeout(r, pollInterval))
      }

      return {
        success: false,
        error: `等待文本 "${text}" 超时（${timeout / 1000}秒）`,
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 等待页面导航完成
   */
  async waitForNavigation(params = {}) {
    try {
      const { timeout = 60000 } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      await this._waitForLoad(timeout)

      return {
        success: true,
        data: {
          url: this.webContents.getURL(),
          title: this.webContents.getTitle()
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取页面内容
   */
  async getContent(params = {}) {
    try {
      const { selector, attribute } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      let data
      if (selector) {
        data = await this.webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            ${attribute ? `return el.getAttribute(${JSON.stringify(attribute)});` : 'return el.textContent;'}
          })()
        `)
        if (data === null) {
          return { success: false, error: `未找到元素: ${selector}`, needConfirm: false }
        }
      } else {
        data = await this.webContents.executeJavaScript(
          'document.documentElement.outerHTML'
        )
      }

      return {
        success: true,
        data: { content: data },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 执行 JavaScript
   */
  async evaluate(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { script } = typeof params === 'object' ? params : { script: params }
      const res = await this.manager.executeScript(script)
      return { ...res, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { script } = typeof params === 'object' ? params : { script: params }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() { ${script} })()
      `)

      return {
        success: true,
        data: { result },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取当前页面信息
   */
  async getInfo() {
    try {
      await this._ensureReady()

      return {
        success: true,
        data: {
          url: this.webContents.getURL(),
          title: this.webContents.getTitle()
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取当前页面完整状态（URL、标题、结构、内容摘要）
   * 用于 AI 分析当前页面
   */
  async getPageState(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { contentLimit = 2000 } = typeof params === 'object' ? params : {}
      const pageContent = await this.manager.getPageContent({ contentLimit })
      if (pageContent.success && pageContent.data) {
        return { success: true, data: pageContent.data, needConfirm: false }
      }
      return pageContent
    }
    // 原有逻辑
    try {
      const { includeContent = true, contentLimit = 2000 } = typeof params === 'object' ? params : {}

      // 检查 BrowserView 是否已就绪且有页面
      if (!this._manager || !this._manager.isReady() || !this.webContents) {
        return {
          success: true,
          data: {
            active: false,
            message: '当前没有打开的浏览器页面'
          },
          needConfirm: false
        }
      }

      const url = this.webContents.getURL()
      const title = this.webContents.getTitle()

      // 如果没有有效 URL（空白页）
      if (!url || url === 'about:blank') {
        return {
          success: true,
          data: {
            active: true,
            url: url || 'about:blank',
            title: title || '',
            message: '浏览器已打开但当前为空白页'
          },
          needConfirm: false
        }
      }

      const pageData = await this.webContents.executeJavaScript(`
        (function() {
          var result = {};

          // 标题层级结构
          var headings = [];
          document.querySelectorAll('h1, h2, h3, h4').forEach(function(h) {
            var text = (h.textContent || '').trim();
            if (text && text.length < 200) headings.push(h.tagName.toLowerCase() + ': ' + text.substring(0, 120));
          });
          result.headings = headings.slice(0, 30);

          // meta 信息
          var metaDesc = document.querySelector('meta[name="description"]');
          result.metaDescription = metaDesc ? (metaDesc.content || '').substring(0, 300) : '';

          // 主要文本内容摘要
          var mainEl = document.querySelector('main, [role="main"], article, .main-content, .content, #content, #app, .container');
          var textContent = '';
          if (mainEl) {
            var walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT, null);
            var texts = [];
            var charCount = 0;
            var limit = ${contentLimit};
            while (walker.nextNode() && charCount < limit) {
              var t = walker.currentNode.textContent.trim();
              if (t && t.length > 2) { texts.push(t); charCount += t.length; }
            }
            textContent = texts.join('\\n').substring(0, limit);
          } else {
            textContent = (document.body.innerText || '').substring(0, ${contentLimit});
          }
          result.textContent = textContent;

          // 导航信息
          var navLinks = [];
          var navEls = document.querySelectorAll('nav a, [role="navigation"] a, header a');
          navEls.forEach(function(a) {
            var t = (a.textContent || '').trim();
            if (t && t.length < 40 && navLinks.indexOf(t) === -1) navLinks.push(t);
          });
          result.navigation = navLinks.slice(0, 15);

          // 表单概览
          var forms = [];
          document.querySelectorAll('form').forEach(function(form) {
            var inputs = form.querySelectorAll('input, select, textarea');
            var fields = [];
            inputs.forEach(function(inp) {
              if (inp.type === 'hidden') return;
              fields.push({
                tag: inp.tagName.toLowerCase(),
                type: inp.type || '',
                name: inp.name || '',
                placeholder: inp.placeholder || '',
                value: (inp.value || '').substring(0, 50)
              });
            });
            if (fields.length > 0) forms.push({ action: form.action || '', fields: fields.slice(0, 20) });
          });
          result.forms = forms.slice(0, 5);

          // 表格概览
          var tables = [];
          document.querySelectorAll('table').forEach(function(table) {
            var headers = [];
            table.querySelectorAll('th').forEach(function(th) {
              var t = (th.textContent || '').trim();
              if (t) headers.push(t);
            });
            var rowCount = table.querySelectorAll('tbody tr').length || table.querySelectorAll('tr').length - 1;
            if (headers.length > 0) tables.push({ headers: headers.slice(0, 15), rowCount: Math.max(0, rowCount) });
          });
          result.tables = tables.slice(0, 5);

          // 告警/错误信息
          var alerts = [];
          var alertSels = ['[role="alert"]', '.alert', '.error', '.warning', '.notice', '.ant-alert', '.el-alert', '.message-error', '.toast'];
          document.querySelectorAll(alertSels.join(', ')).forEach(function(el) {
            var t = (el.textContent || '').trim();
            if (t && t.length < 300) alerts.push(t);
          });
          result.alerts = alerts.slice(0, 10);

          // 图片列表
          var images = [];
          document.querySelectorAll('img').forEach(function(img) {
            var alt = img.alt || '';
            var src = img.src || '';
            if (src && src.length < 200) images.push({ alt: alt.substring(0, 80), src: src });
          });
          result.images = images.slice(0, 10);

          return result;
        })()
      `)

      return {
        success: true,
        data: {
          active: true,
          url,
          title,
          ...pageData,
          timestamp: Date.now()
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 滚动页面
   */
  async scroll(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { direction = 'down', amount = 300 } = typeof params === 'object' ? params : {}
      const dir = direction || 'down'
      const amt = amount || 300
      const script = `
        (function() {
          if ('${dir}' === 'down') window.scrollBy(0, ${amt});
          else if ('${dir}' === 'up') window.scrollBy(0, -${amt});
          else if ('${dir}' === 'right') window.scrollBy(${amt}, 0);
          else if ('${dir}' === 'left') window.scrollBy(-${amt}, 0);
          else if ('${dir}' === 'bottom') window.scrollTo(0, document.body.scrollHeight);
          else if ('${dir}' === 'top') window.scrollTo(0, 0);
          return { scrolled: true, direction: '${dir}', amount: ${amt}, scrollY: window.scrollY };
        })()
      `
      const result = await this.manager.executeScript(script)
      return result.success ? { success: true, data: result.data, needConfirm: false } : { success: false, error: result.error, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { direction = 'down', amount = 500 } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      const scrollAmount = direction === 'up' ? -amount : amount
      await this.webContents.executeJavaScript(`window.scrollBy(0, ${scrollAmount})`)

      return {
        success: true,
        data: { direction, amount },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  // ═══════════════════════════════════════════
  //  日志查询方法
  // ═══════════════════════════════════════════

  /**
   * 获取浏览器 Console 日志
   */
  async getConsoleLogs(params = {}) {
    try {
      const { level = 'all', limit = 50, clear = false } = typeof params === 'object' ? params : {}

      let logs = [...this._consoleLogs]

      if (level === 'error') {
        logs = logs.filter(l => l.type === 'error')
      } else if (level === 'warn') {
        logs = logs.filter(l => l.type === 'warn' || l.type === 'error')
      }

      const result = logs.slice(-limit)

      if (clear) {
        this._consoleLogs = []
      }

      return {
        success: true,
        data: { logs: result, total: result.length, bufferSize: this._consoleLogs.length, level },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取网络请求日志（BrowserView 模式下能力有限，返回空）
   */
  async getNetworkLogs(params = {}) {
    try {
      const { filter = 'all', limit = 50, clear = false } = typeof params === 'object' ? params : {}

      let logs = [...this._networkLogs]

      if (filter === 'failed') {
        logs = logs.filter(l => l.failed || (l.status >= 400))
      } else if (filter === 'xhr') {
        logs = logs.filter(l => l.resourceType === 'xhr' || l.resourceType === 'fetch')
      }

      const result = logs.slice(-limit)

      if (clear) {
        this._networkLogs = []
      }

      return {
        success: true,
        data: { logs: result, total: result.length, bufferSize: this._networkLogs.length, filter },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  // ═══════════════════════════════════════════
  //  页面感知方法
  // ═══════════════════════════════════════════

  /**
   * 获取页面所有可交互元素
   */
  async getInteractiveElements(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const limit = (params && params.limit) || 50
      const script = `
        (function() {
          const elements = [];
          const selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [onclick], [contenteditable="true"]';
          document.querySelectorAll(selectors).forEach(function(el, i) {
            if (i >= ${limit}) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            elements.push({
              index: elements.length,
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              text: (el.textContent || el.value || '').trim().substring(0, 80),
              placeholder: el.placeholder || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              href: el.href || '',
              selector: el.id ? '#' + el.id : (el.className ? el.tagName.toLowerCase() + '.' + el.className.split(' ')[0] : el.tagName.toLowerCase())
            });
          });
          return elements;
        })()
      `
      const result = await this.manager.executeScript(script)
      return result.success ? { success: true, data: result.data, needConfirm: false } : { success: false, error: result.error, needConfirm: false }
    }
    // 原有逻辑
    try {
      const { viewport = true, filter = 'all' } = typeof params === 'object' ? params : {}

      await this._ensureReady()

      const data = await this.webContents.executeJavaScript(`
        (function() {
          const viewportOnly = ${viewport};
          const filterType = ${JSON.stringify(filter)};
          const vw = window.innerWidth;
          const vh = window.innerHeight;

          function buildSelector(el) {
            if (el.id) return '#' + CSS.escape(el.id);
            if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
            if (el.name && ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())) {
              return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
            }
            const parts = [];
            let current = el;
            for (let depth = 0; depth < 3 && current && current !== document.body; depth++) {
              const parent = current.parentElement;
              if (!parent) break;
              const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
              if (siblings.length > 1) {
                const idx = siblings.indexOf(current) + 1;
                parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
              } else {
                parts.unshift(current.tagName.toLowerCase());
              }
              current = parent;
            }
            return parts.join(' > ') || el.tagName.toLowerCase();
          }

          function isVisible(el) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            return true;
          }

          function isInViewport(el) {
            const rect = el.getBoundingClientRect();
            return rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0;
          }

          const selectors = [
            'button', 'a[href]', 'input', 'select', 'textarea',
            '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
            '[onclick]', '[tabindex]:not([tabindex="-1"])'
          ];

          const seen = new Set();
          const elements = [];
          const MAX_ELEMENTS = 100;

          for (const sel of selectors) {
            if (elements.length >= MAX_ELEMENTS) break;
            const nodes = document.querySelectorAll(sel);
            for (const el of nodes) {
              if (elements.length >= MAX_ELEMENTS) break;
              if (seen.has(el)) continue;
              seen.add(el);

              if (!isVisible(el)) continue;
              if (viewportOnly && !isInViewport(el)) continue;

              const tag = el.tagName.toLowerCase();

              if (filterType === 'button' && !['button', 'a'].includes(tag) && el.getAttribute('role') !== 'button') continue;
              if (filterType === 'input' && !['input', 'select', 'textarea'].includes(tag)) continue;
              if (filterType === 'link' && tag !== 'a') continue;

              const info = {
                index: elements.length,
                tag,
                text: (el.textContent || '').trim().substring(0, 80),
                selector: buildSelector(el),
                visible: true
              };

              if (tag === 'a') info.href = el.getAttribute('href') || '';
              if (tag === 'input') {
                info.type = el.type || 'text';
                info.placeholder = el.placeholder || '';
                info.name = el.name || '';
                info.value = el.value || '';
              }
              if (tag === 'select') {
                info.name = el.name || '';
                info.options = Array.from(el.options).map(o => o.text).slice(0, 20);
                info.value = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
              }
              if (tag === 'textarea') {
                info.placeholder = el.placeholder || '';
                info.name = el.name || '';
                info.value = (el.value || '').substring(0, 200);
              }
              if (tag === 'button' || el.getAttribute('role') === 'button') {
                info.role = 'button';
                info.disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
              }

              const ariaLabel = el.getAttribute('aria-label');
              if (ariaLabel) info.ariaLabel = ariaLabel;
              const title = el.getAttribute('title');
              if (title) info.title = title;

              elements.push(info);
            }
          }

          // 表单分组
          const forms = [];
          document.querySelectorAll('form').forEach(function(form) {
            const fieldIndices = [];
            elements.forEach(function(el, i) {
              if (['input', 'select', 'textarea'].includes(el.tag)) {
                const domEl = document.querySelector(el.selector);
                if (domEl && form.contains(domEl)) fieldIndices.push(i);
              }
            });
            if (fieldIndices.length > 0) {
              forms.push({
                action: form.action || '',
                method: (form.method || 'GET').toUpperCase(),
                fields: fieldIndices
              });
            }
          });

          return { elements, forms, totalFound: seen.size, truncated: seen.size > MAX_ELEMENTS };
        })()
      `)

      return {
        success: true,
        data: {
          url: this.webContents.getURL(),
          title: this.webContents.getTitle(),
          elements: data.elements,
          forms: data.forms,
          totalElements: data.elements.length,
          truncated: data.truncated,
          timestamp: Date.now()
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取页面语义化结构概览
   */
  async getPageStructure(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const pageContent = await this.manager.getPageContent({ contentLimit: 1000 })
      if (pageContent.success && pageContent.data) {
        return { success: true, data: pageContent.data, needConfirm: false }
      }
      return pageContent
    }
    // 原有逻辑
    try {
      await this._ensureReady()

      const data = await this.webContents.executeJavaScript(`
        (function() {
          const headings = [];
          document.querySelectorAll('h1, h2, h3').forEach(function(h) {
            const text = (h.textContent || '').trim();
            if (text) headings.push(h.tagName.toLowerCase() + ': ' + text.substring(0, 100));
          });

          const navigation = [];
          const navEls = document.querySelectorAll('nav a, [role="navigation"] a, .nav a, .menu a, .sidebar a');
          navEls.forEach(function(a) {
            const text = (a.textContent || '').trim();
            if (text && text.length < 30 && !navigation.includes(text)) navigation.push(text);
          });

          let mainContent = '';
          const mainEl = document.querySelector('main, [role="main"], .main-content, .content, #content, #app');
          if (mainEl) {
            const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_TEXT, null);
            const texts = [];
            let charCount = 0;
            while (walker.nextNode() && charCount < 500) {
              const text = walker.currentNode.textContent.trim();
              if (text && text.length > 2) { texts.push(text); charCount += text.length; }
            }
            mainContent = texts.join('\\n').substring(0, 500);
          }

          const alerts = [];
          const alertSels = ['[role="alert"]', '.alert', '.error', '.warning', '.notice', '.ant-alert', '.el-alert', '.message-error', '.toast'];
          document.querySelectorAll(alertSels.join(', ')).forEach(function(el) {
            const text = (el.textContent || '').trim();
            if (text && text.length < 200) alerts.push(text);
          });

          const tables = [];
          document.querySelectorAll('table').forEach(function(table) {
            const headers = [];
            table.querySelectorAll('th').forEach(function(th) {
              const text = (th.textContent || '').trim();
              if (text) headers.push(text);
            });
            const rowCount = table.querySelectorAll('tbody tr').length || table.querySelectorAll('tr').length - 1;
            if (headers.length > 0) tables.push({ headers: headers.slice(0, 10), rowCount: Math.max(0, rowCount) });
          });

          return { headings, navigation: navigation.slice(0, 20), mainContent, alerts, tables: tables.slice(0, 5) };
        })()
      `)

      return {
        success: true,
        data: {
          url: this.webContents.getURL(),
          title: this.webContents.getTitle(),
          ...data,
          timestamp: Date.now()
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  // ═══════════════════════════════════════════
  //  智能操作方法
  // ═══════════════════════════════════════════

  /**
   * 按文本内容智能定位并点击元素
   */
  async smartClick(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { text, role } = typeof params === 'object' ? params : { text: params }
      console.log('[BrowserTool] smartClick via BrowserView:', { text, role })
      if (!text) {
        return { success: false, error: '需要指定 text 参数', needConfirm: false }
      }
      const safeText = text.replace(/'/g, "\\'").replace(/"/g, '\\"')
      const safeRole = (role || '').replace(/'/g, "\\'")
      const script = `
        (function() {
          const text = "${safeText}";
          const role = "${safeRole}";
          const allElements = Array.from(document.querySelectorAll('a, button, [role="button"], [role="link"], [role="tab"], input[type="submit"], input[type="button"], [onclick], [class*="btn"], [class*="click"]'));
          
          // 过滤可见元素
          const visibleElements = allElements.filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0;
          });
          
          let target = null;
          let matchType = '';
          let candidates = [];
          
          // 1. 精确文本匹配
          target = visibleElements.find(el => {
            const elText = (el.textContent || el.value || '').trim();
            return elText === text;
          });
          if (target) matchType = 'exact';
          
          // 2. 包含文本匹配（双向）
          if (!target) {
            target = visibleElements.find(el => {
              const elText = (el.textContent || el.value || '').trim();
              return elText.includes(text) || text.includes(elText);
            });
            if (target) matchType = 'includes';
          }
          
          // 3. 模糊匹配：编辑距离 <= 2 或包含关键分词
          if (!target) {
            // 计算编辑距离
            const levenshtein = (a, b) => {
              const matrix = [];
              for (let i = 0; i <= b.length; i++) matrix[i] = [i];
              for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
              for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                  if (b.charAt(i-1) === a.charAt(j-1)) {
                    matrix[i][j] = matrix[i-1][j-1];
                  } else {
                    matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, matrix[i][j-1] + 1, matrix[i-1][j] + 1);
                  }
                }
              }
              return matrix[b.length][a.length];
            };
            
            const candidates_with_distance = visibleElements
              .map(el => {
                const elText = (el.textContent || el.value || '').trim();
                if (!elText || elText.length < 2) return null;
                const distance = levenshtein(text, elText);
                const maxLen = Math.max(text.length, elText.length);
                const similarity = 1 - distance / maxLen;
                return { el, elText, distance, similarity };
              })
              .filter(c => c && c.distance <= 3 && c.similarity >= 0.6)
              .sort((a, b) => b.similarity - a.similarity);
            
            if (candidates_with_distance.length > 0) {
              target = candidates_with_distance[0].el;
              matchType = 'fuzzy';
              candidates = candidates_with_distance.slice(0, 5).map(c => ({
                text: c.elText,
                similarity: c.similarity.toFixed(2),
                tag: c.el.tagName
              }));
            }
          }
          
          // 4. aria-label / title / placeholder 匹配
          if (!target) {
            target = visibleElements.find(el => {
              return (el.getAttribute('aria-label') || '').includes(text) ||
                     (el.getAttribute('title') || '').includes(text) ||
                     (el.getAttribute('placeholder') || '').includes(text);
            });
            if (target) matchType = 'attribute';
          }
          
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.click();
            return { 
              clicked: true, 
              text: (target.textContent || target.value || '').trim().substring(0, 80), 
              tag: target.tagName,
              matchType,
              candidates: candidates.length > 0 ? candidates : undefined
            };
          }
          
          // 未找到，返回候选列表帮助调试
          const topCandidates = visibleElements
            .map(el => {
              const elText = (el.textContent || el.value || '').trim();
              return elText ? elText.substring(0, 80) : null;
            })
            .filter(t => t && t.length > 0)
            .slice(0, 10);
          
          return { 
            clicked: false, 
            error: '未找到匹配的元素: ' + text,
            topCandidates
          };
        })()
      `
      const result = await this.manager.executeScript(script)
      if (result.success && result.data?.clicked) {
        const { matchType, candidates, text: actualText } = result.data
        
        // 如果是模糊匹配，记录警告信息
        if (matchType === 'fuzzy' && candidates && candidates.length > 0) {
          console.warn('[BrowserTool] 使用模糊匹配点击:', {
            searchText: text,
            actualText,
            similarity: candidates[0].similarity,
            candidates: candidates.slice(0, 3)
          })
        }
        
        return { 
          success: true, 
          data: result.data, 
          needConfirm: false,
          matchType,
          warning: matchType === 'fuzzy' ? `实际点击的是"${actualText}"（与搜索词"${text}"相似度 ${candidates[0].similarity}）` : undefined
        }
      }
      
      // 点击失败，返回候选列表帮助调试
      if (result.data?.topCandidates) {
        return { 
          success: false, 
          error: `未找到包含"${text}"的按钮`,
          needConfirm: false,
          topCandidates: result.data.topCandidates,
          suggestion: '请检查页面上是否有其他相似名称的按钮'
        }
      }
      
      return { success: false, error: result.data?.error || result.error || 'Smart click failed', needConfirm: false }
    }
    // 原有逻辑
    try {
      const { text, role, index = 0, waitAfter = 500 } = typeof params === 'object' ? params : { text: params }

      if (!text) {
        return { success: false, error: '需要指定 text 参数', needConfirm: false }
      }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() {
          const text = ${JSON.stringify(text)};
          const role = ${JSON.stringify(role || null)};
          const index = ${index};

          function isVisible(el) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            return true;
          }

          function isClickable(el) {
            const tag = el.tagName.toLowerCase();
            if (['button', 'a', 'summary'].includes(tag)) return true;
            const r = el.getAttribute('role');
            if (['button', 'link', 'tab', 'menuitem'].includes(r)) return true;
            if (el.onclick || el.getAttribute('onclick')) return true;
            if (el.tabIndex >= 0) return true;
            if (window.getComputedStyle(el).cursor === 'pointer') return true;
            return false;
          }

          function matchesRole(el, role) {
            if (!role) return true;
            const tag = el.tagName.toLowerCase();
            const elRole = el.getAttribute('role');
            if (role === 'button') return tag === 'button' || elRole === 'button';
            if (role === 'link') return tag === 'a' || elRole === 'link';
            if (role === 'tab') return elRole === 'tab';
            return true;
          }

          const allEls = document.querySelectorAll('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"]), summary');
          const candidates = [];

          for (const el of allEls) {
            if (!isVisible(el) || !isClickable(el) || !matchesRole(el, role)) continue;
            const elText = (el.textContent || '').trim();
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';

            let priority = -1;
            if (elText === text) priority = 0;
            else if (elText.includes(text)) priority = 1;
            else if (ariaLabel === text || ariaLabel.includes(text)) priority = 2;
            else if (title === text || title.includes(text)) priority = 3;

            if (priority >= 0) {
              candidates.push({ el, priority, text: elText.substring(0, 80) });
            }
          }

          candidates.sort(function(a, b) { return a.priority - b.priority; });

          if (candidates.length === 0) {
            return { found: false, candidateCount: 0 };
          }

          const target = candidates[Math.min(index, candidates.length - 1)];
          target.el.scrollIntoView({ block: 'center', behavior: 'instant' });
          target.el.click();

          return { found: true, clicked: target.text, priority: target.priority, candidateCount: candidates.length };
        })()
      `)

      if (!result.found) {
        return {
          success: false,
          error: `未找到包含文本 "${text}" 的可点击元素`,
          needConfirm: false
        }
      }

      await new Promise(resolve => setTimeout(resolve, waitAfter))

      return {
        success: true,
        data: {
          clicked: result.clicked,
          matchType: ['exact', 'partial', 'aria-label', 'title'][result.priority],
          candidateCount: result.candidateCount
        },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 按 label/placeholder 智能定位输入框并输入文本
   */
  async smartType(params) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      const { label, text } = typeof params === 'object' ? params : {}
      if (!label || text === undefined) {
        return { success: false, error: '需要指定 label 和 text 参数', needConfirm: false }
      }
      const safeLabel = label.replace(/'/g, "\\'").replace(/"/g, '\\"')
      const safeText = text.replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/"/g, '\\"')
      const script = `
        (function() {
          const label = "${safeLabel}";
          const text = "${safeText}";
          const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
          
          let target = null;
          
          // 1. placeholder 匹配
          target = inputs.find(el => (el.placeholder || '').includes(label));
          
          // 2. aria-label 匹配
          if (!target) target = inputs.find(el => (el.getAttribute('aria-label') || '').includes(label));
          
          // 3. 关联 label 匹配
          if (!target) {
            const labels = Array.from(document.querySelectorAll('label'));
            const matchLabel = labels.find(l => l.textContent.includes(label));
            if (matchLabel && matchLabel.htmlFor) {
              target = document.getElementById(matchLabel.htmlFor);
            }
          }
          
          // 4. 前置文本匹配
          if (!target) {
            target = inputs.find(el => {
              const prev = el.previousElementSibling;
              return prev && prev.textContent && prev.textContent.includes(label);
            });
          }
          
          // 5. 如果只有一个输入框，直接使用
          if (!target && inputs.length === 1) {
            target = inputs[0];
          }
          
          if (target) {
            target.focus();
            if (target.getAttribute('contenteditable') === 'true') {
              target.innerText = text;
              target.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              target.value = text;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { typed: true, label: label, tag: target.tagName };
          }
          
          return { typed: false, error: 'No input found matching label: ' + label };
        })()
      `
      const result = await this.manager.executeScript(script)
      if (result.success && result.data?.typed) {
        return { success: true, data: result.data, needConfirm: false }
      }
      return { success: false, error: result.data?.error || result.error || 'Smart type failed', needConfirm: false }
    }
    // 原有逻辑
    try {
      const { label, text, clear = true } = typeof params === 'object' ? params : {}

      if (!label || text === undefined) {
        return { success: false, error: '需要指定 label 和 text 参数', needConfirm: false }
      }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() {
          const label = ${JSON.stringify(label)};
          const text = ${JSON.stringify(text)};
          const shouldClear = ${clear};

          function isVisible(el) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            return true;
          }

          const inputs = document.querySelectorAll('input, textarea');
          let best = null;
          let bestPriority = 999;

          for (const input of inputs) {
            if (!isVisible(input)) continue;
            if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') continue;

            // label 关联
            if (input.id) {
              const labelEl = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
              if (labelEl) {
                const labelText = (labelEl.textContent || '').trim();
                if (labelText === label && bestPriority > 0) { best = input; bestPriority = 0; }
                else if (labelText.includes(label) && bestPriority > 1) { best = input; bestPriority = 1; }
              }
            }
            const parentLabel = input.closest('label');
            if (parentLabel && bestPriority > 1) {
              const labelText = (parentLabel.textContent || '').trim();
              if (labelText.includes(label)) { best = input; bestPriority = 1; }
            }
            // placeholder
            if (bestPriority > 2 && input.placeholder) {
              if (input.placeholder === label || input.placeholder.includes(label)) { best = input; bestPriority = 2; }
            }
            // name
            if (bestPriority > 3 && input.name) {
              if (input.name === label || input.name.includes(label)) { best = input; bestPriority = 3; }
            }
            // aria-label
            if (bestPriority > 4) {
              const ariaLabel = input.getAttribute('aria-label') || '';
              if (ariaLabel === label || ariaLabel.includes(label)) { best = input; bestPriority = 4; }
            }
          }

          if (!best) return { found: false };

          best.focus();
          if (shouldClear) best.value = '';
          best.value += text;
          best.dispatchEvent(new Event('input', { bubbles: true }));
          best.dispatchEvent(new Event('change', { bubbles: true }));

          return { found: true, priority: bestPriority };
        })()
      `)

      if (!result.found) {
        return {
          success: false,
          error: `未找到 label/placeholder 包含 "${label}" 的输入框`,
          needConfirm: false
        }
      }

      return {
        success: true,
        data: { typed: text, label },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 按文本智能定位下拉框并选择选项
   */
  async smartSelect(params) {
    try {
      const { label, value } = typeof params === 'object' ? params : {}

      if (!label || !value) {
        return { success: false, error: '需要指定 label 和 value 参数', needConfirm: false }
      }

      await this._ensureReady()

      const result = await this.webContents.executeJavaScript(`
        (function() {
          const label = ${JSON.stringify(label)};
          const value = ${JSON.stringify(value)};

          function isVisible(el) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
            return true;
          }

          const selects = document.querySelectorAll('select');
          let target = null;

          for (const sel of selects) {
            if (!isVisible(sel)) continue;
            if (sel.id) {
              const labelEl = document.querySelector('label[for="' + CSS.escape(sel.id) + '"]');
              if (labelEl && (labelEl.textContent || '').trim().includes(label)) { target = sel; break; }
            }
            const parentLabel = sel.closest('label');
            if (parentLabel && (parentLabel.textContent || '').trim().includes(label)) { target = sel; break; }
            if (sel.name && (sel.name === label || sel.name.includes(label))) { target = sel; break; }
            const ariaLabel = sel.getAttribute('aria-label') || '';
            if (ariaLabel.includes(label)) { target = sel; break; }
          }

          if (!target) return { found: false };

          const options = Array.from(target.options);
          let matchedOption = options.find(function(o) { return o.text.trim() === value; });
          if (!matchedOption) matchedOption = options.find(function(o) { return o.text.trim().includes(value); });
          if (!matchedOption) matchedOption = options.find(function(o) { return o.value === value; });

          if (!matchedOption) {
            return { found: true, selected: false, availableOptions: options.map(function(o) { return o.text.trim(); }).slice(0, 20) };
          }

          target.value = matchedOption.value;
          target.dispatchEvent(new Event('change', { bubbles: true }));

          return { found: true, selected: true, selectedText: matchedOption.text.trim(), selectedValue: matchedOption.value };
        })()
      `)

      if (!result.found) {
        return { success: false, error: `未找到 label 包含 "${label}" 的下拉框`, needConfirm: false }
      }

      if (!result.selected) {
        return {
          success: false,
          error: `下拉框中未找到 "${value}"，可用选项: ${result.availableOptions.join(', ')}`,
          needConfirm: false
        }
      }

      return {
        success: true,
        data: { label, selected: result.selectedText, value: result.selectedValue },
        needConfirm: false
      }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  // ═══════════════════════════════════════════
  //  内部辅助方法
  // ═══════════════════════════════════════════

  /**
   * 等待页面加载完成（监听 did-finish-load 事件）
   */
  _waitForLoad(timeout = 10000) {
    const wc = this.webContents
    if (!wc) return Promise.resolve()

    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout)

      const onFinish = () => {
        clearTimeout(timer)
        resolve()
      }

      wc.once('did-finish-load', onFinish)
      wc.once('did-fail-load', onFinish)
    })
  }

  /**
   * 自动检测并关闭页面上的遮罩、浮层、新手引导、弹窗等
   */
  async dismissOverlay(params = {}) {
    // BrowserView 模式
    if (this.manager?.isReady()) {
      console.log('[BrowserTool] dismissOverlay via BrowserView')
      
      const script = `
        (function() {
          const dismissed = [];
          
          // 策略1：查找常见的关闭/跳过按钮并点击
          const closePatterns = ['×', '✕', '关闭', '跳过', '不再显示', '不再提醒', '下次再说', '我知道了', '知道了', '确定', '好的', 'OK', 'Got it', 'Skip', 'Close', 'Dismiss', 'Next', '下一步', '完成'];
          const allClickable = document.querySelectorAll('button, [role="button"], a, span, div[class*="close"], div[class*="skip"], i[class*="close"]');
          
          for (const el of allClickable) {
            const text = (el.textContent || '').trim();
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const combined = (text + ' ' + ariaLabel + ' ' + title).toLowerCase();
            
            // 检查是否匹配关闭模式
            const matched = closePatterns.some(p => combined.includes(p.toLowerCase()));
            if (matched) {
              // 确认元素在页面上可见
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                el.click();
                dismissed.push({ type: 'click', text: text.substring(0, 30), tag: el.tagName });
                break; // 每次只关闭一个
              }
            }
          }
          
          // 策略2：如果没找到关闭按钮，查找高 z-index 的遮罩层并尝试隐藏
          if (dismissed.length === 0) {
            const overlays = document.querySelectorAll('[class*="mask"], [class*="overlay"], [class*="modal-backdrop"], [class*="guide"], [class*="tour"], [class*="onboarding"], [class*="popover"]');
            for (const overlay of overlays) {
              const computed = window.getComputedStyle(overlay);
              const zIndex = parseInt(computed.zIndex) || 0;
              if (zIndex > 100 && computed.display !== 'none') {
                overlay.style.display = 'none';
                dismissed.push({ type: 'hide', className: (overlay.className || '').substring(0, 50), zIndex });
                break;
              }
            }
          }
          
          // 策略3：发送 ESC 键尝试关闭
          if (dismissed.length === 0) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            dismissed.push({ type: 'esc' });
          }
          
          return {
            dismissed: dismissed.length > 0,
            actions: dismissed
          };
        })()
      `
      
      try {
        const result = await this.manager.executeScript(script)
        if (result.success) {
          // 等待 DOM 更新
          await new Promise(resolve => setTimeout(resolve, 500))
          return { success: true, data: result.data, needConfirm: false }
        }
        return { success: false, error: result.error || '关闭遮罩失败', needConfirm: false }
      } catch (err) {
        return { success: false, error: err.message, needConfirm: false }
      }
    }
    
    // Puppeteer 模式（原有逻辑）
    try {
      await this._ensureReady()
      
      // 类似策略：先找关闭按钮，再尝试 ESC
      const result = await this.webContents.executeJavaScript(`
        (function() {
          const dismissed = [];
          
          // 策略1：查找常见的关闭/跳过按钮并点击
          const closePatterns = ['×', '✕', '关闭', '跳过', '不再显示', '不再提醒', '下次再说', '我知道了', '知道了', '确定', '好的', 'OK', 'Got it', 'Skip', 'Close', 'Dismiss', 'Next', '下一步', '完成'];
          const allClickable = document.querySelectorAll('button, [role="button"], a, span, div[class*="close"], div[class*="skip"], i[class*="close"]');
          
          for (const el of allClickable) {
            const text = (el.textContent || '').trim();
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const combined = (text + ' ' + ariaLabel + ' ' + title).toLowerCase();
            
            const matched = closePatterns.some(p => combined.includes(p.toLowerCase()));
            if (matched) {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
                el.click();
                dismissed.push({ type: 'click', text: text.substring(0, 30), tag: el.tagName });
                break;
              }
            }
          }
          
          // 策略2：隐藏高 z-index 遮罩层
          if (dismissed.length === 0) {
            const overlays = document.querySelectorAll('[class*="mask"], [class*="overlay"], [class*="modal-backdrop"], [class*="guide"], [class*="tour"], [class*="onboarding"], [class*="popover"]');
            for (const overlay of overlays) {
              const computed = window.getComputedStyle(overlay);
              const zIndex = parseInt(computed.zIndex) || 0;
              if (zIndex > 100 && computed.display !== 'none') {
                overlay.style.display = 'none';
                dismissed.push({ type: 'hide', className: (overlay.className || '').substring(0, 50), zIndex });
                break;
              }
            }
          }
          
          // 策略3：发送 ESC 键
          if (dismissed.length === 0) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            dismissed.push({ type: 'esc' });
          }
          
          return {
            dismissed: dismissed.length > 0,
            actions: dismissed
          };
        })()
      `)
      
      // 等待 DOM 更新
      await new Promise(resolve => setTimeout(resolve, 500))
      
      return { success: true, data: result, needConfirm: false }
    } catch (err) {
      return { success: false, error: err.message, needConfirm: false }
    }
  }
}

module.exports = new BrowserTool()

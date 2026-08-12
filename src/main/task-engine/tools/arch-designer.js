/**
 * 架构图设计器工具
 * 在应用启动时预启动 dev server，用户请求时直接在侧边栏浏览器中打开
 * 支持通过 JSON Schema 生成和编辑架构图
 */

const { spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const ARCH_DESIGNER_PORT = 3003
const ARCH_DESIGNER_URL = `http://localhost:${ARCH_DESIGNER_PORT}`
const ARCH_DESIGNER_DIR = path.join(__dirname, '..', '..', '..', '..', 'arch-designer')

/**
 * 检查 arch-designer dev server 是否已在运行
 */
function checkServerRunning() {
  return new Promise((resolve) => {
    const request = http.get(ARCH_DESIGNER_URL, (res) => {
      resolve(res.statusCode < 500)
      res.resume()
    })
    request.on('error', () => resolve(false))
    request.setTimeout(2000, () => {
      request.destroy()
      resolve(false)
    })
  })
}

class ArchDesignerTool {
  constructor() {
    this.name = 'arch-designer'
    this._manager = null
    this._devServerProcess = null
    this._serverReady = false
  }

  /**
   * 注入 BrowserViewManager
   */
  setManager(browserViewManager) {
    this._manager = browserViewManager
  }

  /**
   * 查找系统 Node.js 可执行文件路径
   * process.execPath 在 Electron 中指向 Electron 可执行文件，不能直接用
   */
  _findNodeBin() {
    const { execSync } = require('child_process')
    const candidates = [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node'
    ]
    
    // 优先使用已知路径
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    
    // 尝试通过 which 查找
    try {
      const result = execSync('which node', { encoding: 'utf8', timeout: 3000 }).trim()
      if (result && fs.existsSync(result)) return result
    } catch {
      // 忽略
    }
    
    // 最后回退到 process.execPath + ELECTRON_RUN_AS_NODE
    return process.execPath
  }

  /**
   * 应用启动时调用：预启动 dev server（后台静默启动，不阻塞主流程）
   */
  startDevServer() {
    // 检查 arch-designer 目录是否存在
    if (!fs.existsSync(ARCH_DESIGNER_DIR)) {
      console.warn('[ArchDesignerTool] arch-designer 目录不存在，跳过预启动:', ARCH_DESIGNER_DIR)
      return
    }

    const webpackCliEntry = path.join(ARCH_DESIGNER_DIR, 'node_modules', 'webpack-cli', 'bin', 'cli.js')
    if (!fs.existsSync(webpackCliEntry)) {
      console.warn('[ArchDesignerTool] webpack-cli 未安装，跳过预启动。请先在 arch-designer 目录执行 tnpm install')
      return
    }

    // 先检查是否已在运行
    checkServerRunning().then((isRunning) => {
      if (isRunning) {
        console.log('[ArchDesignerTool] dev server 已在运行')
        this._serverReady = true
        return
      }

      console.log('[ArchDesignerTool] 预启动 dev server...')

      // 先 kill 占用端口的残留进程
      try {
        const pids = execSync(`lsof -ti:${ARCH_DESIGNER_PORT}`, { encoding: 'utf8', timeout: 5000 }).trim()
        if (pids) {
          execSync(`kill -9 ${pids.split('\n').join(' ')}`, { timeout: 5000 })
          console.log('[ArchDesignerTool] 已清理端口', ARCH_DESIGNER_PORT, '上的残留进程:', pids)
        }
      } catch {
        // 没有进程占用端口，忽略
      }

      // 查找系统 Node.js 路径（process.execPath 在 Electron 中指向 Electron 可执行文件）
      const nodeBin = this._findNodeBin()
      console.log('[ArchDesignerTool] 使用 Node.js:', nodeBin)
      
      this._devServerProcess = spawn(nodeBin, [webpackCliEntry, 'serve'], {
        cwd: ARCH_DESIGNER_DIR,
        stdio: 'pipe',
        env: { ...process.env }
      })

      this._devServerProcess.stdout.on('data', (data) => {
        const message = data.toString().trim()
        if (message) console.log(`[ArchDesigner] ${message}`)
      })

      this._devServerProcess.stderr.on('data', (data) => {
        const message = data.toString().trim()
        if (message && !message.includes('WARNING')) {
          console.error(`[ArchDesigner] ${message}`)
        }
      })

      this._devServerProcess.on('error', (error) => {
        console.error('[ArchDesignerTool] dev server 启动失败:', error.message)
        this._devServerProcess = null
      })

      this._devServerProcess.on('exit', (code) => {
        console.log(`[ArchDesignerTool] dev server 退出，code: ${code}`)
        this._devServerProcess = null
        this._serverReady = false
      })

      // 后台轮询等待 server 就绪
      const pollReady = () => {
        checkServerRunning().then((ready) => {
          if (ready) {
            this._serverReady = true
            console.log('[ArchDesignerTool] dev server 预启动成功')
          } else if (this._devServerProcess) {
            setTimeout(pollReady, 2000)
          }
        })
      }
      setTimeout(pollReady, 3000) // 3 秒后开始检测
    })
  }

  /**
   * 在侧边栏浏览器中打开架构图编辑器
   */
  async open(params = {}) {
    try {
      console.log('[ArchDesignerTool] 打开架构图编辑器')

      const isRunning = await checkServerRunning()

      if (!isRunning) {
        return {
          success: false,
          error: '架构图编辑器 dev server 尚未就绪，请稍后重试。如果持续失败，请在终端手动执行: cd ai-terminal/arch-designer && npx webpack serve',
          needConfirm: false
        }
      }

      // 通过 BrowserViewManager 在侧边栏打开
      if (this._manager) {
        // 确保 BrowserView 已创建（首次使用时需要 attach）
        if (!this._manager.browserView) {
          await this._manager.attach()
        }
        await this._manager.show()
        await this._manager.navigate(ARCH_DESIGNER_URL)
        this._manager.notifyFrontend('browser')
        console.log('[ArchDesignerTool] 已在侧边栏浏览器中打开架构图编辑器')
      } else {
        console.warn('[ArchDesignerTool] BrowserViewManager 未注入，无法在侧边栏打开')
      }

      return {
        success: true,
        data: {
          url: ARCH_DESIGNER_URL,
          message: '架构图编辑器已在侧边栏浏览器中打开，可以在左侧 AI 输入框中输入架构描述来生成架构图'
        },
        needConfirm: false
      }
    } catch (error) {
      console.error('[ArchDesignerTool] 打开失败:', error.message)
      return {
        success: false,
        error: error.message,
        needConfirm: false
      }
    }
  }

  /**
   * 调用 AI 生成符合 ArchDesigner JSON Schema 规范的架构图数据
   * @param {object} params - 参数
   * @param {string} params.description - 用户的架构需求描述
   * @returns {Promise<object>} 包含生成的 ArchData JSON
   */
  async generate(params = {}) {
    const { description } = params
    if (!description || !description.trim()) {
      return { success: false, error: '请提供架构需求描述', needConfirm: false }
    }

    try {
      console.log('[ArchDesignerTool] AI 生成架构图数据:', description)

      const { callAI } = require('../../../shared/ai-client')

      const systemPrompt = `你是一个专业的架构设计助手。根据用户的需求描述，生成符合架构图编辑器规范的 JSON Schema 数据。

# JSON Schema 规范

## 顶层结构
{
  "title": "架构图标题",
  "layers": [...],
  "nodeEdges": [...],
  "externalModules": [...]
}

## Layer（分层）- 必填
{
  "id": "layer-{name}",
  "name": "业务展示层",
  "level": 0,
  "nodes": [...]
}

## Node（节点）- 必填
{
  "id": "admin-portal",
  "label": "客户管理后台",
  "status": "completed",
  "children": [...],
  "childFlow": ["child-1", "child-2"]
}

## ChildNode（子模块）- 可选
{
  "id": "user-list",
  "label": "用户列表",
  "status": "completed"
}

## NodeEdge（节点连线）- 可选
{
  "from": "admin-portal",
  "to": "react-core",
  "label": "基于"
}

## ExternalModule（外部模块）- 可选
{
  "id": "ext-api",
  "name": "后端 API",
  "description": "RESTful API 服务",
  "type": "api",
  "connectedTo": ["admin-portal"]
}

# 设计要求

1. 层级划分：3-5层为宜，从上到下：展示层 → 业务层 → 服务层 → 数据层，level 从0开始连续递增
2. 每层3-7个节点，节点名称2-8个字为宜
3. ID命名：Layer用 layer-{name}，Node用 kebab-case，External用 ext-{name}，所有ID必须唯一
4. 状态：completed(已完成/绿色)、in-progress(进行中/黄色)、todo(待开始/灰色)
5. 子模块：每个节点不超过10个，使用 childFlow 定义流程顺序
6. 连线：只标注关键依赖关系，不超过30条，from/to 必须是存在的节点ID
7. 外部模块 type：api/cdn/database/cache/mq/service

# 输出要求

1. 只返回有效的 JSON 数据，不要有任何说明文字
2. 确保所有ID唯一且符合命名规范
3. 确保 nodeEdges 中的 from/to 都存在于 layers 中
4. 确保 level 从0开始连续递增`

      const fullPrompt = `${systemPrompt}\n\n用户需求：${description}\n\n请直接返回符合规范的 JSON 数据，不要有任何说明文字。`

      const content = await callAI(fullPrompt, {
        sessionId: `arch_gen_${Date.now()}`,
        timeout: 120000
      })

      if (!content) {
        throw new Error('AI 返回内容为空')
      }

      // 清理 AI 返回的内容，提取 JSON
      let cleanedContent = content.replace(/\\n/g, '\n')
      cleanedContent = cleanedContent.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('AI 返回的内容不包含有效的 JSON 数据')
      }

      const archData = JSON.parse(jsonMatch[0])

      // 基本校验
      if (!archData.layers || !Array.isArray(archData.layers)) {
        throw new Error('生成的数据缺少 layers 字段')
      }

      console.log('[ArchDesignerTool] AI 生成成功，包含', archData.layers.length, '个分层')

      return {
        success: true,
        data: archData,
        needConfirm: false
      }
    } catch (error) {
      console.error('[ArchDesignerTool] AI 生成失败:', error.message)
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 将架构图 JSON 数据注入到画布中渲染
   * 通过 BrowserView 的 webContents.executeJavaScript 发送 postMessage
   * @param {object} params - 参数
   * @param {object|string} params.archData - 架构图 JSON 数据（对象或 JSON 字符串）
   * @returns {Promise<object>}
   */
  async render(params = {}) {
    const { archData } = params

    if (!archData) {
      console.error('[ArchDesignerTool] render 失败: 缺少 archData 参数, 收到的 params:', JSON.stringify(Object.keys(params)))
      return { success: false, error: '缺少架构图数据', needConfirm: false }
    }

    try {
      console.log('[ArchDesignerTool] render 开始, archData 类型:', typeof archData)

      // 确保数据是对象
      const dataObj = typeof archData === 'string' ? JSON.parse(archData) : archData

      if (!dataObj.layers || !Array.isArray(dataObj.layers)) {
        console.error('[ArchDesignerTool] render 失败: 数据缺少 layers 字段, 顶层 keys:', Object.keys(dataObj))
        return { success: false, error: '架构图数据缺少 layers 字段', needConfirm: false }
      }

      if (!this._manager) {
        console.error('[ArchDesignerTool] render 失败: BrowserViewManager 未注入')
        return { success: false, error: '画布未打开，BrowserViewManager 未注入', needConfirm: false }
      }

      if (!this._manager.browserView) {
        console.error('[ArchDesignerTool] render 失败: BrowserView 未创建（画布可能未打开）')
        return { success: false, error: '画布未打开，请先调用 open 方法', needConfirm: false }
      }

      // 通过 executeJavaScript 向画布发送 postMessage
      // 使用 Base64 编码避免 JSON 中的特殊字符导致转义问题
      // 注意：浏览器的 atob() 只支持 Latin-1，中文需要用 TextDecoder 正确解码 UTF-8
      const jsonStr = JSON.stringify(dataObj)
      console.log('[ArchDesignerTool] render 数据大小:', jsonStr.length, '字节,', dataObj.layers.length, '个分层')
      const base64Data = Buffer.from(jsonStr, 'utf-8').toString('base64')
      await this._manager.browserView.webContents.executeJavaScript(
        `(function() {
          var binaryStr = atob('${base64Data}');
          var bytes = new Uint8Array(binaryStr.length);
          for (var i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          var jsonStr = new TextDecoder('utf-8').decode(bytes);
          window.postMessage({ type: 'arch-designer:render', payload: JSON.parse(jsonStr) }, '*');
        })()`
      )

      console.log('[ArchDesignerTool] ✅ 架构图数据已注入画布渲染, 标题:', dataObj.title || '未命名')

      return {
        success: true,
        data: { message: '架构图已渲染到画布中', title: dataObj.title || '未命名架构图' },
        needConfirm: false
      }
    } catch (error) {
      console.error('[ArchDesignerTool] render 异常:', error.message)
      console.error('[ArchDesignerTool] render 异常堆栈:', error.stack)
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 将架构图 JSON 数据保存到工作区 .arch 目录
   * @param {object} params - 参数
   * @param {object|string} params.archData - 架构图 JSON 数据
   * @param {string} [params.filename] - 可选文件名（不含扩展名）
   * @param {string} [params.cwd] - 工作区路径（由 executor 自动注入）
   * @returns {Promise<object>}
   */
  async save(params = {}) {
    const { archData, filename, cwd } = params

    if (!archData) {
      console.error('[ArchDesignerTool] save 失败: 缺少 archData 参数')
      return { success: false, error: '缺少架构图数据', needConfirm: false }
    }

    try {
      const dataObj = typeof archData === 'string' ? JSON.parse(archData) : archData
      const workDir = cwd || process.env.HOME || ''
      const archDir = path.join(workDir, '.arch')

      // 确保 .arch 目录存在
      if (!fs.existsSync(archDir)) {
        fs.mkdirSync(archDir, { recursive: true })
      }

      // 生成文件名：优先用参数指定的，其次用 title，最后用时间戳
      const safeName = filename
        || (dataObj.title ? dataObj.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50) : null)
        || `arch-${Date.now()}`
      const filePath = path.join(archDir, `${safeName}.json`)

      const jsonStr = JSON.stringify(dataObj, null, 2)
      fs.writeFileSync(filePath, jsonStr, 'utf-8')

      console.log('[ArchDesignerTool] ✅ 架构图数据已保存:', filePath)

      return {
        success: true,
        data: { filePath, filename: `${safeName}.json`, size: jsonStr.length },
        needConfirm: false
      }
    } catch (error) {
      console.error('[ArchDesignerTool] save 失败:', error.message)
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 关闭架构图编辑器的 dev server
   */
  async close() {
    try {
      if (this._devServerProcess) {
        this._devServerProcess.kill()
        this._devServerProcess = null
        this._serverReady = false
        console.log('[ArchDesignerTool] dev server 已关闭')
      }
      return { success: true, needConfirm: false }
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false }
    }
  }

  /**
   * 获取架构图编辑器状态
   */
  async status() {
    const isRunning = await checkServerRunning()
    return {
      success: true,
      data: {
        running: isRunning,
        url: isRunning ? ARCH_DESIGNER_URL : null,
        pid: this._devServerProcess?.pid || null
      },
      needConfirm: false
    }
  }
}

module.exports = new ArchDesignerTool()

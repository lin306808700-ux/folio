'use strict'

/**
 * Muse Router — 对话主控入口
 * 
 * 所有用户输入的第一接收者。Muse 作为伴侣核心，理解意图后：
 * - 纯对话 → 注入人格/记忆后调用 chat-handler（降级为执行器）
 * - 工具任务 → 走 Node ReAct 引擎(react-engine) 循环
 * - 工具追问 → 恢复上轮工具会话上下文，继续 ReAct
 * - 主动行为 → heartbeat/explore（独立触发，不经此路由）
 */

const fs = require('fs')
const path = require('path')
const { executeReAct, requestAbort } = require('./react-engine')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const artifactStore = require('./artifact-store')

/**
 * 获取用户在前端 UI 设置的「当前工作区」目录。
 *
 * 注意：这与 Muse 自身的家目录（.folio/muse，即 MUSE_HOME/PROJECT_DIR）是两个不同概念：
 * - MUSE_HOME：Muse 的内部数据（日志、记忆、profile、journal 等），不对用户暴露；
 * - 当前工作区：用户表达意图、创建/读写文件时产物应落地的真实项目目录。
 *
 * 因此 ReAct 工具的 cwd / 文件落地根必须用这个，绝不能落进软件自身的源码仓库。
 * 优先读 ~/.folio/workspace.json 的 currentWorkspace（与 chat-handler/terminal-manager 一致），
 * 未设置或路径失效时回退到用户 HOME，而非 muse 项目根目录，避免污染软件源码。
 */
function getCurrentWorkspace() {
  try {
    const configPath = path.join(process.env.HOME || '', '.folio', 'workspace.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.currentWorkspace && fs.existsSync(config.currentWorkspace)) {
        return config.currentWorkspace
      }
    }
  } catch (error) {
    console.warn('[MuseRouter] 读取工作区配置失败:', error.message)
  }
  return process.env.HOME || ''
}

let _chatHandler = null
let _mainWindow = null

// ========== 工具会话状态 ==========
const SESSION_TIMEOUT = 5 * 60 * 1000 // 5 分钟超时
let _activeToolSession = null
// { id, command, finalAnswer, artifacts: [], context, lastActivity, steps }

function getActiveSession() {
  if (!_activeToolSession) return null
  if (Date.now() - _activeToolSession.lastActivity > SESSION_TIMEOUT) {
    console.log('[MuseRouter] 工具会话超时，已清除')
    _activeToolSession = null
    return null
  }
  return _activeToolSession
}

function createSession(command) {
  _activeToolSession = {
    id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    command,
    finalAnswer: '',
    artifacts: [],
    context: null,
    lastActivity: Date.now(),
    steps: 0,
  }
  return _activeToolSession
}

function updateSession(updates) {
  if (_activeToolSession) {
    Object.assign(_activeToolSession, updates, { lastActivity: Date.now() })
  }
}

function clearSession() {
  _activeToolSession = null
}

function init(mainWindow, chatHandler) {
  _mainWindow = mainWindow
  _chatHandler = chatHandler
  console.log('[MuseRouter] 已初始化，Muse 接管对话入口')
}

/**
 * 意图分类：判断用户输入走哪条路径
 * - 'chat': 纯对话/问答/闲聊/代码问答
 * - 'tool': 需要工具执行的创作任务（文件操作、脚本、浏览器、MCP）
 * - 'tool_followup': 对上一轮工具任务的追问/修改
 */
function classifyIntent(userInput, options = {}) {
  const input = userInput.trim()

  // 脚本模板 → 走 chat
  if (options.scriptTemplate) {
    return 'chat'
  }

  // 斜杠命令 → 走 chat（内部有拦截逻辑）
  if (input.startsWith('/')) {
    return 'chat'
  }

  // 检测工具追问：有活跃 session 且用户在追问/修改
  const session = getActiveSession()
  if (session) {
    const followupPatterns = [
      /^(改|换|调|把|再|重新|修改|更新|替换|加上|去掉|删掉|增加|减少)/,
      /^(颜色|字体|大小|位置|样式|标题|内容|文案|图片|链接)/,
      /^(不要|别|换成|改成|用|加个|去掉|移除)/,
      /(改一下|调一下|换一下|再.*一下|重新.*一下)/,
      /^(好的|可以|行|OK).*(但是|不过|还要|另外|再)/i,
      /上次|刚才|那个|之前那个|继续/,
    ]
    for (const pattern of followupPatterns) {
      if (pattern.test(input)) {
        return 'tool_followup'
      }
    }
  }

  // 纯问询/咨询排除 — 含工具关键词但意图是询问而非执行
  const chatExcludePatterns = [
    /^(什么是|是什么|怎么理解|如何理解|介绍一下|解释一下|说说|讲讲|告诉我)/,
    /(是什么|是啥|有什么|有哪些|怎么样|什么样|如何设计|应该怎么|该怎么|怎么理解)/,
    /^(帮我|请)?(看看|分析|检查|审查|review|解释|理解|了解)/,
    /(结构|架构|原理|概念|区别|对比|优缺点|最佳实践|建议)/,
    /^(为什么|为啥|怎么回事|什么原因|有.*问题吗|有.*bug)/,
  ]

  for (const pattern of chatExcludePatterns) {
    if (pattern.test(input)) {
      return 'chat'
    }
  }

  // 显式工具意图关键词
  const toolPatterns = [
    /^(帮我|请|麻烦).*(创建|生成|写入|删除|修改|替换|移动|复制|下载|安装|部署|运行|执行|编译|打包)/,
    /^(创建|生成|写入|删除|修改|替换|移动|复制|下载|安装|部署|运行|执行|编译|打包)/,
    /^(帮我|请)?(把|将).*(改|换|替换|设|移|复制|删|写入|更新|升级)/,
    /(文件|目录|脚本|项目|服务|容器|数据库)/,
    /截图|截屏|screenshot|爬取|抓取/i,
    /puppeteer|headless|docker|npm\s+(install|run)|pip\s+install/i,
  ]

  for (const pattern of toolPatterns) {
    if (pattern.test(input)) {
      return 'tool'
    }
  }

  // 默认走对话
  return 'chat'
}

/**
 * 主路由 — 处理用户输入（非流式）
 */
async function handleInput(params) {
  const { userInput } = params
  const intent = classifyIntent(userInput, params)

  console.log(`[MuseRouter] 意图分类: ${intent} | 输入: ${userInput.substring(0, 60)}`)

  if (intent === 'tool' || intent === 'tool_followup') {
    return await handleToolTask(params, intent === 'tool_followup')
  }

  // 纯对话：透传给 chat-handler
  return await _chatHandler.handleChat(params)
}

/**
 * 主路由 — 处理用户输入（流式）
 */
async function handleInputStream(params) {
  const { userInput } = params
  const intent = classifyIntent(userInput, params)

  console.log(`[MuseRouter] [Stream] 意图分类: ${intent} | 输入: ${userInput.substring(0, 60)}`)

  if (intent === 'tool' || intent === 'tool_followup') {
    return await handleToolTaskStream(params, intent === 'tool_followup')
  }

  // 纯对话：透传给 chat-handler 的流式接口
  return await _chatHandler.handleChatStream(params)
}

/**
 * 工具任务 — 调用 Node ReAct 引擎(react-engine)
 * @param {boolean} isFollowup - 是否为追问（恢复上轮会话上下文）
 */
async function handleToolTask(params, isFollowup = false) {
  const { userInput, sessionId: chatSessionId } = params

  try {
    const museContext = gatherOwnerContext()
    const context = {
      workspace: getCurrentWorkspace(),
      sessionId: chatSessionId || getMuseSessionId(),
      memories: museContext?.memories || '',
      profile: museContext?.profile || '',
    }

    // 追问：注入上轮会话上下文
    let command = userInput
    if (isFollowup) {
      const session = getActiveSession()
      if (session) {
        const artifactPaths = session.artifacts.map(a => a.filePath).join(', ')
        context.previousTask = {
          command: session.command,
          answer: session.finalAnswer,
          artifacts: artifactPaths,
        }
        command = `[追问上一轮任务: "${session.command}"]\n上轮结果: ${(session.finalAnswer || '').substring(0, 500)}\n${artifactPaths ? '产物文件: ' + artifactPaths + '\n' : ''}当前追问: ${userInput}`
        console.log(`[MuseRouter] 工具追问，恢复会话 ${session.id}`)
      }
    } else {
      // 新任务：创建新 session
      createSession(userInput)
    }

    const result = await executeReAct(command, context)

    if (result.success) {
      const answer = result.finalAnswer || '任务完成'

      // 更新 session
      updateSession({
        finalAnswer: answer,
        steps: result.totalSteps || 0,
        command: isFollowup ? userInput : (getActiveSession()?.command || userInput),
      })

      // 提取产物（从 ReAct 结果中解析生成的文件路径）
      registerArtifactsFromResult(result, userInput)

      return {
        success: true,
        content: answer,
        webSearched: false,
        isTask: true,
        routedBy: 'muse-router',
        totalSteps: result.totalSteps,
        sessionId: getActiveSession()?.id,
      }
    }

    console.log('[MuseRouter] ReAct 执行失败，降级到 chat-handler:', result.error)
    return await _chatHandler.handleChat(params)
  } catch (error) {
    console.error('[MuseRouter] 工具任务异常:', error.message)
    return await _chatHandler.handleChat(params)
  }
}

/**
 * 从 ReAct 结果中提取并注册产物
 */
function registerArtifactsFromResult(result, command) {
  const session = getActiveSession()
  if (!session) return

  // 从 final_answer 或 steps 中提取文件路径
  const answer = result.final_answer || result.answer || ''
  const filePatterns = [
    /(?:已(?:写入|生成|创建|保存)[：:]\s*)([^\s\n]+)/g,
    /(?:文件[：:]\s*)([^\s\n]+)/g,
    /(`[^`]*\/[^`]+\.[a-z]+`)/g,
  ]

  const detectedPaths = new Set()
  for (const pattern of filePatterns) {
    let match
    while ((match = pattern.exec(answer)) !== null) {
      let filePath = match[1].replace(/`/g, '').trim()
      if (filePath.startsWith('~')) {
        filePath = filePath.replace('~', process.env.HOME)
      }
      if (filePath.includes('.') && filePath.length > 3) {
        detectedPaths.add(filePath)
      }
    }
  }

  for (const filePath of detectedPaths) {
    const artifact = artifactStore.register({
      filePath,
      command,
      sessionId: session.id,
      description: `由任务生成: ${command.substring(0, 80)}`,
    })
    session.artifacts.push(artifact)
  }
}

/**
 * 工具任务流式 — 调用 Node ReAct 引擎(react-engine) Stream
 * @param {boolean} isFollowup - 是否为追问
 */
async function handleToolTaskStream(params, isFollowup = false) {
  const { userInput, sessionId: chatSessionId } = params

  try {
    const museContext = gatherOwnerContext()
    const context = {
      workspace: getCurrentWorkspace(),
      sessionId: chatSessionId || getMuseSessionId(),
      memories: museContext?.memories || '',
      profile: museContext?.profile || '',
    }

    // 追问：注入上轮上下文
    let command = userInput
    if (isFollowup) {
      const session = getActiveSession()
      if (session) {
        const artifactPaths = session.artifacts.map(a => a.filePath).join(', ')
        context.previousTask = {
          command: session.command,
          answer: session.finalAnswer,
          artifacts: artifactPaths,
        }
        command = `[追问上一轮任务: "${session.command}"]\n上轮结果: ${(session.finalAnswer || '').substring(0, 500)}\n${artifactPaths ? '产物文件: ' + artifactPaths + '\n' : ''}当前追问: ${userInput}`
        console.log(`[MuseRouter] [Stream] 工具追问，恢复会话 ${session.id}`)
      }
    } else {
      createSession(userInput)
    }

    await executeReActWithIPC(command, userInput, context, {
      source: isFollowup ? 'router_followup' : 'router_tool',
      intentClassification: isFollowup ? 'tool_followup' : 'tool',
    })

    return { success: true }
  } catch (error) {
    console.error('[MuseRouter] 流式工具任务异常:', error.message)
    return await _chatHandler.handleChatStream(params)
  }
}

/**
 * 统一的 ReAct 执行 + IPC 广播（右侧面板 Activity Feed）
 * 供 handleToolTaskStream 和 chat-handler 的 MUSE_TASK 转交共用
 * @param {string} command - 给 ReAct 引擎的完整 prompt（含 agent directive 等）
 * @param {string} displayCommand - 给前端展示的用户原始输入
 * @param {object} context - ReAct 上下文 { workspace, memories, profile, ... }
 * @param {object} [logOptions] - 日志选项 { source, intentClassification }
 */
/**
 * 请求用户确认执行危险 shell 命令（ReAct 路径）
 * 发送 react:needConfirm 到前端渲染确认卡片，阻塞等待用户响应。
 * 回传复用 script:authResponse 通道（前端授权按钮已有该 API），用 confirmId 区分。
 *
 * @param {Electron.BrowserWindow} win
 * @param {{ step:number, command:string, riskLevel:string, reason:string, details:object }} data
 * @returns {Promise<boolean>} 用户是否允许执行
 */
function requestReactConfirm(win, data) {
  const { ipcMain } = require('electron')
  const confirmId = `react_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) {
      resolve(false)
      return
    }

    win.webContents.send('react:needConfirm', {
      authId: confirmId,
      step: data.step,
      command: data.command,
      riskLevel: data.riskLevel,
      reason: data.reason,
      details: data.details,
    })

    const handleResponse = (event, payload) => {
      if (!payload || payload.authId !== confirmId) return
      ipcMain.removeListener('script:authResponse', handleResponse)
      clearTimeout(timer)
      resolve(!!payload.granted)
    }

    ipcMain.on('script:authResponse', handleResponse)

    // 超时自动拒绝（5 分钟）
    const timer = setTimeout(() => {
      ipcMain.removeListener('script:authResponse', handleResponse)
      resolve(false)
    }, 5 * 60 * 1000)
  })
}

async function executeReActWithIPC(command, displayCommand, context, logOptions = {}) {
  const win = _mainWindow

  // 通知前端 ReAct 开始
  if (win && !win.isDestroyed()) {
    win.webContents.send('react:start', { command: displayCommand })
  }

  await executeReAct(command, context, {
    onStepStart: (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('react:step', {
          step: data.step,
          thought: data.thought,
          action: data.action,
          input: data.input,
          status: 'running',
        })
        win.webContents.send('ai:streamChunk', {
          chunk: `\n**[Step ${data.step}]** ${data.thought}\n> Action: ${data.action}(${JSON.stringify(data.input || {}).slice(0, 100)})\n`,
          isThinking: true
        })
      }
    },
    onObservation: (data) => {
      if (win && !win.isDestroyed()) {
        const obs = (data.observation || '').substring(0, 800)
        win.webContents.send('react:observation', {
          step: data.step,
          observation: obs,
          success: data.success !== false,
        })
        win.webContents.send('ai:streamChunk', {
          chunk: `\n\`\`\`\n${obs.substring(0, 500)}\n\`\`\`\n`,
          isObservation: true
        })
      }
    },
    onFinal: (data) => {
      const answer = data.answer || ''
      updateSession({ finalAnswer: answer, steps: data.totalSteps || 0 })
      registerArtifactsFromResult({ final_answer: answer }, displayCommand)

      const session = getActiveSession()
      if (win && !win.isDestroyed()) {
        win.webContents.send('react:done', {
          answer,
          totalSteps: data.totalSteps || 0,
          artifacts: session?.artifacts || [],
        })
        win.webContents.send('ai:streamEnd', {
          success: true,
          content: answer,
          routedBy: 'muse-router',
          sessionId: session?.id,
          totalSteps: data.totalSteps || 0,
          artifacts: session?.artifacts || [],
        })
      }
    },
    onAbort: (data) => {
      // 用户主动中断 — checkpoint 已由 finishLog 保存，前端显示「已中断」+ 恢复按钮
      const answer = data.answer || '任务已被用户中断'
      console.log('[MuseRouter] ReAct 被用户中断:', answer)
      const session = getActiveSession()
      if (win && !win.isDestroyed()) {
        win.webContents.send('react:done', {
          aborted: true,
          answer,
          totalSteps: data.totalSteps || 0,
          artifacts: session?.artifacts || [],
          command: displayCommand,
        })
        win.webContents.send('ai:streamEnd', {
          success: false,
          aborted: true,
          content: answer,
          routedBy: 'muse-router',
          sessionId: session?.id,
        })
      }
    },
    onError: (data) => {
      console.error('[MuseRouter] ReAct stream error:', data.error)
      if (win && !win.isDestroyed()) {
        win.webContents.send('react:done', { error: data.error, totalSteps: data.totalSteps || 0, artifacts: [] })
        win.webContents.send('ai:streamEnd', { success: false, error: data.error })
      }
    },
    // 危险 shell 命令确认 — 发 react:needConfirm，阻塞等待用户「点击继续」（复用 script:authResponse 回传通道）
    onNeedConfirm: (data) => requestReactConfirm(win, data),
    // Plan 进度推送 — 让前端展示 todolist
    onPlanUpdate: (data) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('react:planUpdate', {
          plan: data.plan.map(p => ({ id: p.id, desc: p.desc, done: p.done }))
        })
      }
    },
  }, { source: logOptions.source || 'router_tool', intentClassification: logOptions.intentClassification || null })
}

/**
 * 中断流式响应 / ReAct 任务
 */
function abortStream() {
  // 1. 中断 chat 流式响应
  const result = _chatHandler.abortStream()
  // 2. 中断 ReAct 引擎（设置 flag，下一步检查时退出；
  //    同时 callAI 的 Promise.race poller 会立即 abort 当前请求）
  requestAbort()
  return { success: true, ...result }
}

module.exports = { init, handleInput, handleInputStream, abortStream, classifyIntent, executeReActWithIPC }

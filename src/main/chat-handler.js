'use strict'

console.log('[ChatHandler] 模块加载 v2026-04-03 19:35')

const { Memories: MemoriesDB, History: HistoryDB } = require('./database')
const { callAIStream, analyzeImages, abortCallsByLabel } = require('../shared/ai-client')
const path = require('path')
const fs = require('fs')
const { callAIWithCache, processAIResponse } = require('./ai-wrapper')
const { buildChatContext, addScriptExecResult } = require('./context-builder')
const sessionManager = require('./session-manager')
const tokenMonitor = require('./token-monitor')
const { analyzeScriptSafety, executeScript, buildErrorReport } = require('./script-executor')
const fileSnapshot = require('./file-snapshot')
const { buildCritiquePrompt, hasReviewableContent } = require('./craft-checker')

let _mainWindow = null
let _browserViewManager = null
let currentStreamController = null

/**
 * 收集工作目录的环境信息，供 Agent Loop 的 followUp 使用
 * 让 AI 能"看到"当前环境状态，做出更好的决策
 */
function gatherEnvironmentSnapshot(cwd) {
  const lines = []
  try {
    // 当前目录文件列表（最多 30 个）
    const entries = fs.readdirSync(cwd, { withFileTypes: true })
    const fileList = entries.slice(0, 30).map(e => {
      const suffix = e.isDirectory() ? '/' : ''
      return `  ${e.name}${suffix}`
    })
    lines.push(`📂 工作目录: ${cwd}`)
    lines.push(`文件列表 (${entries.length} 项):`)
    lines.push(...fileList)
    if (entries.length > 30) lines.push(`  ... 还有 ${entries.length - 30} 项`)
  } catch {
    lines.push(`📂 工作目录: ${cwd}（无法读取）`)
  }
  return lines.join('\n')
}

function init(win) {
  _mainWindow = win
}

function setBrowserViewManager(bvm) {
  _browserViewManager = bvm
}

function getWindow() {
  return _mainWindow && !_mainWindow.isDestroyed() ? _mainWindow : null
}

/**
 * 获取当前工作区路径
 * 优先从 workspace 配置文件读取用户设置的工作区，回退到 HOME 目录
 */
function getWorkspacePath() {
  try {
    const configPath = path.join(process.env.HOME || '', '.folio', 'workspace.json')
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.currentWorkspace && fs.existsSync(config.currentWorkspace)) {
        return config.currentWorkspace
      }
    }
  } catch (error) {
    console.warn('[Main] 读取工作区配置失败:', error.message)
  }
  return process.env.HOME || ''
}

// ========== 构建任务回调（复用于自检和任务引擎） ==========
function buildTaskCallbacks(logPrefix) {
  const { ipcMain } = require('electron')
  
  return {
    onPlanningStart: (userInput) => {
      console.log(`[${logPrefix}] 任务规划开始`)
      const win = getWindow()
      if (win) {
        win.webContents.send('task:planning', {
          message: '正在分析任务并生成执行计划...',
          input: userInput
        })
      }
    },
    onPlanReady: async (taskId, plan) => {
      console.log(`[${logPrefix}] 任务规划完成，等待用户确认`)
      const win = getWindow()
      if (!win) return plan // 窗口不存在时直接执行
      
      // 发送规划完成事件，等待用户响应
      return new Promise((resolve) => {
        // 监听用户确认/取消事件
        const handleConfirm = (event, data) => {
          if (data.taskId !== taskId) return
          
          // 移除监听器
          ipcMain.removeListener('task:planConfirm', handleConfirm)
          ipcMain.removeListener('task:planCancel', handleCancel)
          
          if (data.confirmed) {
            // 用户确认，返回修改后的计划
            console.log(`[${logPrefix}] 用户确认任务计划`)
            resolve(data.modifiedPlan || plan)
          } else {
            // 用户取消
            console.log(`[${logPrefix}] 用户取消任务`)
            resolve(null)
          }
        }
        
        const handleCancel = (event, data) => {
          console.log(`[${logPrefix}] 收到取消事件, data.taskId:`, data.taskId, '期望 taskId:', taskId)
          if (data.taskId !== taskId) {
            console.log(`[${logPrefix}] taskId 不匹配,忽略`)
            return
          }
          ipcMain.removeListener('task:planConfirm', handleConfirm)
          ipcMain.removeListener('task:planCancel', handleCancel)
          console.log(`[${logPrefix}] 用户取消任务`)
          resolve(null)
        }
        
        ipcMain.on('task:planConfirm', handleConfirm)
        ipcMain.on('task:planCancel', handleCancel)
        
        // 发送规划完成事件到前端
        win.webContents.send('task:planReady', {
          taskId,
          plan: {
            steps: plan.steps.map(step => ({
              id: step.id,
              description: step.description,
              type: step.type,
              params: step.params,
              tool: step.tool,
              method: step.method
            }))
          }
        })
      })
    },
    onTaskStart: (taskId, plan) => {
      console.log(`[${logPrefix}] 任务开始，共`, plan.steps.length, '个步骤')
      const win = getWindow()
      if (win) {
        win.webContents.send('task:start', {
          taskId,
          steps: plan.steps.map(step => ({
            id: step.id,
            description: step.description,
            type: step.type,
            status: 'pending',
            params: step.params
          }))
        })
      }
    },
    onStepStart: (step, current, total) => {
      console.log(`[${logPrefix}] 步骤 ${current}/${total}: ${step.description}`)
      const win = getWindow()
      if (win) win.webContents.send('task:stepStart', { step, current, total })
    },
    onStepComplete: (step, result, current, total) => {
      if (result.success) {
        console.log(`[${logPrefix}] 步骤完成 ${current}/${total}: ✅ ${step.description}`)
      } else {
        console.log(`[${logPrefix}] 步骤失败 ${current}/${total}: ❌ ${step.description}`)
        console.log(`[${logPrefix}]   错误: ${result.error || '未知错误'}`)
        if (result.data) console.log(`[${logPrefix}]   数据:`, JSON.stringify(result.data).slice(0, 500))
      }
      const win = getWindow()
      if (win) win.webContents.send('task:stepComplete', { step, result, current, total })
    },
    onNeedConfirm: (step, preview, taskId) => {
      console.log(`[${logPrefix}] 需要确认:`, step.description)
      const win = getWindow()
      if (win) win.webContents.send('task:needConfirm', { step, preview, taskId })
    },
    onProgress: (progress) => {
      const win = getWindow()
      if (win) win.webContents.send('task:progress', progress)
    },
    onStepRetry: ({ step, currentRetry, maxRetries, error, strategy }) => {
      console.log(`[${logPrefix}] 步骤重试 (${currentRetry}/${maxRetries}): ${step.description}, 策略: ${strategy}`)
      const win = getWindow()
      if (win) win.webContents.send('task:stepRetry', {
        stepId: step.id,
        stepDescription: step.description,
        currentRetry,
        maxRetries,
        error,
        strategy
      })
    },
    onMaxRetryReached: ({ step, error, retryCount, maxRetries }) => {
      console.log(`[${logPrefix}] 达到最大重试次数 (${retryCount}/${maxRetries}): ${step.description}`)
      const win = getWindow()
      if (win) win.webContents.send('task:maxRetryReached', {
        stepId: step.id,
        stepDescription: step.description,
        error,
        retryCount,
        maxRetries
      })
    },
    onComplete: (summary, context) => {
      console.log(`[${logPrefix}] 执行完成`)
      const win = getWindow()
      if (win) win.webContents.send('task:complete', { summary, context })
    },
    onError: (error, stepIndex) => {
      console.error(`[${logPrefix}] 执行失败:`, error)
      const win = getWindow()
      if (win) win.webContents.send('task:error', { error: error.message || error, stepIndex })
    }
  }
}

/**
 * 核心对话处理函数
 */
async function handleChat({ userInput, empId, sessionId, scriptTemplate, skipIntentEngine }) {
  // 交互式对话抢占后台学习图谱预生成，避免用户排在章节生成后面等待
  try { abortCallsByLabel('prefetch') } catch (_) {}
  console.log('[Main][handleChat] 收到请求:', { 
    userInput: userInput.substring(0, 100),
    browserViewReady: !!(_browserViewManager && _browserViewManager.isReady())
  })
  // ========== /self-check 自检命令拦截 ==========
  // 自检是系统内置能力，复用任务引擎和 UnifiedTaskCard，不产生额外卡片
  if (userInput.trim() === '/self-check' || userInput.trim().startsWith('/self-check ')) {
    const selfCheck = require('./self-check')
    const executor = require('./task-engine/executor')

    const parts = userInput.trim().split(/\s+/)
    const groupFilter = parts[1] || null

    console.log('[Main] 系统自检启动，分组过滤:', groupFilter || '全部')

    const taskPlan = selfCheck.buildTaskPlan(groupFilter)
    const callbacks = buildTaskCallbacks('SelfCheck')

    // 自检不需要用户确认，直接发送 task:start 启动任务卡片
    const win = getWindow()
    if (win) {
      win.webContents.send('task:start', {
        taskId: taskPlan.id,
        steps: taskPlan.steps.map(step => ({
          id: step.id,
          description: step.description,
          type: step.type,
          status: 'pending'
        }))
      })
    }

    const result = await executor.execute(taskPlan, callbacks)

    // 自检结束后清理测试数据
    await selfCheck.cleanup({ Memories: MemoriesDB })

    if (result.status === 'completed') {
      return {
        success: true,
        content: result.summary || '系统自检完成',
        webSearched: false,
        isTask: true
      }
    }

    return {
      success: false,
      error: result.error || '系统自检未能完成',
      isTask: true
    }
  }

  console.log(`[Main][handleChat] AI 调用开始: ${userInput.substring(0, 100)}${scriptTemplate ? ` | 脚本模板:${scriptTemplate.lang}` : ''}`)

  // ========== 普通 AI 调用 ==========
  try {
    const { fullQuestion, webSearched, cacheType, contextMode, contextSize } = await buildChatContext({ userInput, scriptTemplate, sessionId })
    const content = await callAIWithCache(fullQuestion, { empId, sessionId, userInput, cacheType, source: 'chat', contextMode, contextSize })

    if (!content) {
      throw new Error('AI 返回内容为空')
    }

    const result = processAIResponse(content, webSearched, getWindow())
    result.contextMode = contextMode
    result.contextSize = contextSize

    // AI 决定转交 Muse 智能体处理 → 统一走 ReAct + 右侧面板
    if (result.isMuseTask) {
      const museTask = result.museTask || userInput
      console.log('[Main] AI 选择 MUSE_TASK，走 ReAct 直接执行:', museTask)
      try {
        const { executeReActWithIPC } = require('./muse/router')
        const { gatherOwnerContext, getMuseSessionId } = require('./muse/context')
        const museContext = gatherOwnerContext()
        const context = {
          workspace: getWorkspacePath(),
          sessionId: sessionId || getMuseSessionId(),
          memories: museContext?.memories || '',
          profile: museContext?.profile || '',
        }
        await executeReActWithIPC(museTask, museTask, context, {
          source: 'muse_task',
          intentClassification: 'muse_task',
        })
      } catch (museErr) {
        console.error('[Main] MUSE_TASK ReAct 执行失败:', museErr.message)
      }
      result.isComplex = true
      result.userInput = museTask
      return result
    }

    // AI 决定在侧边栏浏览器中打开链接
    if (result.openInBrowser && _browserViewManager) {
      const targetUrl = result.openInBrowser.startsWith('http') || result.openInBrowser.startsWith('file://') ? result.openInBrowser : `https://${result.openInBrowser}`
      try {
        if (!_browserViewManager.isReady()) {
          await _browserViewManager.attach()
        }
        await _browserViewManager.navigate(targetUrl)
        _browserViewManager.show()
        _browserViewManager.notifyFrontend('browser')
        console.log('[Main] AI 指令：侧边栏打开:', targetUrl)
      } catch (error) {
        console.error('[Main] 侧边栏打开失败:', error.message)
      }
    }

    // ========== SCRIPT_BLOCK 子进程自动执行 ==========
    if (result.isScript) {
      try {
        const scriptInfo = JSON.parse(result.content)
        const autoExecResult = await handleScriptAutoExecution({
          scriptInfo,
          userInput,
          empId,
          sessionId,
          scriptTemplate,
          contextMode,
          contextSize,
          webSearched
        })
        if (autoExecResult) return autoExecResult
      } catch (parseErr) {
        console.warn('[Main] SCRIPT_BLOCK 自动执行解析失败，回退到手动模式:', parseErr.message)
      }
    }

    // Muse 对话感知已关闭：改为用户主动触发复盘（通过 muse:analyzeConversation IPC）
    // 原因：自动分析消耗 AI 额度且干扰请求队列

    return result
  } catch (error) {
    const win = getWindow()
    if (win) win.webContents.send('ai:searchStatus', { searching: false })
    console.log('[Main] AI 调用失败:', error.message)
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'AI 服务调用失败'
    }
  }
}

/**
 * 流式对话处理函数
 */
async function handleChatStream(params) {
  let { userInput, empId, sessionId, scriptTemplate, images } = params

  // 交互式对话抢占后台学习图谱预生成，避免用户排在章节生成后面等待
  try { abortCallsByLabel('prefetch') } catch (_) {}

  // ========== 插件钩子：onUserMessage ==========
  // 插件可在用户输入到达处理前修改或增强输入
  try {
    const pluginSystem = require('./plugin-system')
    const modifiedInput = await pluginSystem.runHooks('onUserMessage', userInput)
    if (typeof modifiedInput === 'string' && modifiedInput !== userInput) {
      console.log('[Main][handleChatStream] 插件 onUserMessage 修改了输入')
      userInput = modifiedInput
    }
  } catch (_) { /* 插件系统未加载时忽略 */ }

  console.log(`[Main][handleChatStream] 走流式路径: ${userInput?.substring(0, 50)}${scriptTemplate ? ` | 脚本模板:${scriptTemplate.lang}` : ''}`)
  if (scriptTemplate) {
    console.log('[Main][handleChatStream] ⚠️ 有 scriptTemplate → 将走脚本模板分支')
  }

  // ========== 特殊命令回退到非流式处理 ==========
  const trimmedInput = userInput.trim()

  const needNonStream =
    trimmedInput === '/self-check' || trimmedInput.startsWith('/self-check')

  if (needNonStream) {
    try {
      const result = await handleChat({ ...params, userInput })
      const win = getWindow()
      if (win) win.webContents.send('ai:streamEnd', result)
    } catch (error) {
      const win = getWindow()
      if (win) {
        win.webContents.send('ai:streamEnd', {
          success: false,
          error: error.message || 'AI 服务调用失败'
        })
      }
    }
    return
  }

  // 自动检测文本中的图片 URL，合并到 images 参数
  const imageUrlPattern = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg)(?:\?[^\s]*)?/gi
  const detectedImageUrls = (userInput || '').match(imageUrlPattern) || []
  if (detectedImageUrls.length > 0) {
    if (!images) images = []
    for (const url of detectedImageUrls) {
      if (!images.includes(url)) images.push(url)
    }
    console.log(`[Main] 从文本中检测到 ${detectedImageUrls.length} 个图片URL:`, detectedImageUrls)
  }

  console.log('[Main] AI 流式调用开始:', userInput)

  const controller = new AbortController()
  currentStreamController = controller

  try {
    // 立即推送"思考中"光标，让用户看到即时反馈
    const thinkingWin = getWindow()
    if (thinkingWin) thinkingWin.webContents.send('ai:streamChunk', { chunk: '', sessionId, thinking: true })

    const contextStartTime = Date.now()
    const { fullQuestion: baseQuestion, webSearched, contextMode, contextSize, images: contextImages, matchedTemplateNames } = await buildChatContext({
      userInput, scriptTemplate, sessionId, images
    })
    console.log(`[Main][Perf] buildChatContext 耗时: ${Date.now() - contextStartTime}ms`)

    let fullQuestion = baseQuestion

    if (contextImages && contextImages.length > 0) {
      const visionWin = getWindow()
      if (visionWin) visionWin.webContents.send('ai:searchStatus', { searching: true, message: '图片识别中...' })
      try {
        const imageDescription = await analyzeImages(contextImages, userInput)
        if (imageDescription) {
          fullQuestion = baseQuestion + '\n\n[图片内容识别结果]:\n' + imageDescription
        }
      } finally {
        if (visionWin) visionWin.webContents.send('ai:searchStatus', { searching: false })
      }
    }

    const streamStartTime = Date.now()
    const stream = callAIStream(fullQuestion, { empId, sessionId, signal: controller.signal })
    let fullContent = ''
    let firstChunkReceived = false

    for await (const { delta, content, streamEnd } of stream) {
      if (controller.signal.aborted) {
        console.log('[Main] 流式响应已被用户中断')
        break
      }

      if (!firstChunkReceived) {
        firstChunkReceived = true
        console.log(`[Main][Perf] 首字节延迟: ${Date.now() - streamStartTime}ms (总延迟: ${Date.now() - contextStartTime}ms)`)
      }

      fullContent = content
      const win = getWindow()
      if (win) win.webContents.send('ai:streamChunk', { chunk: delta, sessionId })
    }

    if (webSearched) {
      const win = getWindow()
      if (win) win.webContents.send('ai:searchStatus', { searching: false })
    }

    if (controller.signal.aborted) {
      // 记录 Token 用量（即使是中断也记录）
      tokenMonitor.recordCall({
        source: 'chat',
        input: fullQuestion,
        output: fullContent,
        contextMode,
        contextSize,
        sessionId,
        intentMatched: false,
      })

      const win = getWindow()
      if (win) {
        win.webContents.send('ai:streamEnd', {
          success: true,
          content: fullContent,
          webSearched,
          aborted: true,
          contextMode,
          contextSize
        })
      }
    } else {
      const result = processAIResponse(fullContent, webSearched, getWindow())
      result.contextMode = contextMode
      result.contextSize = contextSize

      // 记录 Token 用量
      tokenMonitor.recordCall({
        source: 'chat',
        input: fullQuestion,
        output: fullContent,
        contextMode,
        contextSize,
        sessionId,
        intentMatched: false,
      })

      // AI 决定转交 Muse 智能体处理 → 统一走 ReAct + 右侧面板
      if (result.isMuseTask) {
        const museTask = result.museTask || userInput
        console.log('[Main][Stream] AI 选择 MUSE_TASK，走 ReAct 直接执行:', museTask)
        try {
          const { executeReActWithIPC } = require('./muse/router')
          const { gatherOwnerContext, getMuseSessionId } = require('./muse/context')
          const museContext = gatherOwnerContext()
          const context = {
            workspace: getWorkspacePath(),
            sessionId: sessionId || getMuseSessionId(),
            memories: museContext?.memories || '',
            profile: museContext?.profile || '',
          }
          await executeReActWithIPC(museTask, museTask, context, {
            source: 'muse_task_stream',
            intentClassification: 'muse_task',
          })
        } catch (museErr) {
          console.error('[Main][Stream] MUSE_TASK ReAct 执行失败:', museErr.message)
          const win = getWindow()
          if (win) {
            win.webContents.send('ai:streamEnd', { success: false, error: museErr.message })
          }
        }
        return
      }

      // AI 决定在侧边栏浏览器中打开链接
      if (result.openInBrowser && _browserViewManager) {
        const targetUrl = result.openInBrowser.startsWith('http') || result.openInBrowser.startsWith('file://') ? result.openInBrowser : `https://${result.openInBrowser}`
        try {
          if (!_browserViewManager.isReady()) {
            await _browserViewManager.attach()
          }
          await _browserViewManager.navigate(targetUrl)
          _browserViewManager.show()
          _browserViewManager.notifyFrontend('browser')
          console.log('[Main] 流式路径 - AI 指令：侧边栏打开:', targetUrl)
        } catch (error) {
          console.error('[Main] 流式路径 - 侧边栏打开失败:', error.message)
        }
      }

      // 流式路径 SCRIPT_BLOCK
      if (result.isScript) {
        try {
          // 发送 ai:streamEnd 让前端创建 script 消息卡片，显示手动执行按钮
          const w = getWindow()
          if (w) {
            w.webContents.send('ai:streamEnd', {
              ...result,
              contextMode,
              contextSize
            })
          }
          return
        } catch (parseErr) {
          console.warn('[Main] 流式路径 SCRIPT_BLOCK 解析失败:', parseErr.message)
        }
      }

      // 浏览器操作意图已由 muse/router.js 在入口层统一路由到 Node ReAct 引擎(react-engine)

      // 检测是否为复杂任务（供前端显示「交给 Muse 处理」按钮）
      if (result.success && !result.isScript && !result.isTask && fullContent) {
        const complexKeywords = /帮我|自动化|定时|每天|每周|批量|部署|发布|监控|爬取|抓取|生成报告|分析.*数据|多步骤|流程/
        const isLongResponse = fullContent.length > 800
        result.isComplex = complexKeywords.test(userInput) || isLongResponse
        if (result.isComplex) result.userInput = userInput
      }

      // ========== Craft 质量门禁（自动评审） ==========
      // AI 生成包含代码/HTML 等可评审产物时，自动匹配 craft 规则并附加评审结果
      if (result.success && fullContent && hasReviewableContent(fullContent)) {
        try {
          const critiqueResult = buildCritiquePrompt(userInput, fullContent)
          if (critiqueResult) {
            result.craftReview = {
              available: true,
              ruleCount: critiqueResult.rules.length,
              ruleNames: critiqueResult.rules.map(r => r.name),
              prompt: critiqueResult.prompt
            }
            console.log('[CraftChecker] 匹配', critiqueResult.rules.length, '条质量规则:', critiqueResult.rules.map(r => `${r.name}(${r.severity})`).join(', '))
          }
        } catch (craftErr) {
          console.warn('[CraftChecker] 质量评审构建失败:', craftErr.message)
        }
      }

      // ========== 上下文标签信息（供前端 ContextChipStrip 渲染） ==========
      if (result.success) {
        const contextChips = []
        // 匹配的场景模板
        if (matchedTemplateNames && matchedTemplateNames.length > 0) {
          for (const name of matchedTemplateNames) {
            contextChips.push({ id: `template:${name}`, type: 'template', label: name })
          }
        }
        // 匹配的 craft 规则
        if (result.craftReview && result.craftReview.ruleNames) {
          for (const name of result.craftReview.ruleNames) {
            contextChips.push({ id: `craft:${name}`, type: 'craft', label: name })
          }
        }
        if (contextChips.length > 0) {
          result.contextChips = contextChips
        }
      }

      // 保存对话历史（带完整 messages）
      // 后端是唯一存储者，存原始 fullContent（含协议原文）。协议的卡片化由前端
      // 在渲染时动态解析（流式 + 历史加载共用一套 parser），前端不再写库。
      if (result.success && fullContent && userInput) {
        try {
          const historyMessages = params.messages || []
          // 追加本轮对话
          const fullMessages = [
            ...historyMessages,
            { role: 'user', content: userInput },
            { role: 'assistant', content: fullContent }
          ]
          HistoryDB.add({
            query: userInput,
            content: fullContent,
            messages: fullMessages
          })
        } catch (historyErr) {
          console.warn('[Main] 保存对话历史失败:', historyErr.message)
        }
      }

      // Muse 对话感知（流式路径）已关闭：改为用户主动触发复盘

      const win = getWindow()
      if (win) win.webContents.send('ai:streamEnd', result)
    }
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
      console.log('[Main] 流式响应中断')
      const win = getWindow()
      if (win) {
        win.webContents.send('ai:streamEnd', {
          success: true,
          content: '',
          aborted: true
        })
      }
    } else {
      console.error('[Main] AI 流式调用失败:', error.message)
      const win = getWindow()
      if (win) {
        win.webContents.send('ai:searchStatus', { searching: false })
        win.webContents.send('ai:streamEnd', {
          success: false,
          error: error.response?.data?.message || error.message || 'AI 服务调用失败'
        })
      }
    }
  } finally {
    if (currentStreamController === controller) {
      currentStreamController = null
    }
  }
}

// ========== SCRIPT_BLOCK 子进程自动执行引擎 ==========
const SCRIPT_MAX_RETRIES = 2  // 错误自动重试最大次数

/**
 * 处理 SCRIPT_BLOCK 的子进程自动执行
 *
 * 流程：
 * 1. 双层安全检查（硬规则 + AI 标记）
 * 2. 危险脚本 → 发送 script:needAuth 等待用户授权
 * 3. 安全脚本 → 直接在子进程中执行
 * 4. 执行失败 → 收集日志，携带错误信息让 AI 重试（最多 SCRIPT_MAX_RETRIES 次）
 * 5. 执行成功 → 返回结果
 *
 * @returns {object|null} 返回处理结果，null 表示回退到手动模式
 */
async function handleScriptAutoExecution(options) {
  const {
    scriptInfo, userInput, empId, sessionId,
    scriptTemplate,
    contextMode, contextSize, webSearched
  } = options

  const { ipcMain } = require('electron')
  const win = getWindow()
  if (!win) return null

  const { scriptFile, scriptContent, lang, description, isDangerous, dangerReason, filename } = scriptInfo

  console.log('[ScriptAutoExec] 开始处理脚本自动执行:', {
    filename, lang, isDangerous,
    contentLength: scriptContent?.length
  })

  // 确定工作目录：工作区 > 脚本所在目录
  const scriptCwd = resolveScriptCwd(scriptFile)

  // ========== 第 1 步：双层安全检查 ==========
  const safety = analyzeScriptSafety(scriptContent, lang, isDangerous, dangerReason || '')
  console.log('[ScriptAutoExec] 安全分析结果:', {
    needsAuth: safety.needsAuth,
    riskLevel: safety.riskLevel,
    reason: safety.reason
  })

  // ========== 第 2 步：危险脚本等待用户授权 ==========
  if (safety.needsAuth) {
    const authGranted = await requestUserAuth(win, {
      scriptId: filename,
      scriptFile, filename, lang, description, scriptContent,
      riskLevel: safety.riskLevel,
      reason: safety.reason,
      details: safety.details
    })

    if (!authGranted) {
      console.log('[ScriptAutoExec] 用户拒绝授权，取消执行')
      return {
        success: true,
        content: `⛔ 已取消执行脚本：**${description || filename}**\n\n> 风险原因：${safety.reason}`,
        webSearched,
        contextMode,
        contextSize
      }
    }
    console.log('[ScriptAutoExec] 用户已授权执行危险脚本')
  }

  // ========== 第 3 步：子进程执行（含错误重试） ==========
  return await executeWithRetry({
    scriptInfo, scriptCwd, userInput, empId, sessionId,
    scriptTemplate,
    contextMode, contextSize, webSearched, win
  })
}

/**
 * 解析脚本执行的工作目录
 * 优先级：工作区 > 脚本所在目录
 */
function resolveScriptCwd(scriptFile) {
  // 回退到工作区目录
  const workspacePath = getWorkspacePath()
  if (workspacePath && workspacePath !== process.env.HOME) {
    return workspacePath
  }

  // 最终回退到脚本所在目录
  return path.dirname(scriptFile)
}

/**
 * 请求用户授权执行危险脚本
 * 通过 IPC 发送授权请求到前端，等待用户点击确认/取消
 *
 * @returns {Promise<boolean>} 用户是否授权
 */
function requestUserAuth(win, authData) {
  const { ipcMain } = require('electron')
  const authId = `script_auth_${Date.now()}`

  return new Promise((resolve) => {
    // 延迟 300ms 发送授权请求，确保前端 script 卡片已渲染完毕
    // 否则 updateScriptMessage 找不到卡片，authId 丢失，按钮点击无响应
    setTimeout(() => {
      win.webContents.send('script:needAuth', {
        authId,
        scriptId: authData.scriptId || authData.filename,
        ...authData
      })
    }, 300)

    const handleAuthResponse = (event, data) => {
      if (data.authId !== authId) return
      ipcMain.removeListener('script:authResponse', handleAuthResponse)
      resolve(!!data.granted)
    }

    ipcMain.on('script:authResponse', handleAuthResponse)

    // 超时自动拒绝（5 分钟）
    setTimeout(() => {
      ipcMain.removeListener('script:authResponse', handleAuthResponse)
      resolve(false)
    }, 5 * 60 * 1000)
  })
}

/**
 * 执行脚本并在失败时自动重试
 * 重试时携带错误日志让 AI 修复脚本
 */
async function executeWithRetry(options) {
  const {
    scriptInfo, scriptCwd, userInput, empId, sessionId,
    scriptTemplate,
    contextMode, contextSize, webSearched, win,
    followUpDepth = 0
  } = options

  // 重试次数上限
  const effectiveMaxRetries = SCRIPT_MAX_RETRIES

  let currentScriptInfo = scriptInfo
  let retryCount = 0

  while (retryCount <= effectiveMaxRetries) {
    const { scriptFile, scriptContent, lang, description, filename } = currentScriptInfo

    // 通知前端：脚本开始执行（scriptId 用于前端精确匹配卡片）
    win.webContents.send('script:executing', {
      scriptId: filename,
      filename,
      lang,
      description,
      retryCount
    })

    console.log(`[ScriptAutoExec] 执行脚本 (尝试 ${retryCount + 1}/${SCRIPT_MAX_RETRIES + 1}):`, filename)

    // 分析脚本即将变更的文件，提前备份（轻量级，只备份目标文件）
    let snapshotInfo = null
    try {
      snapshotInfo = fileSnapshot.backupBeforeExecution(scriptContent, lang, scriptCwd, {
        scriptId: filename,
        description,
        targetFiles: currentScriptInfo.targetFiles
      })
    } catch (backupErr) {
      console.warn('[ScriptAutoExec] 文件备份失败，跳过快照:', backupErr.message)
    }

    // 子进程执行，实时推送输出到前端
    const execResult = await executeScript({
      scriptFile,
      lang,
      cwd: scriptCwd,
      onOutput: (type, data) => {
        win.webContents.send('script:output', { type, data, filename })
      }
    })

    if (execResult.success) {
      console.log('[ScriptAutoExec] 脚本执行成功:', filename)

      // 通知前端：执行完成（携带快照信息，用于回滚）
      const hasSnapshot = snapshotInfo && snapshotInfo.snapshotId && snapshotInfo.backedUpFiles.length > 0
      win.webContents.send('script:complete', {
        scriptId: filename,
        filename,
        stdout: execResult.stdout,
        exitCode: execResult.exitCode,
        snapshot: hasSnapshot ? {
          snapshotId: snapshotInfo.snapshotId,
          timestamp: snapshotInfo.timestamp,
          totalChanges: snapshotInfo.backedUpFiles.length,
          changes: {
            modified: snapshotInfo.backedUpFiles.filter(f => f.type === 'existing').map(f => f.originalPath),
            created: snapshotInfo.backedUpFiles.filter(f => f.type === 'will_create').map(f => f.originalPath),
            deleted: []
          }
        } : null
      })

      // 将执行结果注入到下一轮 AI 对话上下文中
      addScriptExecResult({
        description,
        filename,
        lang,
        success: true,
        stdout: execResult.stdout,
        exitCode: execResult.exitCode
      })

      // 自动发起后续 AI 调用，让 AI 根据执行结果决定下一步
      // 构建携带快照信息的 scriptInfo
      const completedScriptInfo = {
        type: 'script',
        ...currentScriptInfo,
        execStatus: 'completed',
        execResult: {
          stdout: execResult.stdout,
          exitCode: execResult.exitCode
        }
      }
      if (hasSnapshot) {
        completedScriptInfo.snapshot = {
          snapshotId: snapshotInfo.snapshotId,
          timestamp: snapshotInfo.timestamp,
          totalChanges: snapshotInfo.backedUpFiles.length,
          changes: {
            modified: snapshotInfo.backedUpFiles.filter(f => f.type === 'existing').map(f => f.originalPath),
            created: snapshotInfo.backedUpFiles.filter(f => f.type === 'will_create').map(f => f.originalPath),
            deleted: []
          }
        }
      }

      const followUpResult = await triggerFollowUp({
        scriptId: filename,
        description, stdout: execResult.stdout, exitCode: execResult.exitCode,
        userInput, empId, sessionId,
        scriptTemplate,
        contextMode, contextSize, webSearched, win,
        depth: followUpDepth,
        scriptCwd
      })

      // followUp 返回了新脚本（递归执行），直接返回
      if (followUpResult && followUpResult.isScript) return followUpResult

      // followUp 已处理过（递归调用中已发送给前端），直接返回
      if (followUpResult && followUpResult._handled) return followUpResult

      // followUp 返回了文本总结，通过 followUpProgress 发送给前端展示（避免 streamingMsgId 已失效的问题）
      if (followUpResult && !followUpResult.isScript && followUpResult.content) {
        console.log('[ScriptAutoExec] followUp 文本总结，发送给前端展示, length:', followUpResult.content.length)
        win.webContents.send('ai:followUpProgress', {
          type: 'summary',
          message: followUpResult.content,
          depth: followUpDepth,
          sessionId,
          isSummary: true
        })
        // 返回标记，防止上层 executeWithRetry 重复处理
        return { ...followUpResult, _handled: true }
      }

      return {
        success: true,
        content: JSON.stringify(completedScriptInfo),
        webSearched,
        isScript: true,
        contextMode,
        contextSize
      }
    }

    // 执行失败
    console.error(`[ScriptAutoExec] 脚本执行失败 (尝试 ${retryCount + 1}):`, execResult.error)

    // 通知前端：执行失败
    win.webContents.send('script:error', {
      scriptId: filename,
      filename,
      error: execResult.error,
      stderr: execResult.stderr,
      retryCount,
      willRetry: retryCount < SCRIPT_MAX_RETRIES
    })

    // 达到最大重试次数 → 返回失败结果
    if (retryCount >= effectiveMaxRetries) {
      console.log('[ScriptAutoExec] 达到最大重试次数，返回失败结果')

      // 将失败结果也注入到下一轮 AI 对话上下文中
      addScriptExecResult({
        description,
        filename,
        lang,
        success: false,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        error: execResult.error
      })

      // 构建失败结果
      const failedResult = {
        type: 'script',
        ...currentScriptInfo,
        execStatus: 'failed',
        execResult: {
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
          error: execResult.error
        }
      }

      return {
        success: true,
        content: JSON.stringify(failedResult),
        webSearched,
        isScript: true,
        contextMode,
        contextSize
      }
    }

    // ========== AI 错误重试：携带错误日志让 AI 修复脚本 ==========
    console.log('[ScriptAutoExec] 携带错误信息请求 AI 修复脚本...')
    win.webContents.send('script:retrying', {
      scriptId: filename,
      filename,
      retryCount: retryCount + 1,
      maxRetries: SCRIPT_MAX_RETRIES
    })

    const errorReport = buildErrorReport(execResult, scriptContent, lang)
    const retryPrompt = `${userInput}\n\n${errorReport}`

    try {
      const { fullQuestion: retryQuestion } = await buildChatContext({
        userInput: retryPrompt,
        scriptTemplate, sessionId
      })

      const retryContent = await callAIWithCache(retryQuestion, {
        empId, sessionId, userInput: retryPrompt,
        source: 'script_retry', contextMode, contextSize
      })

      if (!retryContent) {
        console.warn('[ScriptAutoExec] AI 重试返回空内容')
        retryCount++
        continue
      }

      const retryResult = processAIResponse(retryContent, false, win)

      if (retryResult.isScript) {
        // AI 返回了修复后的脚本，更新 scriptInfo 继续重试
        currentScriptInfo = JSON.parse(retryResult.content)
        retryCount++
        continue
      }

      // AI 没有返回脚本（可能返回了文字说明），直接返回
      console.log('[ScriptAutoExec] AI 重试未返回脚本，返回 AI 响应')
      retryResult.contextMode = contextMode
      retryResult.contextSize = contextSize
      return retryResult
    } catch (retryError) {
      console.error('[ScriptAutoExec] AI 重试调用失败:', retryError.message)
      retryCount++
    }
  }

  return null
}

/**
 * 脚本执行成功后自动发起后续 AI 调用
 * 让 AI 根据执行输出决定下一步操作（继续执行、报告结果等）
 * 如果 AI 再次返回 SCRIPT_BLOCK，会递归执行
 */
const FOLLOW_UP_MAX_DEPTH = 10  // 最大连续自动执行深度，防止无限循环

async function triggerFollowUp(options) {
  const {
    scriptId,
    description, stdout, exitCode,
    userInput, empId, sessionId,
    scriptTemplate,
    contextMode, contextSize, webSearched, win,
    depth = 0,
    scriptCwd
  } = options

  if (depth >= FOLLOW_UP_MAX_DEPTH) {
    console.log('[ScriptAutoExec] 达到最大连续执行深度，停止自动后续')
    return null
  }

  console.log(`[ScriptAutoExec] 触发后续 AI 调用 (depth: ${depth})，分析执行结果...`)

  // 推送进度状态到前端（独立于流式消息）
  win.webContents.send('ai:followUpProgress', {
    type: 'analyzing',
    message: '🤖 正在分析执行结果...',
    depth,
    sessionId
  })

  try {
    // 收集环境快照，让 AI 能"看到"当前状态
    const envSnapshot = scriptCwd ? gatherEnvironmentSnapshot(scriptCwd) : ''

    // 构建增强的后续 prompt
    const followUpInput = `${userInput}

【Agent Loop — 第 ${depth + 1} 步执行完毕】
脚本：${description}
退出码：${exitCode}
stdout（最后 3000 字符）：
${(stdout || '').slice(-3000)}
${envSnapshot ? `\n【当前环境状态】\n${envSnapshot}` : ''}

请按以下逻辑判断下一步：
1. 如果任务**已完成** → 简要总结结果（不要输出脚本）
2. 如果还有**后续步骤需要执行脚本** → 直接输出下一步的 SCRIPT_BLOCK（不要解释，直接行动）
3. 如果后续步骤超出脚本能力范围 → 输出 MUSE_TASK 交给 Muse 自主完成
4. 如果需要**验证结果** → 用脚本检查（如 cat 文件、ls 目录、curl 测试）
5. 如果执行**出错** → 分析错误原因，输出修复后的 SCRIPT_BLOCK`

    const { fullQuestion } = await buildChatContext({
      userInput: followUpInput,
      scriptTemplate, sessionId
    })

    const content = await callAIWithCache(fullQuestion, {
      empId, sessionId, userInput: followUpInput,
      source: 'script_followup', contextMode, contextSize
    })

    if (!content) {
      console.warn('[ScriptAutoExec] 后续 AI 调用返回空内容')
      return null
    }

    const result = processAIResponse(content, webSearched, win)
    result.contextMode = contextMode
    result.contextSize = contextSize

    // AI 返回了新的脚本 → 递归执行
    if (result.isScript) {
      try {
        const nextScriptInfo = JSON.parse(result.content)
        console.log('[ScriptAutoExec] AI 返回了后续脚本:', nextScriptInfo.description)
        console.log('[ScriptAutoExec] 脚本内容:', nextScriptInfo.scriptContent?.substring(0, 200))

        const scriptCwd = resolveScriptCwd(nextScriptInfo.scriptFile)
        const safety = analyzeScriptSafety(nextScriptInfo.scriptContent, nextScriptInfo.lang, nextScriptInfo.isDangerous, nextScriptInfo.dangerReason)

        console.log('[ScriptAutoExec] 脚本安全分析:', safety)
        console.log('[ScriptAutoExec] 准备递归执行 executeWithRetry, followUpDepth:', depth + 1)

        // 如果需要授权，先创建临时脚本消息，再请求授权
        if (safety.needsAuth) {
          console.log('[ScriptAutoExec] 脚本需要授权，创建临时脚本卡片并请求授权')
          
          // 发送脚本数据，让前端创建脚本卡片
          win.webContents.send('ai:streamEnd', {
            success: true,
            content: JSON.stringify({
              type: 'script',
              scriptFile: nextScriptInfo.scriptFile,
              filename: nextScriptInfo.filename,
              lang: nextScriptInfo.lang,
              description: nextScriptInfo.description,
              scriptContent: nextScriptInfo.scriptContent,
              runCommand: `bash ${nextScriptInfo.scriptFile}`,
              isDangerous: safety.riskLevel !== 'none',
              dangerReason: safety.reason
            }),
            isScript: true
          })
          
          // 等待一小段时间让前端渲染卡片
          await new Promise(resolve => setTimeout(resolve, 100))
        }

        if (safety.needsAuth) {
          const authGranted = await requestUserAuth(win, {
            scriptFile: nextScriptInfo.scriptFile,
            filename: nextScriptInfo.filename,
            lang: nextScriptInfo.lang,
            description: nextScriptInfo.description,
            scriptContent: nextScriptInfo.scriptContent,
            riskLevel: safety.riskLevel,
            reason: safety.reason,
            details: safety.details
          })
          if (!authGranted) {
            return {
              success: true,
              content: `⛔ 已取消执行后续脚本：**${nextScriptInfo.description}**\n\n> 风险原因：${safety.reason}`,
              webSearched,
              contextMode,
              contextSize
            }
          }
        }

        return await executeWithRetry({
          scriptInfo: nextScriptInfo,
          scriptCwd,
          userInput, empId, sessionId,
          scriptTemplate,
          contextMode, contextSize, webSearched, win,
          followUpDepth: depth + 1
        })
      } catch (parseErr) {
        console.warn('[ScriptAutoExec] 后续脚本解析失败:', parseErr.message)
      }
    }

    // AI 返回了 OPEN_IN_BROWSER 指令 → 在右侧面板打开浏览器，然后继续 followUp
    if (result.openInBrowser && _browserViewManager) {
      const targetUrl = result.openInBrowser.startsWith('http') || result.openInBrowser.startsWith('file://') ? result.openInBrowser : `https://${result.openInBrowser}`
      console.log('[ScriptAutoExec] followUp 返回 OPEN_IN_BROWSER:', targetUrl)
      
      // 推送进度：准备打开浏览器
      win.webContents.send('ai:followUpProgress', {
        type: 'openingBrowser',
        message: `🌐 正在打开部署页面...`,
        depth,
        sessionId
      })
      
      try {
        if (!_browserViewManager.isReady()) {
          await _browserViewManager.attach()
        }
        
        await _browserViewManager.navigate(targetUrl)
        _browserViewManager.show()
        _browserViewManager.notifyFrontend('browser')
        console.log('[ScriptAutoExec] 侧边栏浏览器已打开:', targetUrl)

        // 推送进度：浏览器已打开
        win.webContents.send('ai:followUpProgress', {
          type: 'browserOpened',
          message: `✅ 页面已打开`,
          depth,
          sessionId
        })
      } catch (browserErr) {
        console.error('[ScriptAutoExec] followUp 打开浏览器失败:', browserErr.message)
        win.webContents.send('ai:followUpProgress', {
          type: 'error',
          message: `❌ 打开浏览器失败: ${browserErr.message}`,
          depth,
          sessionId
        })
      }

      // 推送进度：规划浏览器操作
      win.webContents.send('ai:followUpProgress', {
        type: 'planningBrowserAction',
        message: `🤖 正在规划浏览器操作...`,
        depth: depth + 1,
        sessionId
      })

      // 浏览器打开后，继续触发 followUp 让 AI 执行后续操作（如自动点击等）
      const browserFollowUp = await triggerFollowUp({
        scriptId,
        description: `浏览器已打开 ${targetUrl}`,
        stdout: `浏览器已在右侧面板打开页面: ${targetUrl}`,
        exitCode: 0,
        userInput, empId, sessionId,
        scriptTemplate,
        contextMode, contextSize, webSearched, win,
        depth: depth + 1,
        scriptCwd
      })

      if (browserFollowUp) return browserFollowUp
      return result
    }

    // AI 返回了普通文本（总结/说明/浏览器操作计划）
    console.log('[ScriptAutoExec] AI 返回后续文本响应')

    // 用新 sessionId 发送文本消息，让前端把它当成一条新的 AI 回复
    const followUpSessionId = `followup_${Date.now()}`
    win.webContents.send('ai:sessionId', { sessionId: followUpSessionId })
    win.webContents.send('ai:streamChunk', { chunk: content, sessionId: followUpSessionId })
    win.webContents.send('ai:streamEnd', {
      success: true,
      content,
      webSearched,
      contextMode,
      contextSize,
      sessionId: followUpSessionId
    })
    
    // 浏览器操作意图已由 muse/router.js 在入口层统一路由到 Node ReAct 引擎(react-engine)
    
    return result
  } catch (error) {
    console.error('[ScriptAutoExec] 后续 AI 调用失败:', error.message)
    return null
  }
}

function abortStream() {
  if (currentStreamController) {
    currentStreamController.abort()
    currentStreamController = null
    console.log('[Main] 用户中断了流式响应')
    return { success: true }
  }
  return { success: false }
}


module.exports = { init, setBrowserViewManager, handleChat, handleChatStream, abortStream }

'use strict'

/**
 * 指令执行模块
 * 执行主人的直接指令、任务列表中的任务
 */

const path = require('path')
const fs = require('fs')
const { callAI } = require('../../shared/ai-client')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { sendLetter, pushTaskProgress, getMainWindow, pushLog } = require('./mailbox')
const { loadTasks, addTask, resumeTask, addSubtask, getSubtasks, updateTaskStatus } = require('./tasks')
const { writeJournal, WORKSPACE_DIR } = require('./core')
const ScriptExecutor = require('../script-executor')
const { MAX_SCRIPT_RETRIES, MAX_REPAIR_ATTEMPTS, SCRIPT_TIMEOUT, TASK_COMMAND_DISPLAY_LENGTH, AI_TIMEOUT_SHORT, AI_TIMEOUT_NORMAL, AI_TIMEOUT_LONG, LARGE_FILE_THRESHOLD, PREVIEW_FILE_EXTENSIONS, PREVIEW_FILE_MAX_SIZE, ERROR_LOG_DIR } = require('./config')
const { chunkedAnalyzeFile, isLargeFile } = require('./chunk-analyzer')
const { executeReAct } = require('./react-engine')
const { generateIncrementally } = require('./incremental-generator')
const { retrospectTask } = require('./retrospect')
const { editFileInPlace, shouldUseFileEdit } = require('./file-editor')
const { grepCode, globFiles, scanDirTree, readFileSlice, formatGrepResult, formatGlobResult } = require('./code-search')

/**
 * 写入错误日志文件，返回可访问的 URL
 */
function writeErrorLog(taskId, command, error, extra = {}) {
  try {
    if (!fs.existsSync(ERROR_LOG_DIR)) {
      fs.mkdirSync(ERROR_LOG_DIR, { recursive: true })
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${taskId}_${timestamp}.md`
    const filepath = path.join(ERROR_LOG_DIR, filename)

    const content = [
      `# 错误日志`,
      `- **任务ID**: ${taskId}`,
      `- **时间**: ${new Date().toISOString()}`,
      `- **指令**: ${command}`,
      ``,
      `## 错误信息`,
      '```',
      typeof error === 'string' ? error : JSON.stringify(error, null, 2),
      '```',
      extra.repairAttempts ? `\n## 自动修复\n- 尝试次数: ${extra.repairAttempts}` : '',
      extra.repairStrategies?.length ? `- 修复策略: ${extra.repairStrategies.join(' → ')}` : '',
      extra.script ? `\n## 执行脚本\n\`\`\`\n${extra.script}\`\`\`` : '',
      extra.stdout ? `\n## 标准输出\n\`\`\`\n${extra.stdout}\`\`\`` : '',
    ].filter(Boolean).join('\n')

    fs.writeFileSync(filepath, content, 'utf8')
    pushLog('📝 错误日志已写入:' + ' ' + String(filepath).slice(0,80), 'info', null)
    return { filepath, filename }
  } catch (err) {
    pushLog('错误日志写入失败:' + ' ' + String(err.message).slice(0,80), 'error', null)
    return null
  }
}

/**
 * 执行主人的直接指令
 * 快速响应：写入任务清单后立即反馈，由心跳自主执行
 */
async function executeCommand(command) {
  pushLog('🎯 接收指令: ' + command, 'info', null)

  try {
    // 快速分析指令，生成理解
    const context = gatherOwnerContext()
    
    // 获取最近的任务历史，帮助理解上下文
    const recentTasks = loadTasks().slice(0, 5)
    const failedTasks = recentTasks.filter(t => t.status === 'failed')
    const suspendedTasks = recentTasks.filter(t => t.status === 'suspended')
    
    const taskContext = `
【最近的任务】
${recentTasks.length > 0 ? recentTasks.map(t => `- ${t.id}: ${t.command.slice(0, TASK_COMMAND_DISPLAY_LENGTH)}... (${t.status})`).join('\n') : '无'}

【失败的任务】
${failedTasks.length > 0 ? failedTasks.map(t => `- ${t.id}: ${t.command.slice(0, TASK_COMMAND_DISPLAY_LENGTH)}...`).join('\n') : '无'}

【挂起的任务】
${suspendedTasks.length > 0 ? suspendedTasks.map(t => `- ${t.id}: ${t.command.slice(0, TASK_COMMAND_DISPLAY_LENGTH)}...`).join('\n') : '无'}
`

    const analyzePrompt = `${SOUL_PROMPT}

主人下达了指令：

【指令内容】
${command}
${taskContext}

请理解主人意图，返回纯 JSON：
{
  "understood": "你对指令的理解（30字以内）",
  "action": "new_task|resume_task|reference_task",
  "taskId": "如果是 resume 或 reference，任务 ID 是什么",
  "isNewCommand": true/false
}

注意：
- 如果主人说"继续"、"重试"、"再试一次"，可能是 resume_task
- 如果主人提到之前的任务（如"还记得..."），可能是 reference_task
- 如果是全新指令，action 为 new_task
- 返回纯 JSON，不要解释`

    // AI 分析指令意图（网络失败时降级为直接记录任务）
    let analysis = null
    try {
      const analyzeResponse = await callAI(analyzePrompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_SHORT
      })
      analysis = parseMuseResponse(analyzeResponse)
    } catch (analyzeErr) {
      console.warn('[Muse] 指令分析失败，降级为直接记录任务:', analyzeErr.message)
    }
    let understood = analysis?.understood || command.slice(0, 50)
    let finalCommand = command

    // 如果是恢复或引用旧任务
    if ((analysis?.action === 'resume_task' || analysis?.action === 'reference_task') && analysis?.taskId) {
      const oldTask = loadTasks().find(t => t.id === analysis.taskId)
      if (oldTask) {
        pushLog('🔄 引用旧任务:' + ' ' + String(oldTask.id) + ' 动作: ' + analysis.action, 'info', null)
        
        // resume_task: 仅对失败/挂起的任务恢复执行
        if (analysis.action === 'resume_task' && (oldTask.status === 'failed' || oldTask.status === 'suspended')) {
          resumeTask(oldTask.id)
          understood = `恢复执行任务：${oldTask.command.slice(0, TASK_COMMAND_DISPLAY_LENGTH)}...`
          finalCommand = oldTask.command // 使用原始命令
          
          sendLetter({
            title: understood,
            content: `好的，我找到了之前的任务，正在继续执行：\n\n**${oldTask.command}**\n\n完成后会通知你查收。`,
            priority: 'normal',
            source: 'command'
          })
          
          pushLog('🔄 旧任务已恢复:' + ' ' + String(oldTask.id).slice(0,80), 'info', null)
          return { success: true, taskId: oldTask.id, understood, resumed: true }
        }
        
        // reference_task 或已完成的 resume_task: 旧任务上下文存到独立字段，不污染 command 显示
        pushLog('📎 基于旧任务创建新任务，旧任务状态:' + ' ' + String(oldTask.status).slice(0,80), 'info', null)
        understood = `${understood}（引用旧任务 ${oldTask.id}）`
      }
    }

    // 创建新任务
    const task = addTask(finalCommand, 'high')

    // 如果引用了旧任务，把上下文存到 task 的独立字段
    if (analysis?.taskId) {
      const oldTask = loadTasks().find(t => t.id === analysis.taskId)
      if (oldTask) {
        updateTaskStatus(task.id, {
          referenceContext: buildOldTaskContext(oldTask),
          referenceTaskId: oldTask.id
        })
      }
    }

    // 写入日志
    writeJournal(`**主人指令**: ${command}\n**理解**: ${understood}\n**任务ID**: ${task.id}`, 'command')

    // 接收任务不发来信，等拆解后再确认
    pushLog('📝 任务已记录: ' + task.id, 'info', task.id)

    // 立即触发一次心跳，不等下一轮定时器
    // 如果当前正在执行其他任务（锁被占用），心跳内部会自动跳过，等手头任务结束后的下一轮心跳再处理
    setImmediate(() => {
      const { heartbeat } = require('./heartbeat')
      heartbeat().catch(err => pushLog('立即触发心跳失败:' + ' ' + String(err.message).slice(0,80), 'error', null))
    })

    return { success: true, taskId: task.id, understood }
  } catch (err) {
    pushLog('任务记录失败:' + ' ' + String(err.message).slice(0,80), 'error', null)
    sendLetter({
      title: '任务记录失败',
      content: `主人，你的指令「${command}」我没能记录成功，能再说一次吗？错误：${err.message}`,
      priority: 'high',
      source: 'command'
    })
    return { success: false, error: err.message }
  }
}

/**
 * 执行任务列表中的任务
 */
async function executeTaskFromList(task) {
  pushLog('🚀 执行任务: ' + task.id, 'info', task.id)
  
  // 更新任务状态为执行中
  updateTaskStatus(task.id, {
    status: 'executing',
    startedAt: new Date().toISOString(),
    attempts: (task.attempts || 0) + 1
  })

  // 为任务创建隔离的工作目录
  const taskDir = getTaskDir(task.id)
  pushLog('📂 任务工作目录: ' + taskDir, 'info', task.id)

  const context = gatherOwnerContext()
  context.taskDir = taskDir
  const command = task.command

  // 检索过往经验（知识闭环：让积累的教训/洞察/记忆参与决策）
  let pastExperience = ''
  try {
    const { retrieveRelevant } = require('./knowledge')
    pastExperience = retrieveRelevant(command, 5)
    if (pastExperience) {
      pushLog('🧠 检索到过往经验，注入任务分析', 'info', task.id)
    }
  } catch (err) {
    console.warn('[Muse] 经验检索失败:', err.message)
  }

  // 注入主人反馈历史（来信回复驱动执行）
  let feedbackSection = ''
  if (task.feedbackHistory?.length > 0) {
    const recentFeedback = task.feedbackHistory.slice(-3)
    feedbackSection = `\n【主人的反馈指示】\n${recentFeedback.map(f => `- [${f.intent}] ${f.reply}（${f.understood}）`).join('\n')}\n请务必参考主人的反馈来执行任务。`
  }
  if (task.modificationHistory?.length > 0) {
    const recentMods = task.modificationHistory.slice(-2)
    feedbackSection += `\n【主人的修改要求】\n${recentMods.map(m => `- ${m.request}${m.newRequirements ? '，新需求: ' + m.newRequirements : ''}`).join('\n')}`
  }

  // 分析任务策略
  const analyzePrompt = `${SOUL_PROMPT}

主人下达了指令：

【指令内容】
${command}

【当前上下文】
- 记忆：${context.memories ? '有记忆数据' : '无记忆'}
- 最近对话：${context.recentHistory ? context.recentHistory.slice(0, 300) : '无'}
- 主人画像：${context.profile ? context.profile.slice(0, 300) : '未建立'}

【环境信息】
工作区目录：${context.workspace || '未知'}
${context.systemTools || '无系统工具信息'}${feedbackSection}${pastExperience ? `\n\n【过往经验（历史积累，非当前任务状态）】\n${pastExperience}` : ''}${task.referenceContext ? `\n\n${task.referenceContext}` : ''}

分析这个任务，以 JSON 格式返回：
{
  "understood": "你对指令的理解（30字以内）",
  "isComplex": true/false,
  "shouldSplit": true/false,
  "subtasks": ["子任务1", "子任务2", ...],
  "needsExecution": true/false,
  "isCodeTask": true/false,
  "codeTaskDir": "代码任务的目标目录（如果 isCodeTask 为 true）",
  "editExistingFile": true/false,
  "editTargetFiles": ["要编辑的文件路径1", ...],
  "editRequest": "编辑需求描述（如果 editExistingFile 为 true）",
  "scriptLanguage": "python|node|bash|null",
  "outputFormat": "预期输出格式（如：SVG文件、文本报告等）",
  "verificationMethod": "如何验证成功（如：检查文件是否存在、检查SVG格式等）",
  "maxRetries": ${MAX_SCRIPT_RETRIES},
  "shouldNotifyOwner": "执行完成后是否应该立即通知主人验收（true/false）",
  "notifyReason": "如果应该通知，为什么（如：任务已完成、需要主人确认等）",
  "needsOwnerDecision": true/false,
  "decisionQuestion": "如果需要主人决策，问题是什么",
  "needsConfirmBeforeExec": true/false
}

注意：
- 如果任务复杂（如生成多种类型的内容），isComplex 为 true
- 如果可以拆分成独立的子任务，shouldSplit 为 true，并列出 subtasks
- 如果需要主人决策（如选择方案），needsOwnerDecision 为 true
- 【重要】如果任务需要在某个代码项目/仓库中搜索、阅读、修改代码（如"帮我改一下项目里的登录按钮"、"在 xxx 项目中添加一个接口"），设 isCodeTask 为 true，填写 codeTaskDir（项目根目录）。代码任务会使用渐进式搜索→读取→编辑的方式完成。
- 【重要】如果任务是修改工作区内已有的产物文件（如"颜色改深一点"、"标题字体换大"），设 editExistingFile 为 true，填写 editTargetFiles 和 editRequest。精确编辑比重新生成更高效。
- 【重要】对于创造性任务（如生成PPT、设计海报、做网站等），必须设 needsOwnerDecision 为 true，在 decisionQuestion 中说明你打算用什么方案/工具/技术来实现，让主人确认后再动手。不要自作主张选择实现方式。
- 【重要】needsConfirmBeforeExec：拆解后是否需要主人确认再执行。对于简单、低风险、明确的任务（如发帖、查询信息、执行日常操作等），设为 false，直接执行不打扰主人。对于复杂、高风险、涉及大量修改或不可逆操作的任务，设为 true，等主人确认后再执行。
- 【重要】优先使用成熟的库/工具来完成任务。例如生成PPT应使用pptx库而非用HTML模拟，生成PDF应使用专业库而非截图。在 decisionQuestion 中告知主人你打算使用的工具/库。
- 返回纯 JSON，不要解释`

  let strategy = null
  try {
    const analyzeResponse = await callAI(analyzePrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })
    strategy = parseMuseResponse(analyzeResponse)
  } catch (strategyErr) {
    // AI 调用失败（如网络不可达），任务回退为 pending 等待重试
    const attempts = (task.attempts || 0) + 1
    pushLog(`❌ 任务策略分析失败 (第${attempts}次): ${strategyErr.message}`, 'error', task.id)
    if (attempts >= 5) {
      updateTaskStatus(task.id, { status: 'failed', error: strategyErr.message })
      sendLetter({
        title: '任务执行失败',
        content: `主人，任务「${command.slice(0, 100)}」多次重试后仍失败：${strategyErr.message}\n\n你可以告诉我「重试」来重新执行。`,
        priority: 'high',
        source: 'task',
        taskId: task.id
      })
    } else {
      updateTaskStatus(task.id, { status: 'pending', lastError: strategyErr.message })
      pushLog('⏳ 任务回退为 pending，等待下次心跳重试', 'warn', task.id)
    }
    return
  }

  if (!strategy) {
    throw new Error('任务分析失败')
  }

  pushLog('📋 任务策略: ' + (strategy.understood || ''), 'info', task.id)

  // 执行中主动提问：AI 判断需要主人决策时，暂停任务来信询问
  if (strategy.needsOwnerDecision && strategy.decisionQuestion) {
    pushLog('❓ 需要你的决定，任务已暂停', 'warn', task.id)
    updateTaskStatus(task.id, {
      status: 'waiting_reply',
      waitingReason: strategy.decisionQuestion,
      waitingSince: new Date().toISOString()
    })

    sendLetter({
      title: `❓ 需要你的决定`,
      content: `主人，我在执行任务时遇到了不确定的地方，需要你帮我决定：\n\n**任务**: ${command.slice(0, 200)}\n\n**问题**: ${strategy.decisionQuestion}\n\n请回复告诉我你的想法，我会根据你的回复继续执行。`,
      priority: 'high',
      source: 'task',
      taskId: task.id
    })

    writeJournal(`**任务暂停等待决策**: ${command.slice(0, 100)}\n问题: ${strategy.decisionQuestion}`, 'task')
    return
  }

  // 检查是否需要拆解子任务
  if (strategy.shouldSplit && strategy.subtasks && strategy.subtasks.length > 0) {
    // 规范化 subtasks：AI 可能返回对象数组而非字符串数组，直接拼接会变成 [object Object]
    const normalizedSubtasks = strategy.subtasks.map(s => {
      if (typeof s === 'string') return s
      if (typeof s === 'object' && s !== null) {
        return s.name || s.task || s.command || s.description || s.desc || JSON.stringify(s)
      }
      return String(s)
    })

    pushLog('🔀 任务拆解为 ' + normalizedSubtasks.length + ' 个子任务', 'info', task.id)
    
    // 清理旧的子任务（如果父任务被重新拆解）
    const existingSubtasks = getSubtasks(task.id)
    if (existingSubtasks.length > 0) {
      pushLog('🗑️ 清理旧子任务:' + ' ' + existingSubtasks.length + ' 个', 'info', null)
      const tasks = loadTasks()
      const oldSubtaskIds = existingSubtasks.map(st => st.id)
      const filteredTasks = tasks.filter(t => !oldSubtaskIds.includes(t.id))
      require('./tasks').saveTasks(filteredTasks)
    }
    
    // 创建所有子任务
    pushLog('🔀 开始创建' + ' ' + normalizedSubtasks.length + ' 个子任务', 'info', null)
    for (let i = 0; i < normalizedSubtasks.length; i++) {
      const subtaskCmd = normalizedSubtasks[i]
      const subtask = addSubtask(task.id, subtaskCmd, { priority: 'high' })
      pushLog('📎 子任务 ' + i + 1 + '/' + normalizedSubtasks.length + ' 已创建:', 'info', null)
    }

    // 判断是否需要主人确认再执行
    if (strategy.needsConfirmBeforeExec === false) {
      // 简单任务：直接执行，不打扰主人
      updateTaskStatus(task.id, {
        status: 'executing',
        suspendReason: null
      })

      pushLog('▶️ 简单任务，直接执行 ' + normalizedSubtasks.length + ' 个子任务', 'info', task.id)
      writeJournal(`**任务拆解直接执行**: ${command.slice(0, 100)}\n子任务: ${normalizedSubtasks.length} 个`, 'task')

      const taskDir = getTaskDir(task.id)
      setImmediate(() => {
        const { executeSubtasksSequentially } = require('./command')
        executeSubtasksSequentially(task.id, taskDir).catch(e => console.error('[Muse] 子任务执行异常:', e.message))
      })
      return
    }

    // 复杂/高风险任务：等待主人确认再执行
    updateTaskStatus(task.id, {
      status: 'waiting_reply',
      waitingReason: 'task_plan_review',
      waitingSince: new Date().toISOString(),
      suspendReason: `等待主人确认 ${normalizedSubtasks.length} 个子任务`
    })

    sendLetter({
      title: `📋 任务已拆解，请确认`,
      content: `主人，我已将任务拆解为 ${normalizedSubtasks.length} 个子任务：\n\n${normalizedSubtasks.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n确认无误请回复"**开始**"，需要调整请告诉我。`,
      priority: 'high',
      source: 'task',
      taskId: task.id
    })

    writeJournal(`**任务拆解等待确认**: ${command.slice(0, 100)}\n子任务: ${normalizedSubtasks.length} 个`, 'task')
    pushLog('📋 任务已拆解，等待你确认', 'info', task.id)
    return
  }

  // 代码任务：渐进式搜索→读取→编辑循环
  if (strategy.isCodeTask && strategy.codeTaskDir) {
    pushLog('🔍 代码任务模式: ' + strategy.codeTaskDir, 'info', task.id)
    const codeResult = await executeCodeTask(command, strategy, context, taskDir)

    if (codeResult.success) {
      const editedSummary = codeResult.editedFiles?.length > 0
        ? `已编辑 ${codeResult.editedFiles.length} 个文件：\n${codeResult.editedFiles.map(f => `- ${f}`).join('\n')}`
        : ''

      // 有编辑过文件 → 等主人确认
      if (codeResult.editedFiles?.length > 0) {
        updateTaskStatus(task.id, {
          status: 'waiting_reply',
          waitingReason: 'code_task_review',
          waitingSince: new Date().toISOString(),
          result: codeResult,
          codeTaskDir: strategy.codeTaskDir
        })
        sendLetter({
          title: `🔍 代码修改完成，请确认`,
          content: `主人，代码任务已完成：\n\n**${command.slice(0, 200)}**\n\n${codeResult.summary || ''}\n\n${editedSummary}\n\n如果满意请回复"**好的**"，需要继续修改请直接告诉我。`,
          priority: 'high',
          source: 'task',
          taskId: task.id
        })
      } else {
        updateTaskStatus(task.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          result: codeResult
        })
        sendLetter({
          title: `✅ 代码任务完成`,
          content: `主人，代码任务已完成：\n\n**${command.slice(0, 200)}**\n\n${codeResult.summary || '执行成功'}`,
          priority: 'normal',
          source: 'task',
          taskId: task.id
        })
        setImmediate(() => retrospectTask({ ...task, status: 'completed', completedAt: new Date().toISOString() }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
      }
      return
    }

    // 代码任务失败，降级到脚本生成
    pushLog('⚠️ 代码任务失败，降级到脚本生成', 'warn', task.id)
  }

  // 精确编辑已有文件
  if (strategy.editExistingFile && strategy.editTargetFiles?.length > 0) {
    pushLog('✏️ 精确编辑文件: ' + (strategy.editTargetFiles || []).join(', '), 'info', task.id)
    const editResults = []
    let allEditSuccess = true

    for (const targetFile of strategy.editTargetFiles) {
      const absPath = path.isAbsolute(targetFile) ? targetFile : path.join(taskDir, targetFile)
      const result = await editFileInPlace(absPath, strategy.editRequest || command, {
        originalCommand: command,
        feedbackHistory: task.feedbackHistory?.map(f => f.reply)
      })
      editResults.push({ file: path.basename(absPath), ...result })
      if (!result.success) allEditSuccess = false
    }

    if (allEditSuccess) {
      const editSummary = editResults.map(r => `- ${r.file}: ${r.editCount} 处修改`).join('\n')
      const outputFiles = strategy.editTargetFiles.map(f => path.isAbsolute(f) ? f : path.join(taskDir, f))
      const previewContent = buildArtifactPreview(outputFiles, taskDir)

      if (previewContent) {
        updateTaskStatus(task.id, {
          status: 'waiting_reply',
          waitingReason: 'artifact_preview',
          waitingSince: new Date().toISOString(),
          result: { editResults, outputFiles }
        })
        sendLetter({
          title: `✏️ 文件已修改，请查收`,
          content: `主人，我已精确编辑了文件：\n\n${editSummary}\n\n${previewContent}\n\n如果满意请回复"**好的**"，需要继续修改请直接告诉我。`,
          priority: 'high',
          source: 'task',
          taskId: task.id
        })
        return
      }

      updateTaskStatus(task.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: { editResults, outputFiles }
      })
      sendLetter({
        title: `✅ 文件编辑完成`,
        content: `主人，文件已精确修改：\n\n${editSummary}`,
        priority: 'normal',
        source: 'task',
        taskId: task.id
      })
      setImmediate(() => retrospectTask({ ...task, status: 'completed', completedAt: new Date().toISOString() }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
      return
    }

    // 精确编辑失败，降级到脚本重新生成
    pushLog('⚠️ 精确编辑失败，降级到脚本生成', 'warn', task.id)
  }

  // 简单任务，直接执行
  pushLog('🎯 执行任务...', 'info', task.id)
  
  if (strategy.needsExecution && strategy.scriptLanguage) {
    // 需要脚本执行
    const result = await executeWithIteration(command, strategy, context, MAX_SCRIPT_RETRIES, taskDir)
    
    if (result.success) {
      // 自动在 BrowserView 侧边栏打开 HTML 产物预览
      autoOpenHtmlPreview(result.outputFiles)

      // 检查是否有可预览的产物 → 发预览来信等反馈，而非直接完成
      const previewContent = buildArtifactPreview(result.outputFiles, taskDir)
      if (previewContent) {
        pushLog('🖼️ 任务完成，发送预览', 'success', task.id)
        updateTaskStatus(task.id, {
          status: 'waiting_reply',
          waitingReason: 'artifact_preview',
          waitingSince: new Date().toISOString(),
          result
        })

        sendLetter({
          title: `🖼️ 任务完成，请查收预览`,
          content: `主人，任务已执行完成：\n\n**${command.slice(0, 200)}**\n\n${previewContent}\n\n如果满意请回复"**好的**"或"**通过**"，如果需要修改请直接告诉我（如"颜色太深了"、"字体换大一点"），我会立即修改。`,
          priority: 'high',
          source: 'task',
          taskId: task.id
        })
        return
      }

      updateTaskStatus(task.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result
      })
      
      if (strategy.shouldNotifyOwner) {
        sendLetter({
          title: `✅ 任务完成`,
          content: `任务已完成：${command}\n\n结果：${result.result?.slice(0, 500) || '执行成功'}`,
          priority: 'normal',
          source: 'task',
          taskId: task.id
        })
      }
      // 异步复盘，不阻塞主流程
      setImmediate(() => retrospectTask({ ...task, status: 'completed', completedAt: new Date().toISOString() }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
    } else {
      updateTaskStatus(task.id, {
        status: 'failed',
        error: result.lastError || '执行失败',
        result
      })
      
      const errorLog = writeErrorLog(task.id, command, result.lastError, {
        script: result.script,
        stdout: result.result
      })
      sendLetter({
        title: `❌ 任务执行失败`,
        content: `任务执行失败：${command}\n\n错误：${result.lastError}${errorLog ? `\n\n📋 详细错误日志：\`${errorLog.filename}\`\n路径：\`${errorLog.filepath}\`` : ''}\n\n请告诉我如何处理。`,
        priority: 'high',
        source: 'task',
        taskId: task.id
      })
      // 异步复盘失败任务
      setImmediate(() => retrospectTask({ ...task, status: 'failed', error: result.lastError }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
    }
  } else {
    // 不需要脚本，直接AI分析
    const _simpleWin = getMainWindow()
    if (_simpleWin) _simpleWin.webContents.send('muse:log', { text: '思考中…', step: 1, type: 'step' })
    const result = await executeSimpleAction(command, strategy, context)
    const _simpleWin2 = getMainWindow()
    if (_simpleWin2) _simpleWin2.webContents.send('muse:log', { text: '已完成', step: 1, type: 'done' })
    
    updateTaskStatus(task.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result
    })
    
    if (strategy.shouldNotifyOwner) {
      sendLetter({
        title: `✅ 任务完成`,
        content: `任务已完成：${command}\n\n结果：${result.result?.slice(0, 500) || '处理完成'}`,
        priority: 'normal',
        source: 'task',
        taskId: task.id
      })
    }
    // 异步复盘
    setImmediate(() => retrospectTask({ ...task, status: 'completed', completedAt: new Date().toISOString() }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
  }
}

/**
 * 顺序执行子任务（含自动修复策略）
 * 借鉴 Devin Hierarchical Planner：子任务间传递累积上下文，失败后可动态重规划
 */
async function executeSubtasksSequentially(parentId, taskDir) {
  // 如果没传 taskDir，从父任务 id 推导
  if (!taskDir) taskDir = getTaskDir(parentId)
  pushLog('🚀 开始执行子任务链，父任务: ' + parentId, 'info', parentId)
  
  const tasks = loadTasks()
  const subtasks = tasks
    .filter(t => t.parentId === parentId)
    .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))

  pushLog('📋 共 ' + subtasks.length + ' 个子任务，开始执行', 'info', parentId)

  let allSuccess = true
  const results = []
  const executionContext = [] // 累积上下文：记录每个子任务的执行结果，传递给后续子任务
  let hasReplanned = false // 动态重规划只允许触发一次

  // 推送开始事件
  pushTaskProgress({
    taskId: parentId,
    status: 'executing',
    message: `开始执行 ${subtasks.length} 个子任务`,
    current: 0,
    total: subtasks.length
  })

  for (let i = 0; i < subtasks.length; i++) {
    const subtask = subtasks[i]

    // 跳过已完成/已关闭/已失败的子任务
    if (subtask.status === 'completed' || subtask.status === 'closed') {
      pushLog('⏭️ 跳过已完成子任务 #' + subtask.executionOrder, 'info', parentId)
      // 将已完成的结果加入累积上下文
      executionContext.push({
        order: subtask.executionOrder || (i + 1),
        command: subtask.command,
        success: true,
        output: subtask.result ? String(subtask.result?.result || '').slice(0, 500) : '(已完成)',
        outputFiles: subtask.result?.outputFiles || [],
        error: null
      })
      continue
    }

    pushLog('📦 执行子任务 ' + subtask.executionOrder + '/' + subtasks.length + ': ' + subtask.command.slice(0, 40), 'info', parentId)

    // 注入前序子任务的累积上下文
    subtask._previousResults = executionContext

    // 推送子任务开始
    pushTaskProgress({
      taskId: parentId,
      subtaskId: subtask.id,
      status: 'executing',
      message: `执行子任务 ${i + 1}/${subtasks.length}: ${subtask.command.slice(0, 50)}`,
      current: i + 1,
      total: subtasks.length
    })

    // 更新子任务状态
    updateTaskStatus(subtask.id, {
      status: 'executing',
      startedAt: new Date().toISOString(),
      attempts: (subtask.attempts || 0) + 1
    })

    // 注入任务工作目录
    subtask._taskDir = taskDir

    // 执行子任务（含自动修复）
    const result = await executeSingleSubtaskWithAutoRepair(subtask, (repairStatus) => {
      // 推送修复进度
      pushTaskProgress({
        taskId: parentId,
        subtaskId: subtask.id,
        status: 'repairing',
        message: `自动修复尝试 ${repairStatus.attempt}/${repairStatus.maxAttempts}: ${repairStatus.strategy}`,
        current: i + 1,
        total: subtasks.length,
        repairAttempts: repairStatus.attempt
      })
    })
    results.push({ subtaskId: subtask.id, command: subtask.command, result })

    // 子任务需要主人决策 → 暂停整个执行链，等待回复后恢复
    if (result.waitingReply) {
      pushLog('⏸️ 等待确认，暂停执行', 'warn', parentId)
      pushTaskProgress({
        taskId: parentId,
        subtaskId: subtask.id,
        status: 'waiting_reply',
        message: `子任务需要主人决策，等待回复`,
        current: i + 1,
        total: subtasks.length
      })
      return // 暂停整个执行链，等主人回复后由 heartbeat 恢复
    }

    // 记录到累积上下文
    executionContext.push({
      order: i + 1,
      command: subtask.command,
      success: result.success,
      output: result.result ? String(result.result).slice(0, 500) : '',
      outputFiles: result.outputFiles || [],
      error: result.success ? null : (result.error || result.lastError || null)
    })

    if (result.success) {
      updateTaskStatus(subtask.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result
      })
      pushLog('✅ 子任务完成: ' + subtask.command.slice(0, 40), 'success', parentId)
      
      // 推送完成进度
      pushTaskProgress({
        taskId: parentId,
        subtaskId: subtask.id,
        status: 'completed',
        message: `子任务 ${i + 1}/${subtasks.length} 完成`,
        current: i + 1,
        total: subtasks.length
      })

      // 检查是否有用户新增的待执行子任务（动态感知）
      const currentTasks = loadTasks()
      const existingIds = new Set(subtasks.map(st => st.id))
      const newSubtasks = currentTasks
        .filter(t => t.parentId === parentId && !existingIds.has(t.id) && t.status === 'pending')
        .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
      if (newSubtasks.length > 0) {
        pushLog('🆕 新增 ' + newSubtasks.length + ' 个子任务', 'info', parentId)
        subtasks.push(...newSubtasks)
      }
    } else {
      updateTaskStatus(subtask.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: result.error || '执行失败',
        result,
        repairAttempts: result.repairAttempts || 0
      })
      pushLog('❌ 子任务失败: ' + (result.error || '').slice(0, 60), 'error', parentId)

      // 尝试动态重规划剩余子任务（仅一次机会）
      if (!hasReplanned && i < subtasks.length - 1) {
        hasReplanned = true
        pushLog('🔄 重规划剩余子任务...', 'info', parentId)
        const remainingSubtasks = subtasks.slice(i + 1)
        const replanned = await replanRemainingSubtasks(parentId, subtask, remainingSubtasks, executionContext, result.error || result.lastError)
        if (replanned && replanned.length > 0) {
          pushLog('✅ 重规划成功，共 ' + replanned.length + ' 个子任务', 'success', parentId)
          // 删除旧的剩余子任务，用新子任务替换
          const allTasks = loadTasks()
          const remainingIds = remainingSubtasks.map(st => st.id)
          const cleaned = allTasks.filter(t => !remainingIds.includes(t.id))
          require('./tasks').saveTasks(cleaned)
          // 创建新子任务
          for (let j = 0; j < replanned.length; j++) {
            const newSt = addSubtask(parentId, replanned[j], { priority: 'high' })
            subtasks[i + 1 + j] = newSt // 替换到当前数组（后续循环会执行）
          }
          // 调整循环边界
          subtasks.length = i + 1 + replanned.length
          pushTaskProgress({
            taskId: parentId,
            status: 'replanning',
            message: `子任务失败，已动态重规划剩余 ${replanned.length} 个步骤`,
            current: i + 1,
            total: subtasks.length
          })
          continue // 跳过 break，继续执行重规划后的下一个子任务
        }
      }

      allSuccess = false
      
      // 推送失败进度
      pushTaskProgress({
        taskId: parentId,
        subtaskId: subtask.id,
        status: 'failed',
        message: `子任务 ${i + 1}/${subtasks.length} 失败: ${result.error}`,
        current: i + 1,
        total: subtasks.length,
        error: result.error,
        repairAttempts: result.repairAttempts || 0
      })
      
      // 子任务失败且自动修复也失败，写错误日志并通知主人
      const subtaskErrorLog = writeErrorLog(subtask.id, subtask.command, result.error, {
        repairAttempts: result.repairAttempts,
        repairStrategies: result.repairStrategies,
        script: result.script,
        stdout: result.result
      })
      sendLetter({
        title: `❌ 子任务执行失败（已自动修复${result.repairAttempts || 0}次）`,
        content: `子任务执行失败：${subtask.command}\n\n错误：${result.error}\n\n自动修复尝试：${result.repairAttempts || 0}次\n修复策略：${(result.repairStrategies || []).join(' → ') || '无'}${subtaskErrorLog ? `\n\n📋 详细错误日志：\`${subtaskErrorLog.filename}\`\n路径：\`${subtaskErrorLog.filepath}\`` : ''}\n\n请在任务面板中修改后重试，或告诉我如何处理。`,
        priority: 'high',
        source: 'task',
        taskId: parentId
      })
      break // 停止后续子任务
    }
  }

  // 所有子任务完成后，更新父任务状态
  if (allSuccess) {
    // 收集所有子任务产物
    const allOutputFiles = results.flatMap(r => r.result?.outputFiles || [])
    // 自动在 BrowserView 侧边栏打开 HTML 产物预览
    autoOpenHtmlPreview(allOutputFiles)
    const previewContent = buildArtifactPreview(allOutputFiles, taskDir)

    if (previewContent) {
      // 有产物 → 发预览来信等反馈
      pushLog('🖼️ 任务有产物，等待确认', 'success', parentId)
      updateTaskStatus(parentId, {
        status: 'waiting_reply',
        waitingReason: 'artifact_preview',
        waitingSince: new Date().toISOString(),
        result: { subtasks: results }
      })

      pushTaskProgress({
        taskId: parentId,
        status: 'waiting_reply',
        message: `所有子任务完成，等待主人确认产物`,
        current: subtasks.length,
        total: subtasks.length
      })

      sendLetter({
        title: `🖼️ 复杂任务完成，请查收预览`,
        content: `主人，${subtasks.length} 个子任务全部完成！\n\n${previewContent}\n\n如果满意请回复"**好的**"或"**通过**"，如果需要修改请直接告诉我（如"颜色太深了"、"字体换大一点"），我会立即修改。`,
        priority: 'high',
        source: 'task',
        taskId: parentId
      })
    } else {
      updateTaskStatus(parentId, {
        status: 'reviewing',
        completedAt: new Date().toISOString(),
        result: { subtasks: results },
        pendingReview: true
      })

      pushTaskProgress({
        taskId: parentId,
        status: 'completed',
        message: `所有 ${subtasks.length} 个子任务已完成`,
        current: subtasks.length,
        total: subtasks.length
      })

      sendLetter({
        title: `✅ 复杂任务完成`,
        content: `主人的任务已完成！\n\n共执行了 ${subtasks.length} 个子任务：\n${subtasks.map(st => `- ${st.command}`).join('\n')}\n\n请查收成果。`,
        priority: 'normal',
        source: 'task',
        taskId: parentId
      })
    }

    pushLog('✅ 全部子任务完成', 'success', parentId)
    // 异步复盘复杂任务
    const parentTask = loadTasks().find(t => t.id === parentId)
    if (parentTask) {
      setImmediate(() => retrospectTask({ ...parentTask, status: 'completed', completedAt: new Date().toISOString() }).catch(e => pushLog('复盘异常:' + ' ' + String(e.message).slice(0,80), 'warn', null)))
    }
  } else {
    updateTaskStatus(parentId, {
      status: 'suspended',
      suspendReason: '部分子任务失败且自动修复无效，等待主人处理'
    })
    
    // 推送挂起进度
    pushTaskProgress({
      taskId: parentId,
      status: 'suspended',
      message: '任务挂起：部分子任务失败',
      current: results.length,
      total: subtasks.length
    })
  }
}

/**
 * 动态重规划剩余子任务
 * 当某个子任务失败且自动修复无效时，基于已完成的上下文重新规划后续步骤
 */
async function replanRemainingSubtasks(parentId, failedSubtask, remainingSubtasks, executionContext, error) {
  const completedSummary = executionContext
    .map(r => `${r.order}. ${r.command} → ${r.success ? '✅成功' : '❌失败'}${r.output ? '\n   输出: ' + r.output.slice(0, 200) : ''}${r.error ? '\n   错误: ' + r.error : ''}`)
    .join('\n')

  const remainingSummary = remainingSubtasks
    .map((st, i) => `${i + 1}. ${st.command}`)
    .join('\n')

  // 获取父任务的原始指令
  const allTasks = loadTasks()
  const parentTask = allTasks.find(t => t.id === parentId)
  const originalCommand = parentTask ? parentTask.command : '未知'

  const replanPrompt = `${SOUL_PROMPT}

多步骤任务执行过程中，某个子任务失败了。请基于已完成的上下文，重新规划剩余步骤。

【原始任务】
${originalCommand}

【已执行的子任务】
${completedSummary}

【失败的子任务】
${failedSubtask.command}
错误：${error || '未知错误'}

【原计划剩余子任务】
${remainingSummary}

请分析失败原因，重新规划剩余步骤。以 JSON 格式返回：
{
  "canReplan": true/false,
  "reason": "重规划原因",
  "newSubtasks": ["新子任务1", "新子任务2", ...]
}

注意：
- 新计划应绕过失败原因，用替代方案完成剩余目标
- 可以合并、拆分或替换原有步骤
- 如果整个任务方向有误导致无法继续，返回 canReplan: false
- 返回纯 JSON`

  try {
    const response = await callAI(replanPrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })
    const result = parseMuseResponse(response)
    if (result && result.canReplan && result.newSubtasks && result.newSubtasks.length > 0) {
      // 规范化新子任务（防止 AI 返回对象数组）
      return result.newSubtasks.map(s => {
        if (typeof s === 'string') return s
        if (typeof s === 'object' && s !== null) {
          return s.name || s.task || s.command || s.description || s.desc || JSON.stringify(s)
        }
        return String(s)
      })
    }
    return null
  } catch (err) {
    pushLog('重规划失败:' + ' ' + String(err.message).slice(0,80), 'error', null)
    return null
  }
}

/**
 * 执行单个子任务（含自动修复策略）
 * P0改进：失败后尝试2次不同策略，而不是直接挂起
 */
async function executeSingleSubtaskWithAutoRepair(subtask, onRepairProgress) {
  pushLog('🔧 执行: ' + subtask.command.slice(0, 60), 'info', subtask.id)

  const taskDir = subtask._taskDir || getTaskDir(subtask.rootId || subtask.parentId || subtask.id)
  const context = gatherOwnerContext()
  context.taskDir = taskDir
  // 每次执行前刷新任务目录文件列表，感知前序子任务产生的新文件
  try {
    context.workspaceFiles = scanDirRecursive(taskDir).slice(0, 30)
    context.timestamp = new Date().toISOString()
  } catch {}
  const maxRepairAttempts = MAX_REPAIR_ATTEMPTS
  let repairAttempts = 0
  let repairStrategies = []
  let lastError = null

  // 第一次执行
  let result = await executeSingleSubtask(subtask, context)

  // 如果是等待主人回复，直接返回，不进入自动修复
  if (result.waitingReply) {
    return result
  }
  
  // 如果失败，尝试自动修复
  while (!result.success && repairAttempts < maxRepairAttempts) {
    repairAttempts++
    pushLog('🔧 子任务失败，尝试自动修复 ' + repairAttempts + '/' + maxRepairAttempts + ':', 'info', null)
    
    // 分析失败原因并生成修复策略
    const repairStrategy = await analyzeRepairStrategy(subtask.command, result.error, repairAttempts, context)
    
    if (!repairStrategy || !repairStrategy.canRepair) {
      pushLog('⚠️ 无法自动修复，等待你的决定', 'warn', subtask.id)
      repairStrategies.push('无法自动修复')
      break
    }
    
    repairStrategies.push(repairStrategy.strategy)
    pushLog('🔧 修复策略: ' + repairStrategy.strategy, 'info', subtask.id)
    
    // 通知外部修复进度
    if (onRepairProgress) {
      onRepairProgress({
        attempt: repairAttempts,
        maxAttempts: maxRepairAttempts,
        strategy: repairStrategy.strategy
      })
    }
    
    // 执行修复后的子任务
    result = await executeSingleSubtask(
      { ...subtask, command: repairStrategy.repairedCommand || subtask.command },
      context
    )
    
    if (result.success) {
      pushLog('✅ 自动修复成功', 'success', subtask.id)
      break
    }
    
    lastError = result.error
    pushLog('❌ 修复失败: ' + (result.error || ''), 'error', subtask.id)
  }

  return {
    ...result,
    repairAttempts,
    repairStrategies,
    lastError: lastError || result.error
  }
}

/**
 * 分析修复策略
 * 收集工作区文件快照等实际环境信息，帮助 AI 做出更精准的修复判断
 */
async function analyzeRepairStrategy(originalCommand, error, attemptNumber, context) {
  // 收集实际环境信息
  let workspaceSnapshot = ''
  try {
    const files = fs.readdirSync(WORKSPACE_DIR).filter(f => !f.startsWith('.') && !f.startsWith('temp_'))
    workspaceSnapshot = files.length > 0 ? files.slice(0, 20).join(', ') : '空'
  } catch { workspaceSnapshot = '无法读取' }

  const repairPrompt = `${SOUL_PROMPT}

子任务执行失败，需要自动修复。

【原始任务】
${originalCommand}

【错误信息】
${error || '未知错误'}

【工作区当前文件】
${workspaceSnapshot}

【当前尝试次数】
第 ${attemptNumber} 次修复尝试

请分析失败原因，并提供修复策略。以 JSON 格式返回：
{
  "canRepair": true/false,
  "strategy": "修复策略描述（如：更换Python库、简化逻辑、换用Node.js等）",
  "repairedCommand": "修复后的任务命令（如果需要修改）",
  "reason": "为什么这个策略可能成功"
}

修复策略建议：
- 第1次尝试：换一种实现方式（如Python换Node.js，或换库）
- 第2次尝试：简化任务逻辑，分步执行
- 如果确实无法修复，返回 canRepair: false

返回纯 JSON。`

  try {
    const response = await callAI(repairPrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const strategy = parseMuseResponse(response)
    return strategy
  } catch (err) {
    pushLog('修复策略分析失败:' + ' ' + String(err.message).slice(0,80), 'error', null)
    return { canRepair: false }
  }
}

/**
 * 执行单个子任务（基础版本）
 */
async function executeSingleSubtask(subtask, context) {

  if (!context) {
    context = gatherOwnerContext()
  }

  // 构建前序子任务的累积上下文
  const prevContext = (subtask._previousResults && subtask._previousResults.length > 0)
    ? `\n【前序子任务执行结果】\n${subtask._previousResults.map(r =>
        `${r.order}. ${r.command} → ${r.success ? '✅成功' : '❌失败'}` +
        (r.output ? `\n   输出: ${r.output.slice(0, 200)}` : '') +
        (r.outputFiles && r.outputFiles.length > 0 ? `\n   产物: ${r.outputFiles.join(', ')}` : '') +
        (r.error ? `\n   错误: ${r.error}` : '')
      ).join('\n')}`
    : ''

  // 注入父任务的主人反馈历史（来信回复驱动执行的核心）
  let feedbackContext = ''
  if (subtask.parentId || subtask.rootId) {
    const parentId = subtask.rootId || subtask.parentId
    const allTasks = loadTasks()
    const parentTask = allTasks.find(t => t.id === parentId)
    if (parentTask?.feedbackHistory?.length > 0) {
      const recentFeedback = parentTask.feedbackHistory.slice(-3)
      feedbackContext = `\n【主人的反馈指示】\n${recentFeedback.map(f =>
        `- [${f.intent}] ${f.reply}（${f.understood}）`
      ).join('\n')}\n请务必参考主人的反馈来执行当前子任务。`
    }
    if (parentTask?.modificationHistory?.length > 0) {
      const recentMods = parentTask.modificationHistory.slice(-2)
      feedbackContext += `\n【主人的修改要求】\n${recentMods.map(m =>
        `- ${m.request}${m.newRequirements ? '，新需求: ' + m.newRequirements : ''}`
      ).join('\n')}`
    }
  }

  // 分析子任务策略
  const analyzePrompt = `${SOUL_PROMPT}

执行子任务：

【子任务内容】
${subtask.command}

【父任务上下文】
${subtask.rootId ? '根任务: ' + subtask.rootId : ''}${prevContext}${feedbackContext}

分析这个子任务，以 JSON 格式返回：
{
  "understood": "理解（30字以内）",
  "needsExecution": true/false,
  "editExistingFile": true/false,
  "editTargetFiles": ["要编辑的文件路径1", ...],
  "editRequest": "编辑需求描述（如果 editExistingFile 为 true）",
  "scriptLanguage": "python|node|bash|null",
  "shouldNotifyOwner": false,
  "needsOwnerDecision": false,
  "shouldSplit": false,
  "subtasks": []
}

重要：
- 这是子任务，是最小执行单元，不允许再拆解为更小的任务。
- 如果任务是修改已有文件（如"颜色改深一点"、"标题换大"等），设 editExistingFile 为 true，精确编辑比重新生成更高效。
- 如果任务确实复杂，请标记 needsOwnerDecision: true，等待主人介入。
返回纯 JSON。`

  let analyzeResponse = await callAI(analyzePrompt, {
    sessionId: getMuseSessionId(),
    timeout: AI_TIMEOUT_SHORT
  })

  let strategy = parseMuseResponse(analyzeResponse)
  if (!strategy) {
    pushLog('⚠️ 子任务分析首次解析失败', 'warn', null)
    // 用简化 prompt 重试一次
    const fallbackPrompt = `分析任务并返回 JSON：\n任务：${subtask.command.slice(0, 300)}\n返回格式：{"understood":"理解","needsExecution":true,"scriptLanguage":"node","shouldNotifyOwner":false,"needsOwnerDecision":false,"shouldSplit":false,"subtasks":[]}\n只返回 JSON。`
    analyzeResponse = await callAI(fallbackPrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })
    strategy = parseMuseResponse(analyzeResponse)
    if (!strategy) {
      pushLog('❌ 子任务分析重试仍失败，使用默认策略', 'error', null)
      // 兜底：默认用 node 执行
      strategy = {
        understood: subtask.command.slice(0, 30),
        needsExecution: true,
        scriptLanguage: 'node',
        shouldNotifyOwner: false,
        needsOwnerDecision: false,
        shouldSplit: false,
        subtasks: []
      }
    }
  }

  // 子任务执行中主动提问：AI 判断需要主人决策时，返回特殊结果让父流程暂停
  if (strategy.needsOwnerDecision) {
    const parentId = subtask.rootId || subtask.parentId
    pushLog('❓ 需要你的决定，任务暂停', 'warn', subtask.id)
    
    updateTaskStatus(subtask.id, {
      status: 'waiting_reply',
      waitingReason: strategy.decisionQuestion || '需要主人决策',
      waitingSince: new Date().toISOString()
    })

    if (parentId) {
      updateTaskStatus(parentId, {
        status: 'waiting_reply',
        waitingReason: `子任务需要主人决策: ${strategy.decisionQuestion || ''}`,
        waitingSince: new Date().toISOString()
      })
    }

    sendLetter({
      title: `❓ 执行中遇到问题，需要你的决定`,
      content: `主人，我在执行子任务时遇到了不确定的地方：\n\n**子任务**: ${subtask.command.slice(0, 200)}\n\n**问题**: ${strategy.decisionQuestion || '需要你的指示'}\n\n请回复告诉我你的想法，我会根据你的回复继续执行。`,
      priority: 'high',
      source: 'task',
      taskId: parentId || subtask.id
    })

    return { success: false, error: 'waiting_for_owner_decision', waitingReply: true }
  }

  // 大文件检测：如果 command 中引用了大文件，走分块分析路径
  const largeFileResult = await tryChunkedFileAnalysis(subtask.command, context)
  if (largeFileResult) {
    return largeFileResult
  }

  // 精确编辑已有文件
  if (strategy.editExistingFile && strategy.editTargetFiles?.length > 0) {
    pushLog('✏️ 精确编辑文件: ' + (strategy.editTargetFiles || []).join(', '), 'info', subtask.id)
    const taskDir = subtask._taskDir || getTaskDir(subtask.rootId || subtask.parentId || subtask.id)
    let allEditSuccess = true
    const editResults = []

    for (const targetFile of strategy.editTargetFiles) {
      const absPath = path.isAbsolute(targetFile) ? targetFile : path.join(taskDir, targetFile)
      const result = await editFileInPlace(absPath, strategy.editRequest || subtask.command, {
        originalCommand: subtask.command,
        feedbackHistory: subtask._previousResults?.map(r => r.output).filter(Boolean)
      })
      editResults.push({ file: path.basename(absPath), ...result })
      if (!result.success) allEditSuccess = false
    }

    if (allEditSuccess) {
      const editSummary = editResults.map(r => `${r.file}: ${r.editCount} 处修改`).join(', ')
      return {
        success: true,
        action: 'edit_file',
        actionDescription: `精确编辑完成: ${editSummary}`,
        result: editSummary,
        outputFiles: strategy.editTargetFiles.map(f => path.isAbsolute(f) ? f : path.join(taskDir, f))
      }
    }
    // 精确编辑失败，降级到脚本生成
    pushLog('⚠️ 精确编辑失败，降级到脚本生成', 'warn', subtask.id)
  }

  // 执行子任务
  if (strategy.needsExecution && strategy.scriptLanguage) {
    return await executeWithIteration(subtask.command, strategy, context)
  } else {
    return await executeSimpleAction(subtask.command, strategy, context)
  }
}


// ========== 代码任务：渐进式搜索→读取→编辑 ==========

const MAX_CODE_TASK_ROUNDS = 8

/**
 * 执行代码任务：多轮 AI 驱动的搜索→读取→编辑循环
 * 
 * 每轮 AI 返回一个 action 指令，Muse 执行后把结果反馈给 AI 继续下一轮：
 *   - grep: 搜索关键词
 *   - glob: 按文件名模式匹配
 *   - tree: 扫描目录树
 *   - read: 读取文件指定行范围
 *   - edit: 精确编辑文件
 *   - done: 任务完成
 */
async function executeCodeTask(command, strategy, context, taskDir) {
  const codeDir = strategy.codeTaskDir
  pushLog('🔍 代码任务，目标: ' + codeDir, 'info', null)

  // 第一步：扫描目录树，给 AI 一个全局视角
  const treeResult = scanDirTree(codeDir, { maxDepth: 3, maxFiles: 150 })
  const taskHeader = `【任务】\n${command}\n\n【项目目录结构】\n${treeResult.tree}\n`
  // 每轮操作记录，用于滑动窗口截断
  const roundLogs = [] // [{ round, action, summary, content }]

  const editedFiles = []
  let lastError = null

  // 构建 conversationHistory：只保留最近 CONTEXT_WINDOW_ROUNDS 轮的详细内容，更早的压缩为摘要
  const CONTEXT_WINDOW_ROUNDS = 6

  function buildConversationHistory() {
    if (roundLogs.length === 0) return taskHeader
    const recentStart = Math.max(0, roundLogs.length - CONTEXT_WINDOW_ROUNDS)
    const archiveLogs = roundLogs.slice(0, recentStart)
    const recentLogs = roundLogs.slice(recentStart)
    let history = taskHeader
    if (archiveLogs.length > 0) {
      const archivedActions = archiveLogs.map(l => `  - 第${l.round}轮 ${l.action}: ${l.summary}`).join('\n')
      history += `\n【已执行操作摘要（第1-${archiveLogs[archiveLogs.length - 1].round}轮）】\n${archivedActions}\n`
    }
    for (const log of recentLogs) {
      history += log.content
    }
    return history
  }

  for (let round = 1; round <= MAX_CODE_TASK_ROUNDS; round++) {
    pushLog('🔄 代码任务第 ' + round + '/' + MAX_CODE_TASK_ROUNDS + ' 轮', 'info', null)

    const conversationHistory = buildConversationHistory()
    const actionPrompt = `${SOUL_PROMPT}

你正在帮主人完成一个代码任务。你可以使用以下工具来搜索、阅读和编辑代码：

可用工具：
1. grep - 搜索代码关键词: {"action":"grep","pattern":"搜索词","includePattern":"*.js","caseSensitive":false}
2. glob - 按文件名匹配: {"action":"glob","pattern":"*Controller.java"}
3. tree - 扫描子目录: {"action":"tree","subdir":"src/components"}
4. read - 读取文件: {"action":"read","file":"src/App.tsx","startLine":1,"endLine":100}
5. edit - 精确编辑文件: {"action":"edit","file":"src/App.tsx","edits":[{"old_string":"旧内容","new_string":"新内容"}]}
6. done - 任务完成: {"action":"done","summary":"完成了什么"}

${conversationHistory}
${lastError ? `【上一步错误】\n${lastError}\n` : ''}
请决定下一步操作。返回纯 JSON（单个 action 对象）。

重要：
- 先搜索定位，再读取理解，最后精确编辑
- 每次只执行一个 action
- edit 的 old_string 必须与文件内容完全一致
- 【禁止重复】已经搜索/读取过的内容不要再次搜索/读取，应基于已有信息直接决策
- 如果已完成所有修改，返回 done`

    try {
      const response = await callAI(actionPrompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_NORMAL
      })

      const action = parseMuseResponse(response)
      if (!action || !action.action) {
        lastError = 'AI 返回无法解析的指令'
        continue
      }

      pushLog('📌 第 ' + round + ' 轮: ' + action.action, 'info', null)
      lastError = null

      switch (action.action) {
        case 'grep': {
          const result = grepCode(codeDir, action.pattern, {
            includePattern: action.includePattern,
            caseSensitive: action.caseSensitive
          })
          const formatted = formatGrepResult(result)
          const logContent = `\n【第${round}轮 - grep "${action.pattern}"】\n${formatted}\n`
          roundLogs.push({ round, action: 'grep', summary: `grep "${action.pattern}" → ${result.matches?.length || 0} 条结果`, content: logContent })
          break
        }

        case 'glob': {
          const result = globFiles(codeDir, action.pattern)
          const formatted = formatGlobResult(result)
          const logContent = `\n【第${round}轮 - glob "${action.pattern}"】\n${formatted}\n`
          roundLogs.push({ round, action: 'glob', summary: `glob "${action.pattern}" → ${result.files?.length || 0} 个文件`, content: logContent })
          break
        }

        case 'tree': {
          const subDir = action.subdir ? path.join(codeDir, action.subdir) : codeDir
          const result = scanDirTree(subDir, { maxDepth: 3 })
          const logContent = `\n【第${round}轮 - tree "${action.subdir || '.'}"】\n${result.tree}\n`
          roundLogs.push({ round, action: 'tree', summary: `tree "${action.subdir || '.'}"`, content: logContent })
          break
        }

        case 'read': {
          const filePath = path.isAbsolute(action.file) ? action.file : path.join(codeDir, action.file)
          const result = readFileSlice(filePath, {
            startLine: action.startLine,
            endLine: action.endLine
          })
          if (result.error) {
            lastError = result.error
            const logContent = `\n【第${round}轮 - read "${action.file}" 失败】\n${result.error}\n`
            roundLogs.push({ round, action: 'read', summary: `read "${action.file}" 失败: ${result.error}`, content: logContent })
          } else {
            const logContent = `\n【第${round}轮 - read "${action.file}" (L${result.startLine}-${result.endLine}/${result.totalLines})】\n${result.content}\n`
            roundLogs.push({ round, action: 'read', summary: `read "${action.file}" L${result.startLine}-${result.endLine}`, content: logContent })
          }
          break
        }

        case 'edit': {
          const filePath = path.isAbsolute(action.file) ? action.file : path.join(codeDir, action.file)
          if (!action.edits || !Array.isArray(action.edits) || action.edits.length === 0) {
            lastError = 'edit 指令缺少 edits 数组'
            break
          }

          // 直接执行替换（不走 AI 再生成，因为 AI 已经给出了精确的 old/new）
          let fileContent
          try {
            fileContent = fs.readFileSync(filePath, 'utf8')
          } catch (err) {
            lastError = `文件读取失败: ${err.message}`
            const logContent = `\n【第${round}轮 - edit "${action.file}" 失败】\n${lastError}\n`
            roundLogs.push({ round, action: 'edit', summary: `edit "${action.file}" 失败`, content: logContent })
            break
          }

          let currentContent = fileContent
          let appliedCount = 0
          const editErrors = []

          for (let i = 0; i < action.edits.length; i++) {
            const edit = action.edits[i]
            if (!edit.old_string || edit.new_string === undefined) {
              editErrors.push(`编辑 #${i + 1}: 缺少字段`)
              continue
            }
            if (!currentContent.includes(edit.old_string)) {
              editErrors.push(`编辑 #${i + 1}: old_string 未找到`)
              continue
            }
            currentContent = currentContent.replace(edit.old_string, edit.new_string)
            appliedCount++
          }

          if (appliedCount > 0) {
            fs.writeFileSync(filePath, currentContent, 'utf8')
            editedFiles.push(action.file)
            const logContent = `\n【第${round}轮 - edit "${action.file}"】\n成功应用 ${appliedCount}/${action.edits.length} 个编辑\n`
            roundLogs.push({ round, action: 'edit', summary: `edit "${action.file}" 成功 ${appliedCount} 处`, content: logContent })
          }
          if (editErrors.length > 0) {
            lastError = editErrors.join('; ')
            const warnContent = `编辑警告: ${lastError}\n`
            if (roundLogs.length > 0) {
              roundLogs[roundLogs.length - 1].content += warnContent
            }
          }
          break
        }

        case 'done': {
          pushLog('✅ 代码任务完成: ' + action.summary, 'success', null)
          return {
            success: true,
            action: 'code_task',
            summary: action.summary || '代码任务完成',
            editedFiles,
            rounds: round
          }
        }

        default:
          lastError = `未知 action: ${action.action}`
      }
    } catch (err) {
      pushLog('代码任务第 ' + round + ' 轮异常:', 'error', null)
      lastError = err.message
    }
  }

  // 超过最大轮次
  if (editedFiles.length > 0) {
    return {
      success: true,
      action: 'code_task',
      summary: `代码任务完成（达到最大轮次），已编辑 ${editedFiles.length} 个文件: ${editedFiles.join(', ')}`,
      editedFiles,
      rounds: MAX_CODE_TASK_ROUNDS
    }
  }

  return {
    success: false,
    error: lastError || '代码任务未能完成',
    editedFiles,
    rounds: MAX_CODE_TASK_ROUNDS
  }
}

/**
 * 自动在 BrowserView 侧边栏打开 HTML 产物预览
 * 如果产物中包含 .html/.htm 文件，自动在右侧面板打开第一个
 * @param {string[]} outputFiles - 产物文件路径列表
 */
function autoOpenHtmlPreview(outputFiles) {
  if (!outputFiles || outputFiles.length === 0) return

  const htmlFile = outputFiles.find(f => {
    const ext = path.extname(f).toLowerCase()
    return (ext === '.html' || ext === '.htm') && fs.existsSync(f)
  })

  if (!htmlFile) return

  try {
    const { getBrowserViewManager } = require('../index')
    const browserViewManager = getBrowserViewManager()
    if (!browserViewManager) {
      console.log('[Muse] autoOpenHtmlPreview: BrowserViewManager 不可用')
      return
    }

    const fileUrl = `file://${htmlFile}`
    console.log('[Muse] 自动打开 HTML 产物预览:', fileUrl)

    if (!browserViewManager.isReady()) {
      browserViewManager.attach()
    }
    browserViewManager.navigate(fileUrl)
    browserViewManager.show()
    browserViewManager.notifyFrontend('browser')
  } catch (e) {
    console.warn('[Muse] autoOpenHtmlPreview 失败:', e.message)
  }
}

module.exports = {
  executeCommand,
  executeTaskFromList,
  executeSubtasksSequentially,
  executeSingleSubtaskWithAutoRepair,
  buildArtifactPreview,
  autoOpenHtmlPreview
}

// ========== 产物预览 ==========

/**
 * 构建产物预览内容，用于来信展示
 * 扫描产物文件，对可预览的文件生成预览摘要
 * @param {string[]} outputFiles - 产物文件路径列表
 * @param {string} taskDir - 任务工作目录
 * @returns {string|null} 预览内容（Markdown 格式），无可预览产物时返回 null
 */
function buildArtifactPreview(outputFiles, taskDir) {
  if (!outputFiles || outputFiles.length === 0) {
    // 没有显式产物列表，尝试扫描任务目录
    if (!taskDir || !fs.existsSync(taskDir)) return null
    try {
      const files = fs.readdirSync(taskDir).filter(f => !f.startsWith('.') && !f.startsWith('temp_'))
      if (files.length === 0) return null
      outputFiles = files.map(f => path.join(taskDir, f))
    } catch {
      return null
    }
  }

  const previews = []
  const previewableExts = new Set(PREVIEW_FILE_EXTENSIONS)

  for (const filePath of outputFiles.slice(0, 5)) {
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(taskDir || WORKSPACE_DIR, filePath)
      if (!fs.existsSync(absPath)) continue

      const ext = path.extname(absPath).toLowerCase()
      const stat = fs.statSync(absPath)
      const fileName = path.basename(absPath)

      if (!previewableExts.has(ext)) {
        previews.push(`📄 **${fileName}** (${formatFileSize(stat.size)})`)
        continue
      }

      if (stat.size > PREVIEW_FILE_MAX_SIZE) {
        previews.push(`📄 **${fileName}** (${formatFileSize(stat.size)}，文件较大，请在工作区查看)`)
        continue
      }

      // 文本类产物：内联预览
      if (['.svg', '.html', '.htm', '.css', '.md', '.xml', '.txt', '.json', '.log', '.yaml', '.yml', '.toml'].includes(ext)) {
        const content = fs.readFileSync(absPath, 'utf8')
        const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n... (已截断)' : content
        previews.push(`📄 **${fileName}** (${formatFileSize(stat.size)})\n\`\`\`${ext.slice(1)}\n${truncated}\n\`\`\``)
      } else {
        // 二进制文件（图片等）
        previews.push(`🖼️ **${fileName}** (${formatFileSize(stat.size)}，请在工作区查看)`)
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  if (previews.length === 0) return null
  return `**产物预览** (共 ${outputFiles.length} 个文件)：\n\n${previews.join('\n\n')}`
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ========== 辅助函数 ==========

/**
 * 尝试从 command 中检测大文件引用，触发分块分析
 * @param {string} command - 任务指令文本
 * @param {object} context - 上下文
 * @returns {Promise<object|null>} 分块分析结果，或 null（不触发）
 */
async function tryChunkedFileAnalysis(command, context) {
  const filePaths = extractFileReferences(command, context.workspace || WORKSPACE_DIR)

  for (const filePath of filePaths) {
    try {
      if (!fs.existsSync(filePath)) continue
      if (!isLargeFile(filePath)) continue

      pushLog('📄 检测到大文件，启用分块分析: ' + path.basename(filePath), 'info', null)
      const result = await chunkedAnalyzeFile(filePath, command)

      if (result.success) {
        return {
          understood: `分块分析大文件: ${result.fileName}`,
          success: true,
          action: 'chunk_analyze',
          actionDescription: `大文件分块分析完成（${result.chunks} 块）`,
          result: result.result
        }
      } else {
        pushLog('⚠️ 分块分析失败，回退到正常流程: ' + result.error, 'warn', null)
        return null // 回退到正常执行流程
      }
    } catch (err) {
      pushLog('⚠️ 大文件检测异常:', 'error', null)
    }
  }

  return null
}

/**
 * 从 command 文本中提取文件路径引用
 * 支持：绝对路径、workspace 相对路径、纯文件名
 * @param {string} command - 指令文本
 * @param {string} workspaceDir - 工作区目录
 * @returns {string[]} 可能的文件绝对路径数组
 */
function extractFileReferences(command, workspaceDir) {
  const filePaths = new Set()

  // 匹配绝对路径（如 /Users/.../file.txt）
  const absPathPattern = /(\/[\w\-.\/]+\.[\w]+)/g
  let match
  while ((match = absPathPattern.exec(command)) !== null) {
    filePaths.add(match[1])
  }

  // 匹配常见文件名（如 behavior_raw_14d_2026-04-01_to_2026-04-15.txt）
  const fileNamePattern = /([\w\-\.]+\.(txt|log|csv|json|md|xml|yaml|yml|tsv|dat))/gi
  while ((match = fileNamePattern.exec(command)) !== null) {
    const fileName = match[1]
    // 尝试在 workspace 下找到该文件
    const wsPath = path.join(workspaceDir, fileName)
    filePaths.add(wsPath)
  }

  return [...filePaths]
}

/**
 * 从旧任务中提取服务端不知道的执行上下文
 * 
 * AI 服务端通过 sessionId 已维护对话历史（prompt/response），
 * 但以下信息是本地执行产生的，服务端无从得知：
 * - 脚本实际执行的 stdout/stderr
 * - 产物文件内容
 * - 任务状态流转（成功/失败/重试）
 */
function buildOldTaskContext(oldTask) {
  const lines = []
  lines.push('【旧任务执行结果（本地执行产生，AI 服务端不可见）】')
  lines.push(`任务ID: ${oldTask.id}`)
  lines.push(`状态: ${oldTask.status}`)
  if (oldTask.error) {
    lines.push(`错误: ${oldTask.error}`)
  }

  const result = oldTask.result
  if (result) {
    // 脚本执行的 stdout —— 服务端只知道生成了脚本，不知道跑出来什么
    if (result.result) {
      lines.push(`\n【脚本执行输出】\n${String(result.result).slice(0, 1000)}`)
    }

    // 产物文件 —— 服务端不知道生成了哪些文件、内容是什么
    const allOutputFiles = collectOutputFiles(result)
    if (allOutputFiles.length > 0) {
      lines.push(`\n【产物文件】`)
      // 只有这些类型内联内容，其余只给文件名
      const inlineExts = ['.svg', '.html', '.htm', '.md', '.css', '.xml', '.js']
      for (const file of allOutputFiles.slice(0, 5)) {
        try {
          const filePath = path.isAbsolute(file) ? file : path.join(WORKSPACE_DIR, file)
          if (!fs.existsSync(filePath)) continue
          const ext = path.extname(file).toLowerCase()
          const stat = fs.statSync(filePath)

          if (inlineExts.includes(ext) && stat.size < 10000) {
            lines.push(`- ${file}`)
            lines.push(`\`\`\`\n${fs.readFileSync(filePath, 'utf8')}\n\`\`\``)
          } else {
            lines.push(`- ${file}`)
          }
        } catch {}
      }
    }

    // 失败信息 —— 服务端不知道脚本执行是否成功
    if (result.lastError) {
      lines.push(`\n【执行失败信息】\n${result.lastError}`)
    }
    if (result.attempts && result.attempts > 1) {
      lines.push(`重试次数: ${result.attempts}`)
    }

    // 子任务执行结果摘要
    if (result.subtasks && result.subtasks.length > 0) {
      lines.push(`\n【子任务执行结果】`)
      for (const st of result.subtasks) {
        const r = st.result || {}
        lines.push(`- ${st.command} → ${r.success ? '成功' : '失败'}`)
        if (r.result) lines.push(`  输出: ${String(r.result).slice(0, 200)}`)
        if (r.outputFiles?.length) lines.push(`  产物: ${r.outputFiles.join(', ')}`)
        if (!r.success && (r.error || r.lastError)) lines.push(`  错误: ${r.error || r.lastError}`)
      }
    }
  }

  // 补充：从任务列表获取子任务（result.subtasks 可能为空）
  const subtasks = getSubtasks(oldTask.id)
  if (subtasks.length > 0 && (!result?.subtasks || result.subtasks.length === 0)) {
    lines.push(`\n【子任务执行结果】`)
    for (const st of subtasks) {
      lines.push(`- [${st.status}] ${st.command}`)
      if (st.result?.result) lines.push(`  输出: ${String(st.result.result).slice(0, 200)}`)
      if (st.result?.outputFiles?.length) lines.push(`  产物: ${st.result.outputFiles.join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * 递归收集任务及子任务的所有产物文件（去重）
 */
function collectOutputFiles(result) {
  const files = new Set()
  if (result.outputFiles) {
    result.outputFiles.forEach(f => files.add(f))
  }
  if (result.subtasks) {
    for (const st of result.subtasks) {
      if (st.result?.outputFiles) {
        st.result.outputFiles.forEach(f => files.add(f))
      }
    }
  }
  return [...files]
}

/**
 * 写入 Python Engine 错误日志到任务工作目录
 */
function writeEngineErrorLog(workDir, command, errorDetail, result) {
  try {
    fs.mkdirSync(workDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filepath = path.join(workDir, `engine-error-${timestamp}.md`)
    const lines = [
      `# Python Engine 错误日志`,
      `- **时间**: ${new Date().toISOString()}`,
      `- **指令**: ${command}`,
      ``,
      `## 错误信息`,
      '```',
      typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail, null, 2),
      '```',
    ]
    if (result?.stdout) {
      lines.push(`\n## 标准输出\n\`\`\`\n${result.stdout}\n\`\`\``)
    }
    if (result?.stderr) {
      lines.push(`\n## 标准错误\n\`\`\`\n${result.stderr}\n\`\`\``)
    }
    fs.writeFileSync(filepath, lines.join('\n'), 'utf8')
    pushLog('📝 Python Engine 错误日志:' + ' ' + String(filepath).slice(0,80), 'info', null)
  } catch (err) {
    pushLog('错误日志写入失败:' + ' ' + String(err.message).slice(0,80), 'error', null)
  }
}

/**
 * 执行带迭代的脚本任务
 * 使用 Node.js 原生 ReAct 引擎，失败时降级到原始脚本逻辑
 */
async function executeWithIteration(command, strategy, context, maxRetries = MAX_SCRIPT_RETRIES, taskDir = null) {
  const workDir = taskDir || context.taskDir || WORKSPACE_DIR

  const reactContext = {
    workspace: workDir,
    systemTools: context.systemTools || [],
    profile: context.profile || '',
    sessionId: getMuseSessionId()
  }

  pushLog('🧠 ReAct 模式执行中...', 'info', null)
  const reactTaskId = `react-${Date.now()}`
  let reactTaskStarted = false
  let reactStepCount = 0
  const reactOutputFiles = []

  try {
    const reactResult = await executeReAct(
      command,
      reactContext,
      {
        onStepStart: ({ step, thought, action, input }) => {
          const safeThought = thought || ''
          const safeAction = action || 'unknown'

          pushLog('🧠 Step ' + step + ': ' + safeThought.slice(0, 60), 'info', null)
          pushLog('→ ' + safeAction + ' ' + JSON.stringify(input || {}).slice(0, 50), 'info', null)
          if (action === 'write_file' && input?.path) {
            reactOutputFiles.push(input.path)
          }
          reactStepCount = step

          const win = getMainWindow()
          if (!win) return

          if (!reactTaskStarted) {
            reactTaskStarted = true
            win.webContents.send('task:start', {
              taskId: reactTaskId,
              steps: [{ id: step, description: safeThought.slice(0, 80), type: safeAction, status: 'pending' }]
            })
          }

          win.webContents.send('task:stepStart', {
            step: { id: step, description: safeThought.slice(0, 80), type: safeAction },
            current: step, total: step, isNewStep: true
          })
          win.webContents.send('muse:log', { text: safeThought.slice(0, 80), step, type: 'step' })
        },
        onObservation: ({ step, observation, success }) => {
          const safeObs = observation || ''
          pushLog((success ? '✅' : '❌') + ' ' + safeObs.slice(0, 80), 'info', null)

          const win = getMainWindow()
          if (!win) return

          win.webContents.send('task:stepComplete', {
            step: { id: step, description: safeObs.slice(0, 80), type: 'react' },
            result: { success, data: safeObs.slice(0, 300) },
            current: step, total: step
          })
          win.webContents.send('muse:log', { text: safeObs.slice(0, 80), step, type: 'observation' })
        },
        onFinal: ({ answer, totalSteps }) => {
          pushLog('🏁 ReAct 完成，共 ' + totalSteps + ' 步', 'success', null)
          const win = getMainWindow()
          if (!win) return
          win.webContents.send('task:complete', { summary: (answer || '').slice(0, 500), context: { totalSteps } })
          win.webContents.send('muse:log', { text: '已完成', step: totalSteps, type: 'done' })
        },
        onError: ({ error }) => {
          pushLog('⚠️ ReAct 错误: ' + error, 'warn', null)
          const win = getMainWindow()
          if (!win) return
          win.webContents.send('task:error', { error: (error || '').slice(0, 200), stepIndex: reactStepCount - 1 })
          win.webContents.send('muse:log', { text: (error || '').slice(0, 80), step: reactStepCount, type: 'error' })
        },
        onPlanUpdate: ({ plan }) => {
          const win = getMainWindow()
          if (!win) return
          win.webContents.send('react:planUpdate', {
            plan: plan.map(p => ({ id: p.id, desc: p.desc, done: p.done }))
          })
        }
      },
      { maxSteps: 100, totalTimeout: 600000 }
    )

    if (reactResult.success) {
      pushLog('✅ 执行成功，共 ' + reactResult.totalSteps + ' 步', 'success', null)
      return {
        understood: strategy.understood,
        success: true,
        action: 'execute',
        actionDescription: `通过 ReAct 模式执行完成（${reactResult.totalSteps} 步）`,
        result: reactResult.finalAnswer || '执行成功',
        attempts: reactResult.totalSteps,
        outputFiles: reactOutputFiles
      }
    }

    // ReAct 失败：降级到原始脚本逻辑
    pushLog('⚠️ ReAct 失败，降级到脚本模式: ' + (reactResult.error || ''), 'warn', null)
  } catch (reactErr) {
    pushLog('❌ ReAct 异常: ' + String(reactErr.message).slice(0, 80), 'error', null)

    if (reactErr.message && reactErr.message.includes('timeout')) {
      const incrResult = await tryIncrementalGeneration(command, strategy, context, workDir)
      if (incrResult) return incrResult
    }
  }

  // 降级到原始 Node.js 脚本逻辑
  pushLog('🔄 降级到脚本模式', 'info', null)
  return executeWithIterationFallback(command, strategy, context, maxRetries, workDir)
}

/**
 * 原始 Node.js 执行逻辑（降级备用）
 */
async function executeWithIterationFallback(command, strategy, context, maxRetries = MAX_SCRIPT_RETRIES, taskDir = null) {
  const workDir = taskDir || context.taskDir || WORKSPACE_DIR
  let lastError = null
  let scriptContent = null
  let executionResult = null
  let consecutiveTimeouts = 0 // 连续超时次数

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    pushLog('🔄 第 ' + attempt + '/' + maxRetries + ' 次尝试', 'info', null)

    const scriptPrompt = buildScriptPrompt(command, strategy, context, attempt, lastError, scriptContent, workDir)
    
    try {
      const scriptResponse = await callAI(scriptPrompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_LONG // 脚本生成使用 120 秒
      })
      consecutiveTimeouts = 0 // 重置超时计数

      const extractResult = extractCodeWithLang(scriptResponse, strategy.scriptLanguage)
      if (!extractResult) {
        pushLog('⚠️ 脚本生成失败，未找到代码块', 'warn', null)
        lastError = '未能生成有效的脚本代码'
        continue
      }
      scriptContent = extractResult.code

      // 检测 AI 实际生成的语言是否与期望一致，不一致时自动修正
      const actualLang = extractResult.detectedLang
      if (actualLang && actualLang !== strategy.scriptLanguage) {
        pushLog('⚠️ 语言不符：期望 ' + strategy.scriptLanguage + '，AI 实际生成 ' + actualLang + '，自动修正', 'warn', null)
        strategy.scriptLanguage = actualLang
      }

      const scriptFile = path.join(workDir, `temp_command_${Date.now()}.${getExt(strategy.scriptLanguage)}`)
      fs.writeFileSync(scriptFile, scriptContent, 'utf8')
      executionResult = await ScriptExecutor.executeScript({
        scriptFile,
        lang: strategy.scriptLanguage,
        cwd: workDir,
        timeout: SCRIPT_TIMEOUT
      })

      try { fs.unlinkSync(scriptFile) } catch {}

      // 检查 stderr 是否包含关键错误（退出码为0但实际失败的情况）
      const stderrText = executionResult.stderr || ''
      const hasCriticalError = stderrText && /Cannot find module|MODULE_NOT_FOUND|Error:|ENOENT|EACCES|SyntaxError|ReferenceError|TypeError/i.test(stderrText)
      if (hasCriticalError && executionResult.success) {
        pushLog('⚠️ 脚本退出码0但 stderr 有关键错误，视为失败', 'warn', null)
        executionResult.success = false
        executionResult.error = `stderr 关键错误: ${stderrText.slice(0, 500)}`
      }

      if (executionResult.success) {
        pushLog('✅ 脚本执行成功', 'success', null)
        return {
          understood: strategy.understood,
          success: true,
          action: 'execute',
          actionDescription: `通过 ${strategy.scriptLanguage} 脚本执行完成`,
          result: executionResult.stdout || '执行成功',
          attempts: attempt,
          outputFiles: findOutputFiles(workDir, strategy.outputFormat)
        }
      } else {
        pushLog('❌ 第 ' + attempt + ' 次执行失败: ' + (executionResult.error || '').slice(0, 60), 'warn', null)
        lastError = executionResult.error
        
        if (attempt < maxRetries) {
          pushLog('🔧 优化脚本，准备重试', 'info', null)
          // 注意：不再强制将 python 降级到 bash，因为 AI 仍会生成 Python 代码
          // 导致 Python 代码被写入 .sh 文件用 bash 执行，产生语法错误
          // 实际语言检测和修正已在 extractCodeWithLang 中处理
        }
      }
    } catch (err) {
      pushLog('❌ 第 ' + attempt + ' 次异常: ' + err.message.slice(0, 60), 'error', null)
      lastError = err.message
      
      // 检测是否是超时
      if (err.message.includes('timeout')) {
        consecutiveTimeouts++
        pushLog('⚠️ 连续超时 ' + consecutiveTimeouts + ' 次', 'warn', null)
        
        // 连续超时 1 次就尝试增量生成
        if (consecutiveTimeouts >= 1) {
          pushLog('🧩 超时，切换增量生成模式', 'warn', null)
          const incrResult = await tryIncrementalGeneration(command, strategy, context, workDir)
          if (incrResult) return incrResult
          pushLog('⚠️ 增量生成也失败，降级到简化模式', 'info', null)
          strategy.scriptLanguage = 'bash'
          strategy.outputFormat = '简化版本'
        }
      }
    }
  }

  pushLog('❌ 所有尝试均失败，请求主人决策', 'error', null)
  
  return {
    understood: strategy.understood,
    success: false,
    action: 'request_help',
    actionDescription: `尝试了 ${maxRetries} 次均未成功，需要主人帮助`,
    result: null,
    error: lastError || '所有尝试均失败',
    attempts: maxRetries,
    lastError: lastError || '所有尝试均失败',
    scriptContent: scriptContent,
    needOwnerDecision: true,
    decisionQuestion: `这个任务我尝试了 ${maxRetries} 次都失败了，错误是：${lastError}。你希望我：1) 继续尝试（可能需要更多时间） 2) 简化任务 3) 换个方法 4) 暂时放弃`,
    shouldNotifyOwner: true
  }
}

/**
 * 简单任务执行（不需要脚本迭代）
 */
async function executeSimpleAction(command, strategy, context) {
  const prompt = `${SOUL_PROMPT}

主人下达了指令：

【指令内容】
${command}

【当前上下文】
- 记忆：${context.memories || '无记忆'}
- 最近对话：${context.recentHistory ? context.recentHistory.slice(0, 500) : '无'}
- 主人画像：${context.profile ? context.profile.slice(0, 500) : '未建立'}

请直接处理这个指令，返回执行结果。` 

  const response = await callAI(prompt, {
    sessionId: getMuseSessionId(),
    timeout: 60000
  })

  return {
    understood: strategy.understood,
    success: true,
    action: strategy.needsExecution ? 'execute' : 'analyze',
    actionDescription: '直接处理完成',
    result: response
  }
}

/**
 * 构建脚本生成 Prompt
 */
function buildScriptPrompt(command, strategy, context, attempt, lastError, previousScript, workDir) {
  const retryContext = attempt > 1 ? `

【上次执行失败的原因】
${lastError}

【上次的脚本代码】
\`\`\`${strategy.scriptLanguage}
${previousScript}
\`\`\`

请分析错误原因，优化脚本后重新生成。确保修复所有问题。` : ''

  // 扫描任务目录已有文件，注入到 prompt 中
  const existingFilesContext = buildExistingFilesContext(workDir || context.taskDir || WORKSPACE_DIR)

  return `${SOUL_PROMPT}

主人需要你完成一个任务：

【任务描述】
${command}

【预期输出】
${strategy.outputFormat || '根据任务决定'}

【验证方法】
${strategy.verificationMethod || '脚本正常退出即视为成功'}
${existingFilesContext}${retryContext}

请编写一个 ${strategy.scriptLanguage} 脚本来完成这个任务。

重要要求：
1. **精简高效**：代码要简洁，避免冗长重复，使用循环和函数封装
2. **完整可执行**：包含所有必要的导入和错误处理
3. **输出明确**：在控制台输出关键执行结果
4. **文件操作**：所有产出文件必须保存到任务工作目录 ${workDir}，禁止保存到桌面或其他位置。脚本的 cwd 已设为此目录。
5. **增量开发**：如果当前目录已有相关文件，请基于已有文件进行增量修改，不要覆盖已有内容
6. **路径探测**：文档里的文件路径可能是相对路径或示例路径，不一定准确。如果任务依赖某个配置文件、凭证文件，必须先用 \`find ~ -name "filename" 2>/dev/null\` 或 \`ls\` 探测文件的实际绝对路径，再使用。不要假设路径存在。
7. **API 认证失败必须有 fallback**：当 API 返回 auth/token 相关错误（如 "auth_token 无效"、"token 已过期"、401），绝对不能直接 exit 退出。必须在脚本里显式实现 fallback：换接口、换认证方式或用长效凭证重试。穷尽所有方案后才能以非零退出码结束。
8. **一次性 token 场景**：若任务含主人提供的一次性 auth_token，脚本结构必须是：先用 token 调用主接口，失败时自动改用长效 api_key 调用替代接口，文件/数据落盘即成功。

只返回代码块，不要解释。`
}

/**
 * 检测代码内容的实际语言
 * 防止 AI 在 bash 模式下生成了 Python/Node 代码，被误当 bash 执行
 * @returns {'python'|'node'|null}
 */
function detectCodeLanguage(code) {
  const trimmed = code.trim()
  if (/^(import |from \w+ import|def |class |async def |#!.*python)/m.test(trimmed)) return 'python'
  if (/^(const |let |var |require\(|import .* from ['"]|module\.exports)/m.test(trimmed)) return 'node'
  return null
}

/**
 * 从响应中提取代码块。
 * 返回 { code, detectedLang } — detectedLang 为实际语言（如与期望不符，调用方需修正 scriptLanguage）
 */
function extractCodeWithLang(response, language) {
  if (!response) return null

  // 先精确匹配期望语言标记的代码块
  const exactPattern = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'i')
  const exactMatch = response.match(exactPattern)
  if (exactMatch && exactMatch[1]) {
    const code = exactMatch[1].trim()
    return { code, detectedLang: detectCodeLanguage(code) || language }
  }

  // 回退：匹配任意标记的代码块，同时记录块标记语言
  const fallbackPattern = /```(\w*)\n([\s\S]*?)```/i
  const fallbackMatch = response.match(fallbackPattern)
  if (fallbackMatch) {
    const blockLang = fallbackMatch[1].toLowerCase() || null
    const code = (fallbackMatch[2] || '').trim()
    if (!code) return null
    const detectedLang = detectCodeLanguage(code) || blockLang || language
    return { code, detectedLang }
  }

  // 最后兜底：无语言标记的代码块
  const rawMatch = response.match(/```([\s\S]*?)```/i)
  if (rawMatch && rawMatch[1]) {
    const code = rawMatch[1].trim()
    return { code, detectedLang: detectCodeLanguage(code) || language }
  }

  return null
}

/**
 * 从响应中提取代码块（兼容旧调用，仅返回代码字符串）
 */
function extractCode(response, language) {
  const result = extractCodeWithLang(response, language)
  return result ? result.code : null
}

/**
 * 获取文件扩展名
 */
function getExt(language) {
  const extMap = { python: 'py', py: 'py', node: 'js', javascript: 'js', bash: 'sh', sh: 'sh' }
  return extMap[language] || 'sh'
}

/**
 * 查找输出的文件
 */
function findOutputFiles(workspaceDir, outputFormat) {
  try {
    const files = fs.readdirSync(workspaceDir)
      .filter(f => !f.startsWith('temp_'))
      .slice(-10) // 最近 10 个文件
    return files.length > 0 ? files : []
  } catch {
    return []
  }
}

/**
 * 获取任务隔离的工作目录
 * 每个根任务在 WORKSPACE_DIR 下创建独立子目录，子任务共享父任务目录
 * 兼容：如果任务已有产物在 WORKSPACE_DIR 根目录（旧任务），回退到根目录
 */
function getTaskDir(taskId) {
  const taskDir = path.join(WORKSPACE_DIR, taskId)
  
  if (!fs.existsSync(taskDir)) {
    fs.mkdirSync(taskDir, { recursive: true })
    pushLog('📂 创建任务目录:' + ' ' + String(taskDir).slice(0,80), 'info', null)
  }
  return taskDir
}

/**
 * 递归扫描目录，返回相对路径列表
 */
function scanDirRecursive(dir, baseDir = '') {
  const results = []
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (entry.startsWith('.') || entry.startsWith('temp_')) continue
      const fullPath = path.join(dir, entry)
      const relativePath = baseDir ? path.join(baseDir, entry) : entry
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        results.push(relativePath + '/')
        results.push(...scanDirRecursive(fullPath, relativePath))
      } else {
        results.push(relativePath)
      }
    }
  } catch {}
  return results
}

/**
 * 构建已有文件上下文，注入到脚本生成 prompt 中
 * 扫描 taskDir，列出文件结构 + 关键文件内容摘要
 */
function buildExistingFilesContext(taskDir) {
  try {
    const files = scanDirRecursive(taskDir)
    if (files.length === 0) return ''

    // 关键文件：读取内容摘要（package.json、入口文件、配置文件等）
    const keyFilePatterns = ['package.json', 'tsconfig.json', 'index.ts', 'index.js', 'app.ts', 'app.js', 'server.ts', 'server.js', 'vite.config', 'webpack.config']
    const keyFileSummaries = []

    for (const file of files) {
      if (file.endsWith('/')) continue
      const isKeyFile = keyFilePatterns.some(pattern => file.includes(pattern))
      if (!isKeyFile) continue

      try {
        const content = fs.readFileSync(path.join(taskDir, file), 'utf8')
        keyFileSummaries.push(`--- ${file} ---\n${content.slice(0, 800)}${content.length > 800 ? '\n...(截断)' : ''}`)
      } catch {}
    }

    let context = `\n【当前工作目录已有文件】\n${files.join('\n')}`
    if (keyFileSummaries.length > 0) {
      context += `\n\n【关键文件内容】\n${keyFileSummaries.join('\n\n')}`
    }
    context += `\n\n注意：请基于已有文件进行增量开发，不要覆盖已有的代码和配置。`
    return context
  } catch {
    return ''
  }
}

/**
 * 尝试增量生成模式：将大脚本拆成多轮小调用生成，本地合并后执行
 * 适用于脚本生成超时的场景（如大量像素数据、大型配置等）
 * @returns {object|null} 执行结果，或 null 表示增量生成也失败
 */
async function tryIncrementalGeneration(command, strategy, context, workDir) {
  const dir = workDir || context.taskDir || WORKSPACE_DIR
  try {
    pushLog('🧩 增量脚本生成中...', 'info', null)
    const incrResult = await generateIncrementally(command, strategy, context)

    if (!incrResult.success) {
      pushLog('⚠️ 增量生成失败:' + ' ' + String(incrResult.error).slice(0,80), 'warn', null)
      return null
    }

    // 增量生成成功，执行合并后的脚本
    pushLog('🧩 增量生成完成 (' + incrResult.rounds + ' 轮)，执行中', 'info', null)
    const scriptFile = path.join(dir, `temp_incr_${Date.now()}.${getExt(strategy.scriptLanguage)}`)
    fs.writeFileSync(scriptFile, incrResult.scriptContent, 'utf8')

    // 增量生成的脚本保留在任务目录，不删除（方便排查和修复）
    let executionResult = await ScriptExecutor.executeScript({
      scriptFile,
      lang: strategy.scriptLanguage,
      cwd: dir,
      timeout: SCRIPT_TIMEOUT
    })

    if (executionResult.success) {
      pushLog('✅ 增量生成脚本执行成功', 'success', null)
      return {
        understood: strategy.understood,
        success: true,
        action: 'execute',
        actionDescription: `通过增量生成 (${incrResult.rounds} 轮) 执行完成`,
        result: executionResult.stdout || '执行成功',
        attempts: incrResult.rounds,
        outputFiles: findOutputFiles(dir, strategy.outputFormat)
      }
    }

    // 执行失败：尝试让 AI 根据错误信息修复脚本（最多 2 次）
    pushLog('❌ 增量脚本执行失败: ' + (executionResult.error || '').slice(0, 60), 'warn', null)
    const MAX_INCR_REPAIR = 2
    for (let repair = 1; repair <= MAX_INCR_REPAIR; repair++) {
      pushLog('🔧 增量脚本修复 ' + repair + '/' + MAX_INCR_REPAIR, 'info', null)
      try {
        const brokenScript = fs.readFileSync(scriptFile, 'utf8')
        const repairPrompt = `${SOUL_PROMPT}

你之前生成的 ${strategy.scriptLanguage} 脚本执行失败了。请修复。

【错误信息】
${String(executionResult.error || executionResult.stderr || '').slice(0, 500)}

【原始脚本】
\`\`\`${strategy.scriptLanguage}
${brokenScript}
\`\`\`

请返回修复后的完整脚本。注意：
1. 如果是 bash 脚本，写入多行文本必须用 heredoc（cat << 'EOF' > file ... EOF），不能让文本裸露在脚本中
2. 只返回代码块，不要解释`

        const fixedResponse = await callAI(repairPrompt, {
          sessionId: getMuseSessionId(),
          timeout: AI_TIMEOUT_LONG
        })
        // 从 AI 响应中提取代码块
        const codeMatch = fixedResponse.match(/```[\w]*\n([\s\S]*?)```/)
        const fixedScript = codeMatch ? codeMatch[1].trim() : fixedResponse.trim()
        if (!fixedScript) {
          pushLog('⚠️ 修复响应中未提取到代码', 'warn', null)
          continue
        }

        fs.writeFileSync(scriptFile, fixedScript, 'utf8')
        executionResult = await ScriptExecutor.executeScript({
          scriptFile,
          lang: strategy.scriptLanguage,
          cwd: dir,
          timeout: SCRIPT_TIMEOUT
        })

        if (executionResult.success) {
          pushLog('✅ 增量脚本修复成功 (第 ' + repair + ' 次)', 'success', null)
          return {
            understood: strategy.understood,
            success: true,
            action: 'execute',
            actionDescription: `通过增量生成 + 修复 (${repair} 次) 执行完成`,
            result: executionResult.stdout || '执行成功',
            attempts: incrResult.rounds + repair,
            outputFiles: findOutputFiles(dir, strategy.outputFormat)
          }
        }
        pushLog('❌ 修复后仍失败:', 'warn', null)
      } catch (repairErr) {
        pushLog('修复异常:', 'error', null)
      }
    }

    pushLog('❌ 增量脚本修复均失败', 'error', null)
    return null
  } catch (err) {
    pushLog('❌ 增量生成异常:' + ' ' + String(err.message).slice(0,80), 'error', null)
    return null
  }
}

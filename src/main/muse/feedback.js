// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 反馈处理模块
 * 处理主人对信件的回复和任务反馈
 */

const { callAI } = require('../../shared/ai-client')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { sendLetter } = require('./mailbox')
const { loadTasks, updateTaskStatus, getSubtasks } = require('./tasks')
const { writeJournal } = require('./core')
const { updateProfile } = require('./core')
const { proactiveExplore } = require('./explore')
const path = require('path')
const { AI_TIMEOUT_SHORT, AI_TIMEOUT_NORMAL } = require('./config')
const { WORKSPACE_DIR } = require('./core')
const { editFileInPlace, shouldUseFileEdit } = require('./file-editor')

/**
 * 处理主人对信件的回复，感知反馈并做出新决策
 */
async function processReply(letterId, replyContent) {
  console.log(`[Muse] 处理主人反馈, letterId: ${letterId}`)

  const { Letters } = require('../database')
  const letter = Letters.getById(letterId)
  if (!letter) {
    console.warn('[Muse] 信件不存在:', letterId)
    return
  }

  console.log('[Muse] 信件信息:', { source: letter.source, taskId: letter.taskId, title: letter.title })

  // 检查是否是任务相关的信件
  const isTaskRelated = letter.source === 'task'
  
  if (isTaskRelated) {
    // 处理任务反馈
    await processTaskFeedback(letter, replyContent)
    return
  }

  // 处理普通信件反馈
  const context = gatherOwnerContext()

  const prompt = `${SOUL_PROMPT}

主人回复了你的一封信。

【你的原始信件】
标题: ${letter.title}
内容: ${letter.content}

【主人的回复】
${replyContent}

【当前主人画像】
${(context.profile || '').slice(0, 300)}

请分析主人的反馈，以 JSON 格式返回:
{
  "understood": "你对主人反馈的理解（30字以内）",
  "action": "none|explore|letter|profile_update",
  "newLetterTitle": "如果要发新信，标题",
  "newLetterContent": "如果要发新信，内容",
  "exploreTopic": "如果要探索，搜什么",
  "profileUpdate": {
    "section": "要更新的画像维度",
    "content": "更新内容"
  }
}

注意: 不是每次反馈都需要行动，简单的"好的""收到"返回 action: "none" 即可。`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })

    const result = parseMuseResponse(response)
    if (!result) {
      console.warn('[Muse] 反馈处理解析失败')
      return
    }

    console.log(`[Muse] 反馈理解: ${result.understood}, 行动: ${result.action}`)

    // 记录日志
    writeJournal(`**主人反馈**: 「${letter.title}」\n回复: ${replyContent}\n理解: ${result.understood}\n行动: ${result.action}`, 'feedback')

    switch (result.action) {
      case 'explore':
        // 自动探索已关闭，改为用户主动触发
        console.log('[Muse] 探索建议（未执行）:', result.exploreTopic)
        break

      case 'letter':
        if (result.newLetterTitle && result.newLetterContent) {
          sendLetter({
            title: result.newLetterTitle,
            content: result.newLetterContent,
            source: 'feedback'
          })
        }
        break

      case 'profile_update':
        if (result.profileUpdate?.section && result.profileUpdate?.content) {
          updateProfile(result.profileUpdate.section, result.profileUpdate.content)
        }
        break

      case 'none':
      default:
        break
    }
  } catch (err) {
    console.error('[Muse] 反馈处理失败:', err.message)
  }
}

/**
 * 处理任务相关的反馈
 */
async function processTaskFeedback(letter, replyContent) {
  console.log('[Muse] 📋 处理任务反馈')

  const tasks = loadTasks()
  let targetTask = null

  // 优先通过信件的 taskId 查找（包括已完成的任务，支持完成后追加修改）
  if (letter.taskId) {
    targetTask = tasks.find(t => t.id === letter.taskId)
    if (targetTask) {
      console.log('[Muse] 通过信件 taskId 找到任务:', targetTask.id, `(${targetTask.status})`)
    }
  }

  // 如果没有，查找 waiting_reply 状态的任务（执行中暂停等待回复）
  if (!targetTask) {
    targetTask = tasks.find(t => t.status === 'waiting_reply')
  }

  // 如果没有，查找 reviewing 状态的任务
  if (!targetTask) {
    targetTask = tasks.find(t => t.status === 'reviewing' && t.pendingReview)
  }

  // 还没有，查找 suspended 状态的任务（可能是拆解了子任务）
  if (!targetTask) {
    targetTask = tasks.find(t => t.status === 'suspended' && t.subtasks && t.subtasks.length > 0)
  }
  
  if (!targetTask) {
    console.warn('[Muse] 没有找到待审核的任务')
    sendLetter({
      title: '⚠️ 未找到相关任务',
      content: '主人，我找不到你反馈的任务，可能是任务已经完成或被取消了。能告诉我你反馈的是哪个任务吗？',
      priority: 'high',
      source: 'task'
    })
    return
  }

  // 特殊处理：waiting_reply 状态的任务（执行中暂停 / 产物预览反馈）
  if (targetTask.status === 'waiting_reply') {
    await processWaitingReplyFeedback(targetTask, replyContent)
    return
  }

  // pending 状态的任务：正在等待执行（如刚重新拆解），回复是针对通知信件的确认，忽略即可
  // 典型场景：主人要求调整拆解方案 → 任务变为 pending → 主人回复"确认执行" → 不应触发 approved 逻辑
  if (targetTask.status === 'pending') {
    console.log('[Muse] ⏳ 任务待执行中，忽略通知信件的回复:', targetTask.id)
    updateTaskStatus(targetTask.id, {
      feedbackHistory: [...(targetTask.feedbackHistory || []), {
        at: new Date().toISOString(),
        reply: replyContent,
        intent: 'ignored_pending',
        understood: '任务待执行，回复已记录'
      }]
    })
    return
  }

  // executing 状态的任务：正在执行中，回复是针对通知信件的确认，忽略即可
  if (targetTask.status === 'executing') {
    console.log('[Muse] ⏳ 任务正在执行中，忽略通知信件的回复:', targetTask.id)
    // 记录反馈但不改变任务状态
    updateTaskStatus(targetTask.id, {
      feedbackHistory: [...(targetTask.feedbackHistory || []), {
        at: new Date().toISOString(),
        reply: replyContent,
        intent: 'ignored_during_execution',
        understood: '任务执行中，回复已记录'
      }]
    })
    return
  }

  // 已完成任务的追加修改：找到任务目录中的产物，精确编辑
  if (targetTask.status === 'completed') {
    console.log('[Muse] 📋 已完成任务收到追加修改:', targetTask.id)
    const taskDir = path.join(WORKSPACE_DIR, targetTask.id)
    const outputFiles = targetTask.result?.outputFiles || []

    // 尝试精确编辑产物
    const editCheck = shouldUseFileEdit(replyContent, outputFiles, taskDir)
    if (editCheck.shouldEdit && editCheck.editableFiles.length > 0) {
      console.log('[Muse] ✏️ 已完成任务追加修改，走精确编辑:', editCheck.editableFiles.map(f => f.fileName))

      // 先标记为 executing，防止心跳在编辑期间误判为无待办任务
      updateTaskStatus(targetTask.id, { status: 'executing' })

      let allEditSuccess = true
      const editResults = []

      for (const fileInfo of editCheck.editableFiles) {
        const result = await editFileInPlace(fileInfo.filePath, replyContent, {
          originalCommand: targetTask.command,
          feedbackHistory: targetTask.feedbackHistory?.map(f => f.reply)
        })
        editResults.push({ file: fileInfo.fileName, ...result })
        if (!result.success) allEditSuccess = false
      }

      if (allEditSuccess) {
        const editSummary = editResults.map(r => `- ${r.file}: ${r.editCount} 处修改`).join('\n')

        const feedbackEntry = {
          at: new Date().toISOString(),
          reply: replyContent,
          intent: 'modification',
          understood: replyContent.slice(0, 50)
        }

        // 改回 waiting_reply 等待确认
        updateTaskStatus(targetTask.id, {
          status: 'waiting_reply',
          waitingReason: 'artifact_preview',
          waitingSince: new Date().toISOString(),
          feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry],
          modificationHistory: [...(targetTask.modificationHistory || []), {
            at: new Date().toISOString(),
            request: replyContent,
            source: 'completed_task_edit'
          }]
        })

        const { buildArtifactPreview } = require('./command')
        const previewContent = buildArtifactPreview(
          editCheck.editableFiles.map(f => f.filePath),
          taskDir
        ) || ''

        sendLetter({
          title: `✏️ 已修改，请再次查收`,
          content: `主人，我已按你的要求修改了产物：\n\n${editSummary}\n\n${previewContent}\n\n如果满意请回复"**好的**"，需要继续修改请直接告诉我。`,
          priority: 'high',
          source: 'task',
          taskId: targetTask.id
        })

        writeJournal(`**已完成任务追加修改**: ${targetTask.command.slice(0, 100)}\n修改: ${replyContent}\n结果: ${editSummary}`, 'task')
        return
      }

      console.warn('[Muse] ⚠️ 精确编辑失败，降级到重新执行')
    }

    // 精确编辑不可用 → 重新执行任务（带修改要求）
    const enrichedCommand = `${targetTask.command}\n\n【追加修改要求】\n${replyContent}\n\n【重要约束】\n所有产出文件必须保存到任务工作目录 ${taskDir}，禁止保存到桌面或其他位置。`
    updateTaskStatus(targetTask.id, {
      command: enrichedCommand,
      status: 'pending',
      completedAt: null,
      feedbackHistory: [...(targetTask.feedbackHistory || []), {
        at: new Date().toISOString(),
        reply: replyContent,
        intent: 'modification',
        understood: replyContent.slice(0, 50)
      }]
    })

    sendLetter({
      title: `🔄 收到修改要求，重新执行`,
      content: `明白了，我会按照你的要求重新执行任务。`,
      priority: 'normal',
      source: 'task',
      taskId: targetTask.id
    })

    const { restartHeartbeat } = require('./heartbeat')
    restartHeartbeat()
    return
  }

  const context = gatherOwnerContext()

  // 分析主人反馈意图
  const analyzePrompt = `${SOUL_PROMPT}

主人回复了你的任务通知。

【任务内容】
${targetTask.command}

【当前状态】
${targetTask.status === 'suspended' ? '任务已拆解为子任务，正在执行中' : targetTask.status}

【你的通知】
${letter.content}

【主人的回复】
${replyContent}

请分析主人的意图，以 JSON 格式返回：
{
  "intent": "approved|modification|cancel|question",
  "understood": "你对主人反馈的理解（30字以内）",
  "modificationRequest": "如果需要修改，主人要求改什么",
  "newRequirements": "如果有新需求，是什么",
  "shouldContinue": true/false,
  "shouldCloseTask": true/false,
  "responseToOwner": "你要回复主人的话（50字以内）"
}

注意：
- approved: 主人满意，任务通过
- modification: 主人要求修改
- cancel: 主人取消任务
- question: 主人有疑问
- 返回纯 JSON，不要解释`

  try {
    const response = await callAI(analyzePrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const analysis = parseMuseResponse(response)
    if (!analysis) {
      console.warn('[Muse] 任务反馈分析失败')
      return
    }

    console.log(`[Muse] 任务反馈意图: ${analysis.intent}`)

    // 记录反馈历史
    const feedbackEntry = {
      at: new Date().toISOString(),
      reply: replyContent,
      intent: analysis.intent,
      understood: analysis.understood
    }
    
    switch (analysis.intent) {
      case 'approved': {
        // 检查是否有未完成的子任务
        const subtasks = getSubtasks(targetTask.id)
        const unfinishedSubtasks = subtasks.filter(t => t.status !== 'completed' && t.status !== 'closed')

        if (unfinishedSubtasks.length > 0) {
          // 有未完成子任务，不能直接完成父任务，恢复为 pending 继续执行
          console.log('[Muse] ⚠️ 还有', unfinishedSubtasks.length, '个子任务未完成，不能直接完成父任务')
          updateTaskStatus(targetTask.id, {
            status: 'suspended',
            pendingReview: false,
            feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry]
          })

          sendLetter({
            title: `▶️ 收到确认，继续执行子任务`,
            content: analysis.responseToOwner || `好的，还有 ${unfinishedSubtasks.length} 个子任务在执行中，完成后会通知你。`,
            priority: 'normal',
            source: 'task',
            taskId: targetTask.id
          })

          // 恢复 waiting_reply 的子任务
          restoreWaitingSubtasks(targetTask.id)

          writeJournal(`**任务确认继续**: ${targetTask.command}\n主人反馈: ${replyContent}\n剩余子任务: ${unfinishedSubtasks.length}`, 'task')
          console.log('[Muse] ▶️ 任务继续执行子任务:', targetTask.id)
        } else {
          // 没有子任务或全部完成，标记完成
          updateTaskStatus(targetTask.id, {
            status: 'completed',
            pendingReview: false,
            feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry]
          })

          sendLetter({
            title: `✅ 任务已完成`,
            content: analysis.responseToOwner || '好的，任务已标记为完成！',
            priority: 'normal',
            source: 'task',
            taskId: targetTask.id
          })

          writeJournal(`**任务完成**: ${targetTask.command}\n主人反馈: ${replyContent}`, 'task')
          console.log('[Muse] ✅ 任务已标记为完成:', targetTask.id)
        }
        break
      }

      case 'modification':
        // 主人要求修改，更新任务要求
        const modifiedCommand = analysis.newRequirements 
          ? `${targetTask.command}\n\n【修改要求】\n${analysis.modificationRequest}\n\n【新需求】\n${analysis.newRequirements}`
          : `${targetTask.command}\n\n【修改要求】\n${analysis.modificationRequest}`
      
        // 检查是否有子任务
        const hasSubtasks = targetTask.subtasks && targetTask.subtasks.length > 0
              
        if (hasSubtasks) {
          // 如果有子任务，说明是子任务失败，不应该重新拆解父任务
          // 而是让主人在任务面板修改子任务
          console.log('[Muse] ⚠️ 任务有子任务，请在任务面板中修改失败的子任务')
          sendLetter({
            title: `📝 请修改子任务`,
            content: `主人，这个任务已经拆解为子任务了。请在任务面板中找到失败的子任务，修改内容后将状态改为"待执行"，我会继续执行。`,
            priority: 'normal',
            source: 'task'
          })
          // 不修改父任务状态，保持 suspended
          updateTaskStatus(targetTask.id, {
            feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry]
          })
        } else {
          // 没有子任务，重新执行父任务
          updateTaskStatus(targetTask.id, {
            command: modifiedCommand,
            status: 'pending', // 重新回到待执行
            pendingReview: false,
            feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry],
            modificationHistory: [...(targetTask.modificationHistory || []), {
              at: new Date().toISOString(),
              request: analysis.modificationRequest,
              newRequirements: analysis.newRequirements
            }]
          })
      
          sendLetter({
            title: `🔧 收到，继续修改`,
            content: analysis.responseToOwner || '明白了，我会按照你的要求继续修改，完成后通知你。',
            priority: 'normal',
            source: 'task'
          })
      
          writeJournal(`**任务修改**: ${targetTask.command}\n修改要求: ${analysis.modificationRequest}`, 'task')
          console.log('[Muse] 🔧 任务已更新，将重新执行:', targetTask.id)
        }
        break

      case 'cancel':
        // 主人取消任务
        updateTaskStatus(targetTask.id, {
          status: 'closed',
          pendingReview: false,
          feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry]
        })

        sendLetter({
          title: `📝 任务已关闭`,
          content: analysis.responseToOwner || '好的，任务已关闭。',
          priority: 'normal',
          source: 'task'
        })

        writeJournal(`**任务关闭**: ${targetTask.command}\n原因: ${replyContent}`, 'task')
        console.log('[Muse] 📝 任务已关闭:', targetTask.id)
        break

      case 'question':
      default:
        // 主人有疑问，回复解释
        sendLetter({
          title: targetTask.command.slice(0, 30),
          content: analysis.responseToOwner || '我理解你的疑问，让我解释一下...',
          priority: 'normal',
          source: 'task'
        })

        updateTaskStatus(targetTask.id, {
          feedbackHistory: [...(targetTask.feedbackHistory || []), feedbackEntry]
        })
        break
    }
  } catch (err) {
    console.error('[Muse] 任务反馈处理失败:', err.message)
  }
}

/**
 * 处理 waiting_reply 状态任务的回复
 * 核心：回复后恢复执行（继续），而非重新开始
 */
async function processWaitingReplyFeedback(task, replyContent) {
  console.log('[Muse] 📋 处理 waiting_reply 任务反馈:', task.id, '原因:', task.waitingReason)

  const feedbackEntry = {
    at: new Date().toISOString(),
    reply: replyContent,
    intent: 'waiting_reply_response',
    understood: replyContent.slice(0, 50)
  }

  // 分析主人回复意图
  const analyzePrompt = `${SOUL_PROMPT}

主人回复了你在执行任务时提出的问题。

【任务内容】
${task.command.slice(0, 500)}

【暂停原因】
${task.waitingReason || '等待主人决策'}

【主人的回复】
${replyContent}

请分析主人的意图，以 JSON 格式返回：
{
  "intent": "continue|modification|cancel",
  "understood": "你对主人回复的理解（30字以内）",
  "modificationRequest": "如果需要修改，主人要求改什么",
  "responseToOwner": "你要回复主人的话（50字以内）"
}

注意：
- continue: 主人满意/同意/给出了答案，继续执行
- modification: 主人要求修改（如"颜色太深了"、"字体换大一点"）
- cancel: 主人取消任务
- 简单的"好的""通过""可以"视为 continue
- 返回纯 JSON`

  try {
    const response = await callAI(analyzePrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const analysis = parseMuseResponse(response)
    if (!analysis) {
      console.warn('[Muse] waiting_reply 反馈分析失败，默认恢复执行')
      // 分析失败，默认恢复执行
      restoreTaskFromWaiting(task, feedbackEntry, replyContent)
      return
    }

    console.log(`[Muse] waiting_reply 反馈意图: ${analysis.intent}`)
    feedbackEntry.intent = analysis.intent
    feedbackEntry.understood = analysis.understood

    switch (analysis.intent) {
      case 'continue': {
        // 任务拆解确认通过 → 开始执行子任务
        if (task.waitingReason === 'task_plan_review') {
          const { executeSubtasksSequentially } = require('./command')
          const taskDir = path.join(WORKSPACE_DIR, task.id)

          updateTaskStatus(task.id, {
            status: 'executing',
            waitingReason: null,
            waitingSince: null,
            suspendReason: null,
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry]
          })

          // 确认后直接开始执行，不发来信
          console.log('[Muse] ▶️ 主人确认拆解方案，开始执行子任务:', task.id)

          // 异步执行子任务，不阻塞反馈流程
          setImmediate(() => executeSubtasksSequentially(task.id, taskDir).catch(e => console.error('[Muse] 子任务执行异常:', e.message)))
          break
        }

        // 代码任务确认通过 → 标记完成
        if (task.waitingReason === 'code_task_review') {
          updateTaskStatus(task.id, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            pendingReview: false,
            waitingReason: null,
            waitingSince: null,
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry]
          })

          sendLetter({
            title: `✅ 代码任务已完成`,
            content: analysis.responseToOwner || '好的，代码修改已确认完成！',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })

          writeJournal(`**代码任务完成（确认通过）**: ${task.command.slice(0, 100)}\n主人反馈: ${replyContent}`, 'task')
          break
        }

        // 产物预览通过 → 标记完成
        if (task.waitingReason === 'artifact_preview') {
          updateTaskStatus(task.id, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            pendingReview: false,
            waitingReason: null,
            waitingSince: null,
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry]
          })

          sendLetter({
            title: `✅ 任务已完成`,
            content: analysis.responseToOwner || '好的，任务已标记为完成！',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })

          writeJournal(`**任务完成（预览通过）**: ${task.command.slice(0, 100)}\n主人反馈: ${replyContent}`, 'task')
        } else {
          // 决策问题回复 → 恢复执行，带上主人的回答
          restoreTaskFromWaiting(task, feedbackEntry, replyContent)

          sendLetter({
            title: `▶️ 收到，继续执行`,
            content: analysis.responseToOwner || '明白了，我会根据你的回复继续执行。',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })
        }
        break
      }

      case 'modification': {
        const modificationRequest = analysis.modificationRequest || replyContent

        // 任务拆解方案调整 → 清理旧子任务，追加修改要求，重新拆解
        if (task.waitingReason === 'task_plan_review') {
          console.log('[Muse] 🔄 主人要求调整拆解方案:', task.id)

          // 清理已创建的子任务
          const existingSubtasks = getSubtasks(task.id)
          if (existingSubtasks.length > 0) {
            const tasks = loadTasks()
            const oldSubtaskIds = existingSubtasks.map(st => st.id)
            const filteredTasks = tasks.filter(t => !oldSubtaskIds.includes(t.id))
            require('./tasks').saveTasks(filteredTasks)
            console.log('[Muse] 🗑️ 清理旧子任务:', existingSubtasks.length, '个')
          }

          const enrichedCommand = `${task.command}\n\n【主人对拆解方案的调整要求】\n${modificationRequest}`

          updateTaskStatus(task.id, {
            command: enrichedCommand,
            status: 'pending',
            waitingReason: null,
            waitingSince: null,
            suspendReason: null,
            subtasks: [],
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
            modificationHistory: [...(task.modificationHistory || []), {
              at: new Date().toISOString(),
              request: modificationRequest,
              source: 'task_plan_modify'
            }]
          })

          sendLetter({
            title: `🔄 收到，重新拆解`,
            content: analysis.responseToOwner || '明白了，我会按照你的要求重新拆解任务。',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })

          writeJournal(`**任务拆解调整**: ${task.command.slice(0, 100)}\n调整要求: ${modificationRequest}`, 'task')
          break
        }

        // 代码任务场景：重新走 executeCodeTask 循环
        if (task.waitingReason === 'code_task_review' && task.codeTaskDir) {
          console.log('[Muse] 🔍 代码任务修改，重新走代码任务循环:', task.codeTaskDir)

          // 追加修改要求到 command
          const enrichedCommand = `${task.command}\n\n【主人的修改要求】\n${modificationRequest}`

          updateTaskStatus(task.id, {
            command: enrichedCommand,
            status: 'pending',
            waitingReason: null,
            waitingSince: null,
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
            modificationHistory: [...(task.modificationHistory || []), {
              at: new Date().toISOString(),
              request: modificationRequest,
              source: 'code_task_modify'
            }]
          })

          sendLetter({
            title: `🔧 收到，继续修改代码`,
            content: analysis.responseToOwner || '明白了，我会按照你的要求继续修改代码，完成后通知你。',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })

          writeJournal(`**代码任务修改**: ${task.command.slice(0, 100)}\n修改要求: ${modificationRequest}`, 'task')
          break
        }

        // 产物预览场景：优先尝试精确编辑已有文件
        if (task.waitingReason === 'artifact_preview') {
          const outputFiles = task.result?.outputFiles || task.result?.editResults?.map(r => r.filePath) || []
          const taskDir = task.result?.taskDir || null
          const editCheck = shouldUseFileEdit(modificationRequest, outputFiles, taskDir)

          if (editCheck.shouldEdit && editCheck.editableFiles.length > 0) {
            console.log('[Muse] ✏️ 产物修改走精确编辑:', editCheck.editableFiles.map(f => f.fileName))

            let allEditSuccess = true
            const editResults = []

            for (const fileInfo of editCheck.editableFiles) {
              const result = await editFileInPlace(fileInfo.filePath, modificationRequest, {
                originalCommand: task.command,
                feedbackHistory: task.feedbackHistory?.map(f => f.reply)
              })
              editResults.push({ file: fileInfo.fileName, ...result })
              if (!result.success) allEditSuccess = false
            }

            if (allEditSuccess) {
              const editSummary = editResults.map(r => `- ${r.file}: ${r.editCount} 处修改`).join('\n')

              // 编辑成功，继续等待主人确认
              updateTaskStatus(task.id, {
                waitingSince: new Date().toISOString(),
                feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
                modificationHistory: [...(task.modificationHistory || []), {
                  at: new Date().toISOString(),
                  request: modificationRequest,
                  source: 'file_edit'
                }]
              })

              // 重新生成预览
              const { buildArtifactPreview } = require('./command')
              const previewContent = buildArtifactPreview(
                editCheck.editableFiles.map(f => f.filePath),
                taskDir
              ) || ''

              sendLetter({
                title: `✏️ 已修改，请再次查收`,
                content: `主人，我已按你的要求精确修改了文件：\n\n${editSummary}\n\n${previewContent}\n\n如果满意请回复"**好的**"，需要继续修改请直接告诉我。`,
                priority: 'high',
                source: 'task',
                taskId: task.id
              })

              writeJournal(`**精确编辑产物**: ${task.command.slice(0, 100)}\n修改: ${modificationRequest}\n结果: ${editSummary}`, 'task')
              break
            }

            console.warn('[Muse] ⚠️ 精确编辑失败，降级到新建子任务执行')
          }
        }

        // artifact_preview 场景：精确编辑不可用或失败 → 直接新建子任务执行修改，不再二次确认
        if (task.waitingReason === 'artifact_preview') {
          const enrichedCommand = `${task.command}\n\n【主人的修改要求】\n${modificationRequest}`
          const taskDir = path.join(WORKSPACE_DIR, task.id)

          updateTaskStatus(task.id, {
            command: enrichedCommand,
            status: 'pending',
            waitingReason: null,
            waitingSince: null,
            feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
            modificationHistory: [...(task.modificationHistory || []), {
              at: new Date().toISOString(),
              request: modificationRequest,
              source: 'artifact_modify_subtask'
            }]
          })

          sendLetter({
            title: `🔧 收到，继续优化`,
            content: analysis.responseToOwner || '明白了，我会按你的要求继续优化，完成后再通知你。',
            priority: 'normal',
            source: 'task',
            taskId: task.id
          })

          writeJournal(`**产物修改（新建子任务）**: ${task.command.slice(0, 100)}\n修改要求: ${modificationRequest}`, 'task')

          const { restartHeartbeat } = require('./heartbeat')
          restartHeartbeat()
          break
        }

        // 其他场景：重新规划后再次确认
        await replanAndConfirm(task, modificationRequest, replyContent, feedbackEntry)
        break
      }

      case 'cancel': {
        updateTaskStatus(task.id, {
          status: 'closed',
          waitingReason: null,
          waitingSince: null,
          feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry]
        })

        sendLetter({
          title: `📝 任务已关闭`,
          content: analysis.responseToOwner || '好的，任务已关闭。',
          priority: 'normal',
          source: 'task',
          taskId: task.id
        })

        writeJournal(`**任务关闭（对话中取消）**: ${task.command.slice(0, 100)}\n原因: ${replyContent}`, 'task')
        break
      }

      default:
        restoreTaskFromWaiting(task, feedbackEntry, replyContent)
        break
    }
  } catch (err) {
    console.error('[Muse] waiting_reply 反馈处理失败:', err.message)
    // 出错时也恢复执行，避免任务永远卡住
    restoreTaskFromWaiting(task, feedbackEntry, replyContent)
  }
}

/**
 * 恢复 waiting_reply 状态的任务为 pending，带上主人的回复上下文
 */
function restoreTaskFromWaiting(task, feedbackEntry, replyContent) {
  // 将主人的回复追加到 command 上下文
  const enrichedCommand = `${task.command}\n\n【主人的回复（针对: ${task.waitingReason || '提问'}）】\n${replyContent}`

  updateTaskStatus(task.id, {
    command: enrichedCommand,
    status: 'pending',
    waitingReason: null,
    waitingSince: null,
    feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry]
  })

  // 如果有子任务在 waiting_reply，也恢复
  restoreWaitingSubtasks(task.id)

  console.log('[Muse] ▶️ 任务已恢复为 pending:', task.id)
}

/**
 * 恢复父任务下所有 waiting_reply 状态的子任务
 */
function restoreWaitingSubtasks(parentId) {
  const tasks = loadTasks()
  let restored = 0
  for (const task of tasks) {
    if ((task.parentId === parentId || task.rootId === parentId) && task.status === 'waiting_reply') {
      task.status = 'pending'
      task.waitingReason = null
      task.waitingSince = null
      restored++
    }
  }
  if (restored > 0) {
    require('./tasks').saveTasks(tasks)
    console.log(`[Muse] ▶️ 恢复了 ${restored} 个 waiting_reply 子任务`)
  }
}

/**
 * 重新规划并再次确认
 * 主人不同意方案时，根据反馈重新生成方案，再次来信等确认
 */
async function replanAndConfirm(task, modificationRequest, replyContent, feedbackEntry) {
  console.log('[Muse] 🔄 重新规划任务方案:', task.id)

  const context = gatherOwnerContext()

  const replanPrompt = `${SOUL_PROMPT}

主人之前下达了一个任务，你提出了执行方案，但主人不同意，要求调整。

【原始任务】
${task.command.slice(0, 500)}

【你之前的方案/提问】
${task.waitingReason || '未知'}

【主人的反馈】
${replyContent}

【主人的修改要求】
${modificationRequest}

【环境信息】
${context.systemTools || '无系统工具信息'}

请根据主人的反馈，重新规划执行方案，以 JSON 格式返回：
{
  "newPlan": "调整后的执行方案（简明扼要，100字以内）",
  "confirmQuestion": "向主人确认的问题（说明你打算怎么做，用什么工具/库，让主人确认）",
  "understood": "你对主人反馈的理解（30字以内）"
}

注意：
- 优先使用成熟的库和工具来实现
- 方案要具体，说明用什么工具/库/技术
- 返回纯 JSON`

  try {
    const response = await callAI(replanPrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })

    const replan = parseMuseResponse(response)

    if (!replan || !replan.confirmQuestion) {
      // 规划失败，回退到直接修改重新执行
      console.warn('[Muse] 重新规划解析失败，回退到直接修改')
      fallbackModification(task, modificationRequest, replyContent, feedbackEntry)
      return
    }

    // 更新任务：追加修改要求，保持 waiting_reply 状态等再次确认
    const enrichedCommand = `${task.command}\n\n【主人反馈】\n${replyContent}\n\n【调整后方案】\n${replan.newPlan}`

    updateTaskStatus(task.id, {
      command: enrichedCommand,
      status: 'waiting_reply',
      waitingReason: replan.confirmQuestion,
      waitingSince: new Date().toISOString(),
      feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
      modificationHistory: [...(task.modificationHistory || []), {
        at: new Date().toISOString(),
        request: modificationRequest,
        source: 'replan'
      }]
    })

    sendLetter({
      title: `🔄 方案已调整，请确认`,
      content: `主人，我根据你的反馈重新调整了方案：\n\n**${replan.newPlan}**\n\n${replan.confirmQuestion}\n\n请回复确认，我再开始执行。`,
      priority: 'high',
      source: 'task',
      taskId: task.id
    })

    writeJournal(`**任务重新规划**: ${task.command.slice(0, 100)}\n主人反馈: ${replyContent}\n新方案: ${replan.newPlan}`, 'task')
    console.log('[Muse] 🔄 已发送新方案等待确认:', task.id)
  } catch (err) {
    console.error('[Muse] 重新规划失败:', err.message)
    fallbackModification(task, modificationRequest, replyContent, feedbackEntry)
  }
}

/**
 * 重新规划失败时的回退：直接追加修改要求重新执行
 */
function fallbackModification(task, modificationRequest, replyContent, feedbackEntry) {
  const modifiedCommand = `${task.command}\n\n【修改要求】\n${modificationRequest}`

  updateTaskStatus(task.id, {
    command: modifiedCommand,
    status: 'pending',
    pendingReview: false,
    waitingReason: null,
    waitingSince: null,
    feedbackHistory: [...(task.feedbackHistory || []), feedbackEntry],
    modificationHistory: [...(task.modificationHistory || []), {
      at: new Date().toISOString(),
      request: modificationRequest,
      source: 'waiting_reply_fallback'
    }]
  })

  restoreWaitingSubtasks(task.id)

  sendLetter({
    title: `🔧 收到修改要求，继续执行`,
    content: `明白了，我会按照你的要求修改，完成后再通知你。`,
    priority: 'normal',
    source: 'task',
    taskId: task.id
  })

  writeJournal(`**任务修改（回退）**: ${task.command.slice(0, 100)}\n修改要求: ${modificationRequest}`, 'task')
}

module.exports = {
  processReply,
  processTaskFeedback,
  processWaitingReplyFeedback
}

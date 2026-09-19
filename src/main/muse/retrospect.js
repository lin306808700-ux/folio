// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 任务复盘模块
 * 任务完成/失败后自动复盘，提炼经验教训写入画像
 * 同时存储推理轨迹供后续相似任务复用（USTU 启发）
 */

const { callAI } = require('../../shared/ai-client')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { writeJournal, updateProfile } = require('./core')
const { AI_TIMEOUT_SHORT } = require('./config')
const { getSubtasks } = require('./tasks')
const { Memories } = require('../database')
const { recordTaskResult, LEVELS } = require('./autonomy')

/**
 * 对完成/失败的任务进行复盘
 * 异步执行，不阻塞主流程
 */
async function retrospectTask(task) {
  const taskSummary = task.command.slice(0, 200)
  const isSuccess = task.status === 'completed'

  // 收集子任务信息
  const subtasks = getSubtasks(task.id)
  const subtaskSummary = subtasks.length > 0
    ? subtasks.map(st => `- ${st.command.slice(0, 80)} → ${st.status}${st.error ? ` (${st.error.slice(0, 50)})` : ''}`).join('\n')
    : '无子任务'

  const failedSubtasks = subtasks.filter(st => st.status === 'failed')
  const repairInfo = subtasks
    .filter(st => st.repairAttempts > 0)
    .map(st => `- ${st.command.slice(0, 50)}: 修复${st.repairAttempts}次`)
    .join('\n')

  const context = gatherOwnerContext()

  const prompt = `${SOUL_PROMPT}

你刚完成了一个任务，现在做快速复盘。

【任务】${taskSummary}
【结果】${isSuccess ? '✅ 成功' : '❌ 失败'}
【错误】${task.error || '无'}
【子任务】
${subtaskSummary}
【自动修复】
${repairInfo || '无'}
【耗时】${task.startedAt && task.completedAt ? Math.round((new Date(task.completedAt) - new Date(task.startedAt)) / 60000) + '分钟' : '未知'}

以 JSON 返回复盘结果：
{
  "lesson": "核心教训（30字以内，如果成功则是成功经验）",
  "rootCause": "失败根因或成功关键（20字以内）",
  "improvement": "下次遇到类似任务的改进策略（30字以内）",
  "shouldUpdateProfile": true/false,
  "profileSection": "要更新的画像维度（如：任务经验、技术偏好）",
  "profileContent": "画像更新内容（简洁，50字以内）",
  "category": "task_execution|code_generation|data_analysis|creative|other",
  "domain": "知识领域标签（如：前端开发、DevOps、数据分析、副业探索、其他）",
  "shouldRecordMemory": true/false
}

规则：
- 只提炼真正有价值的教训，不要泛泛而谈
- shouldUpdateProfile 只在发现可复用的经验时为 true
- shouldRecordMemory 在有可复用的经验/教训时为 true（将写入记忆碎片供后续检索）
- domain 尽量具体，便于后续按领域检索
- 返回纯 JSON`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const result = parseMuseResponse(response)
    if (!result) {
      console.log('[Muse] 🔄 复盘解析失败')
      return
    }

    // 写入复盘日志
    const emoji = isSuccess ? '✅' : '❌'
    writeJournal(
      `**${emoji} 任务复盘**: ${taskSummary}\n**教训**: ${result.lesson}\n**根因**: ${result.rootCause}\n**改进**: ${result.improvement}`,
      'retrospect'
    )

    // 更新画像（累积式追加，不覆盖）
    if (result.shouldUpdateProfile && result.profileSection) {
      const fs = require('fs')
      const path = require('path')
      const { PROFILE_DIR } = require('./config')
      const profileFile = path.join(PROFILE_DIR, `${result.profileSection}.md`)

      let existingContent = ''
      try {
        if (fs.existsSync(profileFile)) {
          existingContent = fs.readFileSync(profileFile, 'utf8')
        }
      } catch {}

      // 追加新经验，保留最近 20 条
      const newEntry = `- [${new Date().toISOString().slice(0, 10)}] ${result.profileContent}`
      const lines = existingContent.split('\n').filter(l => l.trim())

      // 如果文件没有标题，加一个
      if (!lines.some(l => l.startsWith('#'))) {
        lines.unshift(`# ${result.profileSection}`)
      }

      lines.push(newEntry)

      // 保留标题 + 最近 20 条记录
      const titleLines = lines.filter(l => l.startsWith('#'))
      const entryLines = lines.filter(l => !l.startsWith('#')).slice(-20)
      const finalContent = [...titleLines, '', ...entryLines].join('\n')

      updateProfile(result.profileSection, finalContent)
      console.log('[Muse] 🔄 复盘经验已写入画像:', result.profileSection)
    }

    // 写入结构化记忆碎片（供知识检索闭环使用）
    if (result.shouldRecordMemory) {
      try {
        const memoryContent = `[${result.domain || result.category || '未分类'}] ${result.lesson}${result.improvement ? ' | 改进: ' + result.improvement : ''}`
        const memResult = Memories.add({
          content: memoryContent,
          activation: isSuccess ? 0.3 : 0.5,  // 失败教训激活度更高（更容易被检索到）
          integration: 0.2,
          intent: 0
        })
        console.log('[Muse] 🔄 复盘经验已写入记忆:', result.domain || result.category)
      } catch (memErr) {
        console.warn('[Muse] 🔄 记忆写入失败:', memErr.message)
      }
    }

    // 更新自主等级指标
    try {
      const autonomyResult = recordTaskResult(isSuccess, result.domain || result.category)
      if (autonomyResult.upgraded) {
        // 等级提升时发信通知主人
        const { sendLetter } = require('./mailbox')
        sendLetter({
          title: `🎉 Muse 成长升级：${autonomyResult.levelName}`,
          content: `主人，我成长了！\n\n从「${LEVELS[autonomyResult.from]?.name || '新手'}」升级为「${autonomyResult.levelName}」\n\n${autonomyResult.levelDesc}\n\n我会${autonomyResult.to >= 2 ? '更加自主地' : '更少打扰你地'}完成任务，继续积累经验。`,
          priority: 'normal',
          source: 'autonomy'
        })
      }
    } catch (autoErr) {
      console.warn('[Muse] 🔄 自主指标更新失败:', autoErr.message)
    }

    // 复盘成功的任务：提升相关记忆的整合强度（USTU 启发）
    try {
      if (isSuccess && Memories.boostIntegration) {
        const relatedMemories = Memories.searchWithIntegration
          ? Memories.searchWithIntegration(taskSummary.slice(0, 50), 3)
          : []
        for (const mem of relatedMemories) {
          Memories.boostIntegration(mem.id, { activation: 0.15, integration: 0.1 })
        }
      }
    } catch (boostErr) {
      console.warn('[Muse] 🔄 记忆强化失败:', boostErr.message)
    }

    console.log('[Muse] 🔄 任务复盘完成:', result.lesson)
    return result
  } catch (err) {
    console.error('[Muse] 🔄 任务复盘失败:', err.message)
  }
}

module.exports = {
  retrospectTask
}

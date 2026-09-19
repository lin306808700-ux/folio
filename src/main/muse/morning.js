// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 晨间回顾模块
 * 每日启动时回顾对话和记忆，更新主人画像
 */

const { callAI } = require('../../shared/ai-client')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { writeJournal, updateProfile } = require('./core')
const { AI_TIMEOUT_VERY_LONG } = require('./config')

/**
 * 晨间回顾
 * 
 * 回顾昨日对话和记忆，更新主人画像，发现可以主动帮助的地方
 */
async function morningReview() {
  console.log('[Muse] 🌅 开始晨间回顾...')

  const context = gatherOwnerContext()
  const today = new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const prompt = `${SOUL_PROMPT}

现在是 ${today}，你刚刚醒来，开始晨间回顾。

【主人的记忆总结】
${context.memories || '（暂无记忆）'}

【最近的对话记录】
${context.recentHistory || '（暂无对话）'}

【已有的灵感】
${context.ideas || '（暂无灵感）'}

【当前主人画像】
${context.profile || '（尚未建立画像）'}

请完成以下任务，以 JSON 格式返回：
{
  "morningThought": "你今天的思考（100字以内）",
  "ownerInsights": "你对主人的新理解或发现（如果有的话）",
  "profileUpdate": {
    "section": "要更新的画像维度（如：工作习惯、技术栈、兴趣爱好、近期关注）",
    "content": "更新内容"
  },
  "actionPlan": [
    {
      "type": "search|create|insight",
      "description": "你打算做什么",
      "query": "如果是搜索，搜什么关键词"
    }
  ],
  "todayFocus": "今天你最想帮主人做的一件事"
}`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_VERY_LONG // 晨间回顾使用 180 秒
    })

    const result = parseMuseResponse(response)
    if (!result) {
      console.warn('[Muse] 晨间回顾解析失败，记录原始响应')
      writeJournal(`## 晨间回顾（原始）\n\n${response}`, 'morning')
      return { success: false, raw: response }
    }

    // 写入晨间日志
    const journalContent = [
      `**今日思考**: ${result.morningThought}`,
      result.ownerInsights ? `**主人洞察**: ${result.ownerInsights}` : '',
      `**今日聚焦**: ${result.todayFocus}`,
      result.actionPlan?.length > 0
        ? `**行动计划**:\n${result.actionPlan.map((a, i) => `${i + 1}. [${a.type}] ${a.description}`).join('\n')}`
        : ''
    ].filter(Boolean).join('\n\n')

    writeJournal(journalContent, 'morning')

    // 更新主人画像
    if (result.profileUpdate?.section && result.profileUpdate?.content) {
      updateProfile(result.profileUpdate.section, result.profileUpdate.content)
    }

    // 执行行动计划
    if (result.actionPlan?.length > 0) {
      await executeActionPlan(result.actionPlan)
    }

    console.log('[Muse] 🌅 晨间回顾完成:', result.todayFocus)
    return { success: true, result }
  } catch (err) {
    console.error('[Muse] 晨间回顾失败:', err.message)
    writeJournal(`晨间回顾失败: ${err.message}`, 'morning')
    return { success: false, error: err.message }
  }
}

/**
 * 执行行动计划
 */
async function executeActionPlan(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return

  const { writeInsight, createInWorkspace } = require('./core')
  const { sendLetter } = require('./mailbox')

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'search':
          // 探索已转为心跳统一调度，避免与心跳锁冲突
          console.log('[Muse] 探索建议已记录，待心跳调度:', action.query || action.description)
          break

        case 'create': {
          const safeDesc = action.description.replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fa5._-]/g, '').slice(0, 60)
          createInWorkspace(`${Date.now()}_${safeDesc}.md`, action.description)
          break
        }

        case 'insight':
          writeInsight(action.description, action.description)
          sendLetter({
            title: action.description,
            content: action.description,
            priority: 'normal',
            source: 'morning'
          })
          break
      }
    } catch (err) {
      console.error(`[Muse] 执行行动计划失败 [${action.type}]:`, err.message)
    }
  }
}

module.exports = {
  morningReview
}

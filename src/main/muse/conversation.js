// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 对话分析模块
 * 分析主人对话，提取有价值信息，更新画像
 */

const { callAI } = require('../../shared/ai-client')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { writeJournal, updateProfile, writeInsight } = require('./core')
const { sendLetter } = require('./mailbox')
const { AI_TIMEOUT_NORMAL } = require('./config')

/**
 * 对话分析
 * 
 * 分析主人的对话，提取有价值的信息，更新画像
 */
// 不应触发画像更新的对话模式（任务状态查询、系统状态查询等）
const SKIP_ANALYSIS_PATTERNS = [
  /(?:当前|目前|现在).*(?:正在|在)?(?:执行|进行|处理|做).*(?:任务|什么|啥)/,
  /(?:上一个|上个|最近的?)(?:任务|对话|问题|请求)/,
  /(?:任务|工作).*(?:列表|清单|状态|进度)/,
  /(?:执行中|进行中|处理中)的?(?:任务|工作)/,
  /(?:正在|在)(?:执行|进行|处理|做).*(?:任务|什么|啥)/,
]

async function analyzeConversation(query, aiResponse) {
  console.log('[Muse] 💬 分析对话...')

  // 任务状态查询类对话不分析，避免把 AI 基于画像的猜测反向强化到画像里
  for (const pattern of SKIP_ANALYSIS_PATTERNS) {
    if (pattern.test(query)) {
      console.log('[Muse] 跳过对话分析（任务状态查询类）')
      return { success: true, significant: false }
    }
  }

  const context = gatherOwnerContext()

  const prompt = `${SOUL_PROMPT}

主人刚刚进行了一次对话，请分析这次对话。

【对话内容】
主人: ${query}
AI: ${(aiResponse || '').slice(0, 1000)}

【主人画像（历史记录，非实时状态，注意区分历史项目和当前任务）】
${context.profile || '（尚未建立画像）'}

请分析这次对话，以 JSON 格式返回：
{
  "isSignificant": true/false,
  "category": "工作|学习|生活|技术|创意|其他",
  "insights": "从这次对话中你发现了什么（如果不重要就返回空字符串）",
  "profileUpdate": {
    "section": "要更新的画像维度（如果需要更新）",
    "content": "更新内容"
  },
  "ideaSpark": {
    "title": "如果这次对话激发了灵感，写标题（否则为空）",
    "content": "灵感内容"
  },
  "proactiveAction": {
    "type": "search|create|none",
    "description": "你想主动做什么来帮助主人（如果不需要就 type 为 none）",
    "query": "搜索关键词（如果 type 是 search）"
  }
}

注意：不是每次对话都有价值，日常闲聊返回 isSignificant: false 即可。`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })

    const result = parseMuseResponse(response)
    if (!result || !result.isSignificant) {
      console.log('[Muse] 对话不具有显著价值，跳过')
      return { success: true, significant: false }
    }

    // 更新画像（带日期标记，便于后续判断信息时效性）
    if (result.profileUpdate?.section && result.profileUpdate?.content) {
      const datePrefix = `[${new Date().toISOString().slice(0, 10)}] `
      const contentWithDate = result.profileUpdate.content
        .split('\n')
        .map(line => line.trim() ? (line.startsWith('[') ? line : datePrefix + line) : line)
        .join('\n')
      updateProfile(result.profileUpdate.section, contentWithDate)
    }

    // 记录灵感并发信通知主人
    if (result.ideaSpark?.title) {
      writeInsight(result.ideaSpark.title, result.ideaSpark.content)
      sendLetter({
        title: result.ideaSpark.title,
        content: result.ideaSpark.content || result.insights || '',
        priority: 'normal',
        source: 'conversation'
      })
    }

    // 主动行动
    if (result.proactiveAction?.type && result.proactiveAction.type !== 'none') {
      await executeActionPlan([result.proactiveAction])
    }

    // 写入日志
    if (result.insights) {
      writeJournal(`**对话分析**: ${result.category}\n\n${result.insights}`, 'conversation')
    }

    console.log('[Muse] 💬 对话分析完成:', result.category)
    return { success: true, significant: true, result }
  } catch (err) {
    console.error('[Muse] 对话分析失败:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * 执行行动计划
 */
async function executeActionPlan(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return

  const { createInWorkspace } = require('./core')

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
      }
    } catch (err) {
      console.error(`[Muse] 执行行动计划失败 [${action.type}]:`, err.message)
    }
  }
}

module.exports = {
  analyzeConversation
}

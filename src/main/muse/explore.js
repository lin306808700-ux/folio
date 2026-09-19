'use strict'

/**
 * 主动探索模块
 * 根据主人画像和兴趣，主动搜索有价值的信息
 */

const { callAI } = require('../../shared/ai-client')
const { searchBing, formatSearchResults } = require('../web-search')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { writeJournal, writeInsight } = require('./core')
const { EXPLORE_COOLDOWN, MAX_DAILY_EXPLORES, EXPLORE_HISTORY_FILE, AI_TIMEOUT_SHORT, AI_TIMEOUT_NORMAL } = require('./config')
const fs = require('fs')

/**
 * 探索历史记录管理
 */
function loadExploreHistory() {
  try {
    if (fs.existsSync(EXPLORE_HISTORY_FILE)) {
      const data = fs.readFileSync(EXPLORE_HISTORY_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.warn('[Muse] 加载探索历史失败:', err.message)
  }
  return { explores: [], lastExploreTime: 0 }
}

function saveExploreHistory(history) {
  try {
    fs.writeFileSync(EXPLORE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8')
  } catch (err) {
    console.error('[Muse] 保存探索历史失败:', err.message)
  }
}

/**
 * 检查是否允许探索（频率限制）
 */
function canExplore() {
  const history = loadExploreHistory()
  const now = Date.now()

  // 检查冷却期
  const timeSinceLastExplore = now - history.lastExploreTime
  if (timeSinceLastExplore < EXPLORE_COOLDOWN) {
    const remainingMinutes = Math.ceil((EXPLORE_COOLDOWN - timeSinceLastExplore) / 60000)
    console.log(`[Muse] ⏳ 探索冷却中，还需等待 ${remainingMinutes} 分钟`)
    return { allowed: false, reason: 'cooldown', remainingMinutes }
  }

  // 检查每日上限
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  const todayExplores = history.explores.filter(t => t > oneDayAgo)
  
  if (todayExplores.length >= MAX_DAILY_EXPLORES) {
    console.log(`[Muse] ⚠️ 今日探索次数已达上限 (${todayExplores.length}/${MAX_DAILY_EXPLORES})`)
    return { allowed: false, reason: 'daily_limit', todayCount: todayExplores.length }
  }

  return { allowed: true, todayCount: todayExplores.length }
}

/**
 * 记录探索历史
 */
function recordExplore() {
  const history = loadExploreHistory()
  const now = Date.now()
  
  history.explores.push(now)
  history.lastExploreTime = now
  
  // 清理 7 天前的记录
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  history.explores = history.explores.filter(t => t > sevenDaysAgo)
  
  saveExploreHistory(history)
}

/**
 * 主动探索
 * 
 * 根据主人画像和兴趣，主动搜索有价值的信息
 * 含频率限制：冷却期 + 每日上限
 * 
 * @param {string} topic - 探索主题（可选，不传则 AI 自主选题）
 * @param {Object} options - { goalId: 关联目标 ID }
 */
async function proactiveExplore(topic, options = {}) {
  const { goalId } = options
  // 检查频率限制
  const checkResult = canExplore()
  if (!checkResult.allowed) {
    console.log('[Muse] 🚫 探索被频率限制阻止:', checkResult.reason)
    return { success: false, reason: checkResult.reason, ...checkResult }
  }

  console.log('[Muse] 🔍 主动探索:', topic || '自主选题', `(今日第 ${checkResult.todayCount + 1} 次)${goalId ? ' [目标驱动]' : ''}`)

  const context = gatherOwnerContext()

  // 如果没有指定主题，让 AI 自己决定探索什么
  if (!topic) {
    const decidePrompt = `${SOUL_PROMPT}

【当前主人画像】
${context.profile || '（尚未建立画像）'}

【最近的对话记录】
${context.recentHistory || '（暂无对话）'}

根据你对主人的了解，你觉得现在最值得探索什么话题？
请直接返回一个搜索关键词（中文或英文），不要解释。`

    try {
      topic = await callAI(decidePrompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_SHORT
      })
      topic = topic.trim().replace(/^["']|["']$/g, '')
      console.log('[Muse] 自主选题:', topic)
    } catch (err) {
      console.error('[Muse] 选题失败:', err.message)
      return { success: false, error: err.message }
    }
  }

  // 搜索网络
  try {
    const searchResults = await searchBing(topic, 5)
    if (!searchResults || searchResults.length === 0) {
      console.log('[Muse] 搜索无结果')
      writeJournal(`探索「${topic}」— 搜索无结果`, 'explore')
      return { success: true, noResults: true }
    }

    const formattedResults = formatSearchResults(searchResults)

    // 让 AI 分析搜索结果，提炼洞察
    const analyzePrompt = `${SOUL_PROMPT}

你刚刚搜索了「${topic}」，以下是搜索结果：

${formattedResults}

【当前主人画像】
${context.profile || '（尚未建立画像）'}

请分析这些搜索结果，以 JSON 格式返回：
{
  "summary": "搜索结果的核心摘要（200字以内）",
  "relevanceToOwner": "这些信息对主人有什么价值",
  "keyFindings": ["发现1", "发现2", "发现3"],
  "shouldCreateInsight": true/false,
  "insightTitle": "如果值得写洞察报告，标题是什么",
  "insightContent": "洞察报告内容（如果 shouldCreateInsight 为 true）",
  "nextExploreTopics": ["后续可以探索的话题1", "话题2"]
}`

    const response = await callAI(analyzePrompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })

    const result = parseMuseResponse(response)
    if (!result) {
      writeJournal(`探索「${topic}」— 分析失败\n\n搜索结果:\n${formattedResults}`, 'explore')
      return { success: false, raw: response }
    }

    // 写入探索日志
    const journalContent = [
      `**探索主题**: ${topic}`,
      `**核心摘要**: ${result.summary}`,
      `**与主人的关联**: ${result.relevanceToOwner}`,
      `**关键发现**:\n${(result.keyFindings || []).map(f => `- ${f}`).join('\n')}`,
      result.nextExploreTopics?.length > 0
        ? `**后续探索**: ${result.nextExploreTopics.join('、')}`
        : ''
    ].filter(Boolean).join('\n\n')

    writeJournal(journalContent, 'explore')

    // 写入洞察报告（关联目标时追加 goal 引用）
    if (result.shouldCreateInsight && result.insightTitle) {
      const insightContent = goalId
        ? `> Goal: ${goalId}\n\n${result.insightContent}`
        : result.insightContent
      writeInsight(result.insightTitle, insightContent)
    }

    console.log('[Muse] 🔍 探索完成:', topic)
    
    // 记录探索历史
    recordExplore()
    
    return { success: true, result, goalId: goalId || null }
  } catch (err) {
    console.error('[Muse] 探索失败:', err.message)
    writeJournal(`探索「${topic}」失败: ${err.message}`, 'explore')
    return { success: false, error: err.message }
  }
}

module.exports = {
  proactiveExplore,
  canExplore,
  loadExploreHistory,
  getExploreStats: () => {
    const history = loadExploreHistory()
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const todayCount = history.explores.filter(t => t > oneDayAgo).length
    const timeSinceLast = now - history.lastExploreTime
    const cooldownRemaining = Math.max(0, EXPLORE_COOLDOWN - timeSinceLast)
    
    return {
      todayCount,
      maxDaily: MAX_DAILY_EXPLORES,
      lastExploreTime: history.lastExploreTime,
      cooldownRemainingMs: cooldownRemaining,
      cooldownRemainingMinutes: Math.ceil(cooldownRemaining / 60000)
    }
  }
}

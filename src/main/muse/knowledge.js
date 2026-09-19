// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 知识检索模块
 * 打通知识写入→检索→注入闭环
 * 让已积累的 journal/insights/memories 真正可用
 */

const fs = require('fs')
const path = require('path')
const { INSIGHTS_DIR, JOURNAL_DIR, AI_TIMEOUT_SHORT, MEMORY_CONSOLIDATION_THRESHOLD } = require('./config')
const { callAI } = require('../../shared/ai-client')
const { getMuseSessionId } = require('./context')
const { parseMuseResponse } = require('./prompt')

// 延迟加载避免循环依赖
let _Memories = null
let _MemorySummary = null
function loadDB() {
  if (!_Memories) {
    const db = require('../database')
    _Memories = db.Memories
    _MemorySummary = db.MemorySummary
  }
}

/**
 * 统一检索接口：跨 memories / insights / journal 检索与任务相关的过往经验
 * @param {string} taskCommand - 任务命令（作为检索关键词）
 * @param {number} limit - 每类最多返回条数
 * @returns {string} 格式化的经验字符串，可直接注入 prompt
 */
function retrieveRelevant(taskCommand, limit = 5) {
  if (!taskCommand || typeof taskCommand !== 'string') return ''

  loadDB()
  const keywords = extractKeywords(taskCommand)
  if (keywords.length === 0) return ''

  const sections = []

  // 1. 检索记忆碎片（按整合强度+关键词匹配排序）
  try {
    const memories = _Memories.searchWithIntegration(taskCommand, limit)
    if (memories && memories.length > 0) {
      const memLines = memories.map(m => {
        const score = m._integrationScore ? ` (整合度${Math.round(m._integrationScore * 100)}%)` : ''
        return `- [记忆]${score} ${truncate(m.content, 120)}`
      })
      sections.push(memLines.join('\n'))
    }
  } catch (err) {
    console.warn('[Muse] 知识检索-记忆失败:', err.message)
  }

  // 2. 检索洞察报告
  try {
    const insights = searchInsights(keywords, limit)
    if (insights.length > 0) {
      const insLines = insights.map(i => `- [洞察] ${truncate(i.title, 60)}: ${truncate(i.summary, 100)}`)
      sections.push(insLines.join('\n'))
    }
  } catch (err) {
    console.warn('[Muse] 知识检索-洞察失败:', err.message)
  }

  // 3. 检索复盘日志（只看 retrospect 类型）
  try {
    const lessons = searchRetrospectLogs(keywords, limit)
    if (lessons.length > 0) {
      const lesLines = lessons.map(l => `- [教训] ${truncate(l.lesson, 120)}`)
      sections.push(lesLines.join('\n'))
    }
  } catch (err) {
    console.warn('[Muse] 知识检索-复盘失败:', err.message)
  }

  if (sections.length === 0) return ''

  return sections.join('\n')
}

/**
 * 从任务命令中提取关键词
 */
function extractKeywords(text) {
  // 移除标点和常见停用词
  const cleaned = text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  
  const words = cleaned.split(' ').filter(w => w.length >= 2)
  
  // 中文按字符拆分（简单方案：2-4字组合）
  const cnChunks = []
  const cnMatches = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) || []
  for (const cn of cnMatches) {
    if (cn.length >= 2) cnChunks.push(cn)
    if (cn.length >= 4) cnChunks.push(cn.slice(0, 2))
  }
  
  return [...new Set([...words, ...cnChunks])].slice(0, 10)
}

/**
 * 搜索洞察报告目录
 */
function searchInsights(keywords, limit) {
  const results = []
  try {
    if (!fs.existsSync(INSIGHTS_DIR)) return results
    const files = fs.readdirSync(INSIGHTS_DIR).filter(f => f.endsWith('.md')).sort().reverse()
    
    for (const file of files) {
      if (results.length >= limit) break
      try {
        const content = fs.readFileSync(path.join(INSIGHTS_DIR, file), 'utf8')
        const lowerContent = content.toLowerCase()
        
        let matchScore = 0
        for (const kw of keywords) {
          if (lowerContent.includes(kw)) matchScore++
        }
        if (matchScore === 0) continue
        
        // 提取标题（第一行 # 开头）
        const titleMatch = content.match(/^#\s+(.+)/m)
        const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '')
        
        // 提取摘要（前 200 字非标题内容）
        const bodyText = content.replace(/^#.*$/m, '').trim()
        const summary = bodyText.slice(0, 200).replace(/\n/g, ' ')
        
        results.push({ file, title, summary, matchScore })
      } catch {}
    }
    
    results.sort((a, b) => b.matchScore - a.matchScore)
  } catch (err) {
    console.warn('[Muse] 搜索洞察失败:', err.message)
  }
  return results
}

/**
 * 搜索复盘日志（journal 中 type=retrospect 的条目）
 */
function searchRetrospectLogs(keywords, limit) {
  const results = []
  try {
    if (!fs.existsSync(JOURNAL_DIR)) return results
    const files = fs.readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.md')).sort().reverse()
    
    for (const file of files) {
      if (results.length >= limit) break
      try {
        const content = fs.readFileSync(path.join(JOURNAL_DIR, file), 'utf8')
        
        // 按条目分割（## 开头）
        const entries = content.split(/\n(?=##\s)/)
        for (const entry of entries) {
          if (results.length >= limit) break
          if (!entry.includes('[retrospect]')) continue
          
          const lowerEntry = entry.toLowerCase()
          let matchScore = 0
          for (const kw of keywords) {
            if (lowerEntry.includes(kw)) matchScore++
          }
          if (matchScore === 0) continue
          
          // 提取教训
          const lessonMatch = entry.match(/\*\*教训\*\*[:：]\s*(.+)/)
          const lesson = lessonMatch ? lessonMatch[1].trim() : entry.slice(0, 120).replace(/\n/g, ' ')
          
          results.push({ file, lesson, matchScore })
        }
      } catch {}
    }
    
    results.sort((a, b) => b.matchScore - a.matchScore)
  } catch (err) {
    console.warn('[Muse] 搜索复盘日志失败:', err.message)
  }
  return results
}

/**
 * 记忆归纳：将碎片记忆合并为结构化摘要
 * 消费 Memories.add() 返回的 shouldConsolidate 标志（当前从未被消费）
 */
async function consolidateMemories() {
  loadDB()
  
  const activeMemories = _Memories.getActive()
  if (activeMemories.length < MEMORY_CONSOLIDATION_THRESHOLD) {
    return { consolidated: false, reason: 'not_enough_memories', count: activeMemories.length }
  }

  console.log(`[Muse] 🧠 开始记忆归纳（${activeMemories.length} 条碎片）...`)

  // 取整合度最低的 5-10 条碎片进行归纳
  const toConsolidate = activeMemories
    .sort((a, b) => (a.integration || 0) - (b.integration || 0))
    .slice(0, Math.min(10, activeMemories.length))

  const fragments = toConsolidate.map(m => 
    `- [${m.created_at?.slice(0, 10) || '未知'}] ${truncate(m.content, 200)}`
  ).join('\n')

  const prompt = `以下是关于同一主人的多条记忆碎片，请将它们归纳为一条结构化摘要。

【记忆碎片】
${fragments}

请以 JSON 格式返回归纳结果：
{
  "summary": "归纳后的结构化摘要（100字以内，保留关键信息，去除冗余）",
  "domain": "所属知识领域（如：前端开发、DevOps、数据分析、副业探索等）",
  "keyPoints": ["关键点1", "关键点2"]
}

规则：
- 合并相似信息，不丢失关键细节
- 标注所属领域，便于后续检索
- 返回纯 JSON`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const result = parseMuseResponse(response)
    if (!result || !result.summary) {
      console.warn('[Muse] 记忆归纳解析失败')
      return { consolidated: false, reason: 'parse_failed' }
    }

    // 写入归纳摘要
    const summaryContent = result.domain 
      ? `[${result.domain}] ${result.summary}`
      : result.summary

    _MemorySummary.add({
      summary: summaryContent,
      sourceCount: toConsolidate.length
    })

    // 归档原始碎片
    for (const mem of toConsolidate) {
      _Memories.archive(mem.id)
    }

    console.log(`[Muse] 🧠 记忆归纳完成: ${toConsolidate.length} 条碎片 → 1 条摘要 (${result.domain || '未知领域'})`)
    return { 
      consolidated: true, 
      count: toConsolidate.length, 
      summary: result.summary,
      domain: result.domain 
    }
  } catch (err) {
    console.error('[Muse] 记忆归纳失败:', err.message)
    return { consolidated: false, reason: 'error', error: err.message }
  }
}

/**
 * 执行记忆衰减（代理 Memories.runDecay）
 * 低整合强度 + 超过 7 天的记忆自动归档
 */
function runDecay() {
  loadDB()
  try {
    return _Memories.runDecay()
  } catch (err) {
    console.warn('[Muse] 记忆衰减失败:', err.message)
    return { archived: 0 }
  }
}

/**
 * 搜索知识库（前端知识地图数据源）
 * @param {string} keyword - 搜索关键词
 * @param {number} limit - 返回条数
 * @returns {Object} { memories, insights, summaries }
 */
function searchKnowledge(keyword, limit = 20) {
  loadDB()
  const result = { memories: [], insights: [], summaries: [] }

  // 搜索记忆碎片
  try {
    result.memories = _Memories.searchWithIntegration(keyword, limit).map(m => ({
      id: m.id,
      content: truncate(m.content, 200),
      domain: m.domain || '未分类',
      integration: m._integrationScore || 0,
      created_at: m.created_at,
      last_accessed: m.last_accessed
    }))
  } catch {}

  // 搜索洞察
  const keywords = extractKeywords(keyword)
  try {
    result.insights = searchInsights(keywords, limit).map(i => ({
      file: i.file,
      title: i.title,
      summary: truncate(i.summary, 200),
      matchScore: i.matchScore
    }))
  } catch {}

  // 搜索摘要
  try {
    const allSummaries = _MemorySummary.getActive()
    const lowerKeyword = keyword.toLowerCase()
    result.summaries = allSummaries
      .filter(s => s.summary.toLowerCase().includes(lowerKeyword))
      .slice(0, limit)
      .map(s => ({
        id: s.id,
        summary: truncate(s.summary, 200),
        sourceCount: s.sourceCount,
        created_at: s.created_at
      }))
  } catch {}

  return result
}

/**
 * 截断字符串
 */
function truncate(str, maxLen) {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
}

module.exports = {
  retrieveRelevant,
  consolidateMemories,
  runDecay,
  searchKnowledge,
  extractKeywords,
  searchInsights,
  searchRetrospectLogs
}

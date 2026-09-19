// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * Craft 质量门禁系统
 * 
 * 借鉴 Open Design 的 craft 规则体系：
 * AI 生成内容后，自动加载匹配的质量检查规则做一轮 self-review critique。
 * 
 * 规则位置：~/.folio/craft/*.md
 * 规则格式：YAML frontmatter + Markdown 正文（检查清单）
 * 
 * frontmatter 字段：
 *   name: 规则名称
 *   description: 一句话描述
 *   category: 适用分类（frontend, backend, code, writing, general）
 *   severity: 严重级别（P0=must-fix, P1=should-fix, P2=nice-to-fix）
 *   triggers: 触发关键词（可选，空则按 category 自动匹配）
 *   autoApply: 是否自动应用（默认 true）
 * 
 * 工作流程：
 * 1. AI 生成响应后，根据对话场景匹配相关 craft 规则
 * 2. 将规则注入追加 prompt，让 AI 做一轮自我评审
 * 3. 返回评审结果（通过/需修改）和修改建议
 */

const fs = require('fs')
const path = require('path')
const { parseFrontmatter } = require('./frontmatter')

const CRAFT_DIR = path.join(process.env.HOME || '', '.folio', 'craft')
const BUILTIN_CRAFT_DIR = path.join(__dirname, '..', '..', 'craft')

let _ruleCache = null
let _ruleCacheTimestamp = 0
const CACHE_TTL = 30000

/**
 * 加载所有 craft 规则
 */
function loadRules() {
  const now = Date.now()
  if (_ruleCache && (now - _ruleCacheTimestamp) < CACHE_TTL) {
    return _ruleCache
  }

  const rules = []

  loadRulesFromDirectory(BUILTIN_CRAFT_DIR, 'builtin', rules)
  loadRulesFromDirectory(CRAFT_DIR, 'user', rules)

  // P0 > P1 > P2
  const severityOrder = { P0: 0, P1: 1, P2: 2 }
  rules.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))

  _ruleCache = rules
  _ruleCacheTimestamp = now
  console.log(`[CraftChecker] 加载 ${rules.length} 条质量规则`)
  return rules
}

function loadRulesFromDirectory(dirPath, source, rules) {
  if (!fs.existsSync(dirPath)) return

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'))
  for (const file of files) {
    try {
      const filePath = path.join(dirPath, file)
      const raw = fs.readFileSync(filePath, 'utf-8')
      const { meta, content } = parseFrontmatter(raw)

      if (!meta.name || !content.trim()) continue

      // 用户规则可覆盖同名内置规则
      if (source === 'user') {
        const existingIndex = rules.findIndex(r => r.name === meta.name)
        if (existingIndex !== -1) {
          rules.splice(existingIndex, 1)
        }
      }

      const triggers = meta.triggers
        ? (Array.isArray(meta.triggers) ? meta.triggers : String(meta.triggers).split(','))
            .map(t => t.toLowerCase().trim()).filter(Boolean)
        : []

      rules.push({
        name: meta.name,
        description: meta.description || '',
        category: meta.category || 'general',
        severity: meta.severity || 'P1',
        triggers,
        autoApply: meta.autoApply !== false && meta.autoApply !== 'false',
        content: content.trim(),
        source,
        filePath
      })
    } catch (error) {
      console.warn(`[CraftChecker] 加载规则失败 ${file}:`, error.message)
    }
  }
}

/**
 * 根据场景匹配适用的 craft 规则
 * @param {string} userInput - 用户输入
 * @param {string} aiResponse - AI 响应内容
 * @param {object} [options]
 * @param {string} [options.category] - 强制分类
 * @param {string[]} [options.severities] - 只检查指定严重级别（默认 ['P0', 'P1']）
 * @returns {Array<object>} 匹配的规则列表
 */
function matchRules(userInput, aiResponse, options = {}) {
  const rules = loadRules()
  const input = (userInput + ' ' + aiResponse).toLowerCase()
  const severities = options.severities || ['P0', 'P1']
  const matched = []

  for (const rule of rules) {
    if (!rule.autoApply) continue
    if (!severities.includes(rule.severity)) continue
    if (options.category && rule.category !== options.category && rule.category !== 'general') continue

    let isMatch = false

    // trigger 匹配
    if (rule.triggers.length > 0) {
      isMatch = rule.triggers.some(trigger => input.includes(trigger))
    }

    // 分类自动匹配
    if (!isMatch && !options.category) {
      isMatch = detectCategory(input) === rule.category || rule.category === 'general'
    }

    if (!isMatch && options.category) {
      isMatch = rule.category === options.category || rule.category === 'general'
    }

    if (isMatch) {
      matched.push(rule)
    }
  }

  return matched
}

/**
 * 检测输入内容的分类
 */
function detectCategory(input) {
  const categorySignals = {
    frontend: ['html', 'css', 'react', 'vue', 'svelte', '前端', '页面', '组件', 'tailwind', 'ui', '样式', '布局', '动画', 'landing page', 'dashboard'],
    backend: ['api', '接口', '后端', 'node', 'python', 'java', 'sql', '数据库', '服务', 'express', 'fastapi'],
    code: ['代码', '函数', '重构', 'refactor', '优化', 'bug', '修复', 'debug', 'test', '测试'],
    writing: ['文档', '报告', '邮件', '文案', '写作', '总结', '翻译']
  }

  let bestCategory = 'general'
  let bestScore = 0

  for (const [category, signals] of Object.entries(categorySignals)) {
    const score = signals.filter(s => input.includes(s)).length
    if (score > bestScore) {
      bestScore = score
      bestCategory = category
    }
  }

  return bestCategory
}

/**
 * 构建 craft 评审 prompt
 * 将匹配的规则组装成一个 critique prompt，供 AI 做自我评审
 * 
 * @param {string} userInput - 原始用户输入
 * @param {string} aiResponse - AI 生成的响应
 * @param {object} [options]
 * @returns {{ prompt: string, rules: Array<object> } | null} 评审 prompt 和匹配的规则，无匹配时返回 null
 */
function buildCritiquePrompt(userInput, aiResponse, options = {}) {
  const matched = matchRules(userInput, aiResponse, options)
  if (matched.length === 0) return null

  // 检查 AI 响应是否包含可评审的产物（代码、HTML、脚本等）
  if (!hasReviewableContent(aiResponse)) return null

  const sections = []
  sections.push('你是一个质量评审员。请根据以下规则检查上方生成的内容，指出需要修改的地方。')
  sections.push('')
  sections.push('## 评审规则')
  sections.push('')

  for (const rule of matched) {
    sections.push(`### [${rule.severity}] ${rule.name}`)
    if (rule.description) sections.push(`> ${rule.description}`)
    sections.push('')
    sections.push(rule.content)
    sections.push('')
  }

  sections.push('## 评审输出格式')
  sections.push('')
  sections.push('请按以下格式输出评审结果：')
  sections.push('')
  sections.push('CRAFT_REVIEW:')
  sections.push('- **通过/需修改**: (整体结论)')
  sections.push('- **P0 问题**: (必须修复的问题列表，无则写"无")')
  sections.push('- **P1 建议**: (建议修复的问题列表，无则写"无")')
  sections.push('- **亮点**: (做得好的地方)')
  sections.push('')
  sections.push('如果需要修改，请直接给出修改后的代码/内容，使用 SEARCH_REPLACE 格式。')

  return {
    prompt: sections.join('\n'),
    rules: matched
  }
}

/**
 * 检查 AI 响应是否包含可评审的产物
 */
function hasReviewableContent(response) {
  if (!response || response.length < 50) return false

  const indicators = [
    /```(?:html|css|jsx?|tsx?|python|java|go|rust|swift)/i,
    /ARTIFACT:/,
    /SCRIPT_BLOCK/,
    /MUSE_TASK/,
    /<(?:div|section|main|header|nav|article|html)\b/i,
    /\bfunction\s+\w+/,
    /\bclass\s+\w+/,
    /\bconst\s+\w+\s*=/,
    /\blet\s+\w+\s*=/,
    /\bvar\s+\w+\s*=/,
    /\bdef\s+\w+/,
    /\bfunc\s+\w+/,
    /\bexport\s+(?:default\s+)?(?:function|class|const)/,
    /\bimport\s+.+from\s+/,
    /\brequire\s*\(/,
  ]

  return indicators.some(pattern => pattern.test(response))
}

/**
 * 解析 AI 的评审结果
 * @param {string} reviewResponse - AI 评审回复
 * @returns {{ passed: boolean, p0Issues: string[], p1Suggestions: string[], highlights: string[] }}
 */
function parseCritiqueResult(reviewResponse) {
  const result = {
    passed: true,
    p0Issues: [],
    p1Suggestions: [],
    highlights: []
  }

  if (!reviewResponse) return result

  // 检查是否通过
  if (/需修改|不通过|fail/i.test(reviewResponse)) {
    result.passed = false
  }

  // 提取 P0 问题（匹配 "P0 问题" 或 "**P0 问题**" 等变体）
  const p0Match = reviewResponse.match(/\*{0,2}P0\s*问题\*{0,2}\s*[：:]\s*([\s\S]*?)(?=\*{0,2}P1|亮点|\*{0,2}亮点|$)/i)
  if (p0Match && !/^[\s]*无[\s]*$/.test(p0Match[1].trim())) {
    result.p0Issues = extractListItems(p0Match[1])
    if (result.p0Issues.length > 0) result.passed = false
  }

  // 提取 P1 建议
  const p1Match = reviewResponse.match(/\*{0,2}P1\s*建议\*{0,2}\s*[：:]\s*([\s\S]*?)(?=\*{0,2}亮点|$)/i)
  if (p1Match && !/^[\s]*无[\s]*$/.test(p1Match[1].trim())) {
    result.p1Suggestions = extractListItems(p1Match[1])
  }

  // 提取亮点
  const highlightMatch = reviewResponse.match(/\*{0,2}亮点\*{0,2}\s*[：:]\s*([\s\S]*?)$/i)
  if (highlightMatch) {
    result.highlights = extractListItems(highlightMatch[1])
  }

  return result
}

/**
 * 从文本中提取列表项
 */
function extractListItems(text) {
  return text.split('\n')
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(line => line.length > 2 && line !== '无')
}

/**
 * 列出所有规则
 */
function listRules() {
  const rules = loadRules()
  return rules.map(r => ({
    name: r.name,
    description: r.description,
    category: r.category,
    severity: r.severity,
    source: r.source
  }))
}

function clearCache() {
  _ruleCache = null
  _ruleCacheTimestamp = 0
}

module.exports = {
  loadRules,
  matchRules,
  buildCritiquePrompt,
  parseCritiqueResult,
  hasReviewableContent,
  listRules,
  clearCache,
  CRAFT_DIR,
  BUILTIN_CRAFT_DIR
}

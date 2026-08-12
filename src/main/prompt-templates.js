'use strict'

/**
 * Prompt 模板系统
 * 
 * 借鉴 Open Design 的 design-system 思路：
 * 用户预定义 .md 模板文件，AI 在特定场景自动加载对应模板作为 system prompt 的一部分。
 * 
 * 模板位置：~/.folio/prompt-templates/*.md
 * 模板格式：YAML frontmatter + Markdown 正文
 * 
 * frontmatter 字段：
 *   name: 模板名称
 *   description: 一句话描述
 *   triggers: 触发关键词数组
 *   category: 分类（如 frontend, backend, data, devops, writing）
 *   priority: 优先级（高数值优先，默认 0）
 *   exclusive: 是否排他（true 时只注入最高匹配的一个模板，默认 false）
 */

const fs = require('fs')
const path = require('path')
const { parseFrontmatter } = require('./frontmatter')

const TEMPLATES_DIR = path.join(process.env.HOME || '', '.folio', 'prompt-templates')
const BUILTIN_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'prompt-templates')

// 内存缓存（避免每次都读磁盘）
let _templateCache = null
let _cacheTimestamp = 0
const CACHE_TTL = 30000 // 30 秒缓存

/**
 * 加载所有模板（用户自定义 + 内置）
 * @returns {Array<{name: string, description: string, triggers: string[], category: string, priority: number, exclusive: boolean, content: string, source: string}>}
 */
function loadTemplates() {
  const now = Date.now()
  if (_templateCache && (now - _cacheTimestamp) < CACHE_TTL) {
    return _templateCache
  }

  const templates = []

  // 加载内置模板
  loadFromDirectory(BUILTIN_TEMPLATES_DIR, 'builtin', templates)
  // 加载用户自定义模板（优先级更高，可覆盖内置）
  loadFromDirectory(TEMPLATES_DIR, 'user', templates)

  // 按 priority 降序排列
  templates.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  _templateCache = templates
  _cacheTimestamp = now
  console.log(`[PromptTemplates] 加载 ${templates.length} 个模板 (内置: ${templates.filter(t => t.source === 'builtin').length}, 用户: ${templates.filter(t => t.source === 'user').length})`)
  return templates
}

/**
 * 从目录加载模板文件
 */
function loadFromDirectory(dirPath, source, templates) {
  if (!fs.existsSync(dirPath)) return

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'))
  for (const file of files) {
    try {
      const filePath = path.join(dirPath, file)
      const raw = fs.readFileSync(filePath, 'utf-8')
      const { meta, content } = parseFrontmatter(raw)

      if (!meta.name || !content.trim()) continue

      // 用户模板可覆盖同名内置模板
      if (source === 'user') {
        const existingIndex = templates.findIndex(t => t.name === meta.name)
        if (existingIndex !== -1) {
          templates.splice(existingIndex, 1)
        }
      }

      templates.push({
        name: meta.name,
        description: meta.description || '',
        triggers: parseTriggers(meta.triggers),
        category: meta.category || 'general',
        priority: parseInt(meta.priority, 10) || 0,
        exclusive: meta.exclusive === true || meta.exclusive === 'true',
        content: content.trim(),
        source,
        filePath
      })
    } catch (error) {
      console.warn(`[PromptTemplates] 加载模板失败 ${file}:`, error.message)
    }
  }
}

/**
 * 解析 triggers 字段（支持字符串、数组）
 */
function parseTriggers(triggers) {
  if (!triggers) return []
  if (Array.isArray(triggers)) return triggers.map(t => String(t).toLowerCase().trim())
  if (typeof triggers === 'string') {
    return triggers.split(',').map(t => t.toLowerCase().trim()).filter(Boolean)
  }
  return []
}

/**
 * 根据用户输入匹配模板
 * @param {string} userInput - 用户输入
 * @param {object} [options] - 额外匹配选项
 * @param {string} [options.category] - 强制指定分类
 * @param {number} [options.maxTemplates] - 最大注入模板数（默认 3）
 * @returns {Array<{template: object, score: number}>}
 */
function matchTemplates(userInput, options = {}) {
  const templates = loadTemplates()
  const input = userInput.toLowerCase().trim()
  const maxTemplates = options.maxTemplates || 3
  const results = []

  for (const template of templates) {
    // 强制分类过滤
    if (options.category && template.category !== options.category) continue

    let score = 0

    // trigger 关键词匹配
    for (const trigger of template.triggers) {
      if (input.includes(trigger)) {
        // 越长的 trigger 匹配分越高
        score = Math.max(score, trigger.length / input.length)
      }
    }

    // 分类关键词匹配（作为补充信号）
    const categoryKeywords = getCategoryKeywords(template.category)
    for (const keyword of categoryKeywords) {
      if (input.includes(keyword)) {
        score = Math.max(score, 0.1)
      }
    }

    if (score > 0.05) {
      results.push({ template, score })
    }
  }

  // 按 score 降序
  results.sort((a, b) => b.score - a.score)

  // 处理 exclusive 模板
  const topExclusive = results.find(r => r.template.exclusive)
  if (topExclusive && topExclusive.score > 0.2) {
    return [topExclusive]
  }

  return results.slice(0, maxTemplates)
}

/**
 * 构建匹配模板的上下文片段（注入到 system prompt）
 * @param {string} userInput
 * @param {object} [options]
 * @returns {string}
 */
function buildTemplateContext(userInput, options = {}) {
  const matches = matchTemplates(userInput, options)
  if (matches.length === 0) return ''

  const sections = []
  sections.push('\n\n## 场景模板指导\n以下模板与当前对话场景匹配，请参考遵循：\n')

  for (const { template, score } of matches) {
    sections.push(`### ${template.name}`)
    if (template.description) {
      sections.push(`> ${template.description}`)
    }
    sections.push('')
    sections.push(template.content)
    sections.push('')
  }

  console.log(`[PromptTemplates] 匹配 ${matches.length} 个模板:`, matches.map(m => `${m.template.name}(${m.score.toFixed(2)})`).join(', '))
  return sections.join('\n')
}

/**
 * 分类关键词映射
 */
function getCategoryKeywords(category) {
  const map = {
    frontend: ['前端', '页面', 'html', 'css', 'react', 'vue', 'ui', '组件', '样式', '布局', 'tailwind', '动画', 'landing', 'dashboard'],
    backend: ['后端', '接口', 'api', '服务', '数据库', 'sql', 'node', 'python', 'java', '微服务'],
    code: ['代码', '函数', '重构', 'refactor', '优化', '实现', '开发', '编写', 'bug', '修复', 'debug', '测试'],
    data: ['数据', '分析', '可视化', '图表', 'chart', 'excel', 'csv', '统计'],
    devops: ['部署', 'docker', 'ci', 'cd', 'k8s', '运维', '监控', 'nginx'],
    writing: ['文档', '报告', '周报', '月报', '日报', '复盘', '邮件', '文案', '写作', '总结', '翻译', 'ppt', '演示', '通知', '公告'],
    design: ['设计', '配色', '排版', '字体', '品牌', 'logo', '海报', '图标']
  }
  return map[category] || []
}

/**
 * 列出所有已加载的模板
 */
function listTemplates() {
  const templates = loadTemplates()
  return templates.map(t => ({
    name: t.name,
    description: t.description,
    category: t.category,
    triggers: t.triggers,
    source: t.source
  }))
}

/**
 * 清除缓存（用于用户修改模板后刷新）
 */
function clearCache() {
  _templateCache = null
  _cacheTimestamp = 0
}

module.exports = {
  loadTemplates,
  matchTemplates,
  buildTemplateContext,
  listTemplates,
  clearCache,
  TEMPLATES_DIR,
  BUILTIN_TEMPLATES_DIR
}

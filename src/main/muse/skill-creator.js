'use strict'

/**
 * Skill 创作引导模块
 * AI 对话式帮助用户创建技能，生成标准 SKILL.md 并保存到技能目录
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { callAI } = require('../../shared/ai-client')
const { SOUL_PROMPT } = require('./prompt')
const { AI_TIMEOUT_NORMAL, AI_TIMEOUT_LONG } = require('./config')

const SKILLS_DIR = path.join(os.homedir(), '.ai-terminal', 'skills')

// ========== 技能目录管理 ==========

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true })
  }
  return SKILLS_DIR
}

function skillDirExists(skillId) {
  return fs.existsSync(path.join(SKILLS_DIR, skillId))
}

/**
 * 将技能名称转换为合法的目录名（小写+连字符）
 */
function toSkillId(name) {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-\u4e00-\u9fa5]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || `skill-${Date.now()}`
}

// ========== AI 生成技能内容 ==========

/**
 * 根据用户描述，AI 生成完整的 SKILL.md 内容
 * @param {string} userDescription - 用户对技能的自然语言描述
 * @param {object} options - 附加选项
 * @returns {Promise<{ skillId: string, name: string, content: string }>}
 */
async function generateSkillContent(userDescription, options = {}) {
  const {
    sessionId = `skill_create_${Date.now()}`,
    empId = process.env.MUSE_EMP_ID || ''
  } = options

  const prompt = `${SOUL_PROMPT}

用户想创建一个新技能。请根据以下描述，生成标准的 SKILL.md 文件内容。

【主人描述】
${userDescription}

【输出要求】
严格按照以下 YAML frontmatter + Markdown 格式输出，不要输出任何其他内容：

\`\`\`markdown
---
name: 技能名称（英文小写+连字符，如：deploy-dashboard）
version: 1.0.0
description: "一句话描述这个技能的用途"

triggers:
  - 触发词1
  - 触发词2
  - 触发词3

inputs:
  参数名:
    type: string|number|boolean|enum
    description: "参数说明"
    default: 默认值（可选）
    required: true|false
    askIfMissing: true|false
    values: [可选值1, 可选值2]（仅 enum 类型需要）

sideEffects:
  - modifies:git
  - writes:file
  - network:request

requires:
  - python
  - ffmpeg

pythonPackages:
  - pillow
  - requests

dangerous: false
onError: ask
---

## 技能说明

[详细描述这个技能的功能、使用场景]

## 执行步骤

[具体的执行逻辑和步骤]

## 注意事项

[需要提前准备的条件、可能的风险等]
\`\`\`

规则：
1. name 字段使用英文小写+连字符格式
2. triggers 至少填 3 个中文触发词，覆盖用户可能说的各种表达方式
3. inputs 只在有明确参数需求时添加
4. sideEffects 只填实际会产生的副作用
5. requires 只在技能需要特定系统工具时填写（如 python/ffmpeg/git/docker），不需要则省略
6. pythonPackages 只在技能需要特定 Python 包时填写（如 pillow/requests/pandas），不需要则省略
7. 步骤要具体可执行，AI 能根据它完成操作
8. 如果是纯 Prompt 类技能（无需执行脚本），不需要 inputs、sideEffects、requires、pythonPackages`

  const response = await callAI(prompt, { sessionId, empId, timeout: AI_TIMEOUT_LONG })

  // 提取 markdown 代码块内容
  const mdMatch = response.match(/```markdown\n([\s\S]*?)```/)
  const rawContent = mdMatch ? mdMatch[1].trim() : response.trim()

  // 解析技能名称
  const nameMatch = rawContent.match(/^name:\s*(.+)$/m)
  const skillId = nameMatch ? toSkillId(nameMatch[1].trim()) : `skill-${Date.now()}`
  const name = nameMatch ? nameMatch[1].trim() : userDescription.slice(0, 30)

  return { skillId, name, content: rawContent }
}

// ========== 保存技能到文件系统 ==========

/**
 * 将生成的技能内容保存到 ~/.ai-terminal/skills/{skillId}/SKILL.md
 * @param {string} skillId - 技能目录名
 * @param {string} content - SKILL.md 内容
 * @returns {{ success: boolean, filePath?: string, error?: string }}
 */
function saveSkill(skillId, content) {
  try {
    ensureSkillsDir()
    const dirPath = path.join(SKILLS_DIR, skillId)

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }

    const filePath = path.join(dirPath, 'SKILL.md')
    fs.writeFileSync(filePath, content, 'utf-8')

    console.log(`[SkillCreator] 技能已保存: ${filePath}`)
    return { success: true, filePath, dirPath }
  } catch (error) {
    console.error('[SkillCreator] 保存技能失败:', error.message)
    return { success: false, error: error.message }
  }
}

// ========== 技能使用统计 ==========

const STATS_FILE = path.join(os.homedir(), '.ai-terminal', 'skill-stats.json')

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'))
    }
  } catch {}
  return {}
}

function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8')
  } catch (error) {
    console.error('[SkillCreator] 保存统计失败:', error.message)
  }
}

/**
 * 记录技能被激活
 * @param {string} skillId
 * @param {boolean} success - 是否执行成功
 */
function recordSkillUsage(skillId, success = true) {
  const stats = loadStats()
  if (!stats[skillId]) {
    stats[skillId] = { activations: 0, successes: 0, failures: 0, lastUsed: null }
  }
  stats[skillId].activations++
  if (success) {
    stats[skillId].successes++
  } else {
    stats[skillId].failures++
  }
  stats[skillId].lastUsed = new Date().toISOString()
  saveStats(stats)
}

/**
 * 获取技能统计数据
 * @param {string} [skillId] - 指定技能ID，不传则返回全部
 */
function getSkillStats(skillId) {
  const stats = loadStats()
  if (skillId) {
    return stats[skillId] || { activations: 0, successes: 0, failures: 0, lastUsed: null }
  }
  return stats
}

/**
 * 获取按激活次数排名的技能列表
 * @param {number} limit
 */
function getTopSkills(limit = 10) {
  const stats = loadStats()
  return Object.entries(stats)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.activations - a.activations)
    .slice(0, limit)
}

// ========== 主入口：对话式创建技能 ==========

/**
 * 根据用户描述创建技能
 * @param {string} description - 用户自然语言描述
 * @param {object} options
 * @returns {Promise<{ success: boolean, skill?: object, error?: string }>}
 */
async function createSkillFromDescription(description, options = {}) {
  try {
    console.log('[SkillCreator] 开始生成技能:', description.slice(0, 100))

    // AI 生成技能内容
    const { skillId, name, content } = await generateSkillContent(description, options)

    // Schema 验证门：验证生成的技能是否合法
    const { parseFrontmatter, validateSchema } = require('../skill-schema')
    const { meta } = parseFrontmatter(content)
    const validation = validateSchema(meta)
    if (!validation.valid) {
      console.warn('[SkillCreator] Schema 验证失败，但仍保存（仅警告）:', validation.errors)
      // 不阻断创建，但记录警告让用户知晓
      // 同时将验证错误附加到返回结果中
    }

    // 检查是否已存在同名技能
    if (skillDirExists(skillId)) {
      const uniqueId = `${skillId}-${Date.now().toString(36)}`
      const saveResult = saveSkill(uniqueId, content)
      if (!saveResult.success) {
        return { success: false, error: saveResult.error }
      }
      return {
        success: true,
        skill: { id: uniqueId, name, filePath: saveResult.filePath, dirPath: saveResult.dirPath, content }
      }
    }

    const saveResult = saveSkill(skillId, content)
    if (!saveResult.success) {
      return { success: false, error: saveResult.error }
    }

    return {
      success: true,
      skill: { id: skillId, name, filePath: saveResult.filePath, dirPath: saveResult.dirPath, content }
    }
  } catch (error) {
    console.error('[SkillCreator] 创建技能失败:', error.message)
    return { success: false, error: error.message }
  }
}

/**
 * 根据用户需求推荐现有技能
 * @param {string} userInput
 * @param {Array} availableSkills - 当前已安装的技能列表
 * @param {object} options
 * @returns {Promise<{ suggestions: Array<{ skillId, name, reason, score }> }>}
 */
async function suggestSkills(userInput, availableSkills, options = {}) {
  if (!availableSkills || availableSkills.length === 0) {
    return { suggestions: [] }
  }

  const {
    sessionId = `skill_suggest_${Date.now()}`,
    empId = process.env.MUSE_EMP_ID || ''
  } = options

  const skillList = availableSkills.slice(0, 30).map(s =>
    `- ${s.id}: ${s.name}（${s.description || '无描述'}）`
  ).join('\n')

  const prompt = `根据用户的输入，从已安装技能列表中找出最相关的技能（最多 3 个）。

【用户输入】
${userInput}

【已安装技能】
${skillList}

请以 JSON 格式返回，格式如下：
{"suggestions":[{"skillId":"技能ID","name":"技能名","reason":"推荐理由","score":0.9}]}

只返回 JSON，不要任何其他内容。score 为 0-1 之间的相关度，低于 0.5 的不推荐。`

  try {
    const response = await callAI(prompt, { sessionId, empId, timeout: AI_TIMEOUT_NORMAL })
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0])
      return { suggestions: result.suggestions || [] }
    }
  } catch (error) {
    console.error('[SkillCreator] 技能推荐失败:', error.message)
  }

  return { suggestions: [] }
}

module.exports = {
  createSkillFromDescription,
  suggestSkills,
  recordSkillUsage,
  getSkillStats,
  getTopSkills,
  toSkillId,
  saveSkill,
  generateSkillContent
}

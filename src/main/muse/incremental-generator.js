// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 增量脚本生成器
 * 
 * 解决问题：当任务需要生成大量数据（如 64x64 像素 × 8方向），
 * 单次 AI 调用因 token 量过大导致超时。
 * 
 * 方案：将脚本生成拆成多轮小调用：
 *   第1轮：生成框架代码 + 数据占位符
 *   第2~N轮：逐段生成数据，本地合并到框架中
 *   最终：执行完整脚本
 */

const { callAI } = require('../../shared/ai-client')
const { getMuseSessionId } = require('./context')
const { parseMuseResponse } = require('./prompt')
const { AI_TIMEOUT_NORMAL, AI_TIMEOUT_LONG } = require('./config')

const MAX_INCREMENTAL_ROUNDS = 8
const INCREMENTAL_SESSION_PREFIX = 'incr_'

/**
 * 增量生成脚本
 * @param {string} command - 任务描述
 * @param {object} strategy - 任务策略
 * @param {object} context - 上下文
 * @returns {Promise<{success: boolean, scriptContent: string, rounds: number, error?: string}>}
 */
async function generateIncrementally(command, strategy, context) {
  const language = strategy.scriptLanguage || 'python'
  console.log(`[IncrGen] 🚀 启动增量生成模式 (${language})`)

  // 第1步：让 AI 规划分段策略
  const plan = await planSegments(command, language)
  if (!plan || !plan.segments || plan.segments.length === 0) {
    return { success: false, scriptContent: null, rounds: 0, error: '增量规划失败' }
  }

  console.log(`[IncrGen] 📋 规划了 ${plan.segments.length} 个分段:`, plan.segments.map(s => s.name))

  // 第2步：生成框架代码（不含大数据）
  const framework = await generateFramework(command, language, plan)
  if (!framework) {
    return { success: false, scriptContent: null, rounds: 1, error: '框架代码生成失败' }
  }

  console.log(`[IncrGen] 🏗️ 框架代码生成完成 (${framework.length} 字符)`)

  // 第3步：逐段生成数据，合并到框架中
  let mergedScript = framework
  let completedSegments = 0

  for (let i = 0; i < plan.segments.length && i < MAX_INCREMENTAL_ROUNDS; i++) {
    const segment = plan.segments[i]
    console.log(`[IncrGen] 📦 生成分段 ${i + 1}/${plan.segments.length}: ${segment.name}`)

    const segmentCode = await generateSegment(command, language, plan, segment, i, mergedScript)
    if (!segmentCode) {
      console.warn(`[IncrGen] ⚠️ 分段 ${segment.name} 生成失败，跳过`)
      continue
    }

    // 本地合并：将分段代码插入到框架的占位符位置
    mergedScript = mergeSegment(mergedScript, segment, segmentCode)
    completedSegments++
    console.log(`[IncrGen] ✅ 分段 ${segment.name} 已合并 (累计 ${mergedScript.length} 字符)`)
  }

  if (completedSegments === 0) {
    return { success: false, scriptContent: null, rounds: 1, error: '所有分段生成均失败' }
  }

  // 清理残留的占位符
  mergedScript = cleanupPlaceholders(mergedScript)

  console.log(`[IncrGen] ✅ 增量生成完成: ${completedSegments}/${plan.segments.length} 分段, ${mergedScript.length} 字符`)

  return {
    success: true,
    scriptContent: mergedScript,
    rounds: completedSegments + 1,
    totalSegments: plan.segments.length,
    completedSegments
  }
}

/**
 * 规划分段策略：让 AI 分析任务，决定如何拆分脚本
 */
async function planSegments(command, language) {
  const prompt = `你需要帮我把一个复杂任务的脚本拆分成多段来生成，因为一次性生成会超时。

【任务描述】
${command}

【脚本语言】
${language}

请分析这个任务，规划如何将脚本拆分为"框架代码"+"多个数据/逻辑分段"。

以 JSON 格式返回：
{
  "frameworkDescription": "框架代码应该包含什么（如：主函数、渲染逻辑、文件IO，但不含具体像素数据）",
  "dataVariableName": "数据存储的变量名（如：pixel_data, sprites, directions）",
  "segments": [
    { "name": "分段名称（如：north_sprite）", "description": "这个分段包含什么数据", "placeholder": "占位符标记（如：# SEGMENT: north_sprite）" },
    ...
  ],
  "mergeStrategy": "append_to_dict|append_to_list|replace_placeholder"
}

规则：
- 每个分段应该是独立的、可单独生成的代码片段
- 分段数量控制在 2~8 个
- 每个分段的 placeholder 必须唯一，格式为 # SEGMENT: xxx
- 框架代码中用 placeholder 标记每个分段的插入位置
- 返回纯 JSON`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })
    return parseMuseResponse(response)
  } catch (err) {
    console.error('[IncrGen] 规划失败:', err.message)
    return null
  }
}

/**
 * 生成框架代码（包含占位符，不含大数据）
 */
async function generateFramework(command, language, plan) {
  const segmentPlaceholders = plan.segments
    .map(s => `${s.placeholder}  # 将在后续步骤中填充`)
    .join('\n    ')

  const prompt = `你正在分段生成一个 ${language} 脚本。现在请生成**框架代码**。

【任务描述】
${command}

【框架要求】
${plan.frameworkDescription}

【数据变量】
使用变量名: ${plan.dataVariableName}

【占位符位置】
在代码中用以下注释标记数据插入点，每个占位符独占一行：
${plan.segments.map(s => `${s.placeholder}  → ${s.description}`).join('\n')}

重要：
1. 框架代码必须完整可运行（占位符处用空数据或示例数据代替）
2. 每个占位符注释必须独占一行，格式严格为: ${plan.segments[0]?.placeholder || '# SEGMENT: xxx'}
3. 包含所有导入、函数定义、主逻辑、文件输出
4. 不要在框架中生成实际的大量数据，用占位符代替
5. 代码要精简高效
6. 如果是 bash 脚本且需要写入多行文本内容（如 Markdown、HTML），必须使用 heredoc 语法（cat << 'EOF' > file.md ... EOF），绝不能让文本内容裸露在脚本中作为命令执行

只返回代码块。`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_LONG
    })
    return extractCodeBlock(response, language)
  } catch (err) {
    console.error('[IncrGen] 框架生成失败:', err.message)
    return null
  }
}

/**
 * 生成单个数据分段
 */
async function generateSegment(command, language, plan, segment, segmentIndex, currentScript) {
  // 提取框架中占位符附近的上下文，帮助 AI 理解数据格式
  const contextLines = extractPlaceholderContext(currentScript, segment.placeholder)

  const prompt = `你正在分段生成一个 ${language} 脚本。现在请生成第 ${segmentIndex + 1} 个数据分段。

【总任务】
${command}

【当前分段】
名称: ${segment.name}
描述: ${segment.description}

【数据变量名】
${plan.dataVariableName}

【插入位置的上下文代码】
\`\`\`${language}
${contextLines}
\`\`\`

【合并策略】
${plan.mergeStrategy}

重要：
1. 只返回这个分段的数据代码，不要返回完整脚本
2. 代码片段将直接替换占位符 "${segment.placeholder}"
3. 确保数据格式与框架代码兼容
4. 不要包含导入语句或函数定义，只包含数据赋值/追加代码
5. 如果是 bash 脚本且分段内容是文本数据（如 Markdown），必须用 heredoc（cat << 'EOF' >> file ... EOF）或 echo 写入，绝不能让文本裸露在脚本中

只返回代码块。`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_LONG
    })
    return extractCodeBlock(response, language)
  } catch (err) {
    console.error(`[IncrGen] 分段 ${segment.name} 生成失败:`, err.message)
    return null
  }
}

/**
 * 将分段代码合并到框架中（替换占位符）
 */
function mergeSegment(script, segment, segmentCode) {
  const placeholder = segment.placeholder
  if (!script.includes(placeholder)) {
    // 占位符不存在，追加到脚本末尾（数据初始化区域之前）
    console.warn(`[IncrGen] ⚠️ 占位符 "${placeholder}" 未找到，追加到脚本中`)
    return script + '\n' + segmentCode + '\n'
  }

  // 替换占位符行为实际代码
  const lines = script.split('\n')
  const resultLines = []
  for (const line of lines) {
    if (line.trim().startsWith(placeholder.trim())) {
      // 用分段代码替换占位符行
      resultLines.push(segmentCode)
    } else {
      resultLines.push(line)
    }
  }
  return resultLines.join('\n')
}

/**
 * 清理残留的未填充占位符
 */
function cleanupPlaceholders(script) {
  const lines = script.split('\n')
  return lines
    .filter(line => !line.trim().startsWith('# SEGMENT:'))
    .join('\n')
}

/**
 * 提取占位符附近的上下文代码（前后各10行）
 */
function extractPlaceholderContext(script, placeholder) {
  const lines = script.split('\n')
  const placeholderIndex = lines.findIndex(line => line.trim().startsWith(placeholder.trim()))

  if (placeholderIndex === -1) {
    return '# 占位符未找到，请根据任务描述生成数据'
  }

  const contextRadius = 10
  const startIndex = Math.max(0, placeholderIndex - contextRadius)
  const endIndex = Math.min(lines.length - 1, placeholderIndex + contextRadius)

  return lines.slice(startIndex, endIndex + 1).join('\n')
}

/**
 * 从 AI 响应中提取代码块
 */
function extractCodeBlock(response, language) {
  if (!response) return null

  const patterns = [
    new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'i'),
    new RegExp(`\`\`\`\\w*\\n([\\s\\S]*?)\`\`\``, 'i'),
    /```([\s\S]*?)```/i
  ]

  for (const pattern of patterns) {
    const match = response.match(pattern)
    if (match && match[1]) {
      return match[1].trim()
    }
  }

  return null
}

module.exports = {
  generateIncrementally
}

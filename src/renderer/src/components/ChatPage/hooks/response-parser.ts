// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

/**
 * AI 响应解析器
 * 从 AI 返回的文本中检测并提取命令选项等结构化数据
 */

/**
 * 修复 AI 输出的非标准 JSON 并解析。
 * AI 生成的 JSON 字段值中经常包含未转义的换行/制表符，导致 JSON.parse 失败。
 * 采用三层降级策略：直接解析 → 修复后重试 → 正则逐字段提取。
 */
function repairAndParseJSON(raw: string): Record<string, any> {
  // 第一层：直接解析
  try { return JSON.parse(raw) } catch { /* 继续修复 */ }

  // 第二层：逐个字符扫描，修复字符串值内部的裸换行/制表符
  let repaired = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) {
      repaired += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      repaired += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      repaired += ch
      continue
    }
    if (inString) {
      if (ch === '\n') { repaired += '\\n'; continue }
      if (ch === '\r') { repaired += '\\r'; continue }
      if (ch === '\t') { repaired += '\\t'; continue }
    }
    repaired += ch
  }

  try { return JSON.parse(repaired) } catch { /* 继续 */ }

  throw new Error('JSON 修复失败')
}

/**
 * 从 AI 响应中提取指令 JSON，支持裸 JSON 和代码块两种格式，
 * 内置 repairAndParseJSON 容错。
 */
function extractDirectiveJSON(response: string, directive: string): Record<string, any> | null {
  // 优先匹配贪婪模式（大 JSON）
  const rawMatch = response.match(new RegExp(`${directive}:\\s*\\n?\\s*(\\{[\\s\\S]*\\})`, 'i'))
  if (rawMatch) {
    try { return repairAndParseJSON(rawMatch[1]) } catch { /* 继续 */ }
  }

  // 代码块格式
  const codeBlockMatch = response.match(new RegExp(`${directive}:[\\s\\S]*?\`\`\`(?:json)?\\s*\\n?([\\s\\S]*?)\`\`\``, 'i'))
  if (codeBlockMatch) {
    try { return repairAndParseJSON(codeBlockMatch[1].trim()) } catch { /* 忽略 */ }
  }

  return null
}

/** 解析 RICH_FORM 指令 */
export function parseRichForm(response: string): import('../types').RichFormData | null {
  const data = extractDirectiveJSON(response, 'RICH_FORM')
  if (!data || !data.title || !Array.isArray(data.fields)) return null
  return data as import('../types').RichFormData
}

const VALID_ARTIFACT_TYPES = ['html', 'svg', 'image', 'code', 'chart', 'form', 'markdown']

/**
 * 解析 ARTIFACT 指令 — 统一产物协议。
 * AI 输出形如 `ARTIFACT: { "type": "html", "content": "<div>...</div>" }`。
 * 校验 type 合法 + 至少有一种内容载体（content / src / data）。
 */
export function parseArtifact(response: string): import('../types').Artifact | null {
  const data = extractDirectiveJSON(response, 'ARTIFACT')
  if (!data || !data.type || !VALID_ARTIFACT_TYPES.includes(data.type)) return null

  const hasPayload = typeof data.content === 'string' || typeof data.src === 'string' || data.data != null
  if (!hasPayload) return null

  return {
    id: data.id || `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...data,
  } as import('../types').Artifact
}

/** 解析 COMMAND_OPTIONS 指令 */
export function parseCommandOptions(response: string): Array<{ label: string; cmd: string }> | null {
  const optionsMatch = response.match(/COMMAND_OPTIONS:\s*\n?\s*(\[[\s\S]*\])/i)
  if (!optionsMatch) return null

  try {
    const cmdOptions = JSON.parse(optionsMatch[1])
    if (Array.isArray(cmdOptions) && cmdOptions.length > 0) {
      return cmdOptions
    }
  } catch (e) {
    console.error('解析命令选项失败:', e)
  }

  return null
}

'use strict'

/**
 * 技能 Schema 引擎
 *
 * 负责：
 * 1. 解析 SKILL.md 的 YAML frontmatter（支持嵌套对象/数组）
 * 2. Schema 验证（inputs 类型检查、必填校验）
 * 3. 参数校验 + 缺参自动追问
 * 4. triggers 关键词匹配
 * 5. onError 策略解析
 */

// ========== YAML Frontmatter 解析器（支持嵌套） ==========

/**
 * 解析 SKILL.md 的 YAML frontmatter
 * 支持：标量值、数组（- item 或 [a, b, c]）、嵌套对象
 *
 * @param {string} fileContent - SKILL.md 完整内容
 * @returns {{ meta: object, content: string }} meta=frontmatter 解析结果, content=正文
 */
function parseFrontmatter(fileContent) {
  if (!fileContent || !fileContent.startsWith('---')) {
    return { meta: {}, content: fileContent || '' }
  }

  const secondDashIndex = fileContent.indexOf('---', 3)
  if (secondDashIndex === -1) {
    return { meta: {}, content: fileContent }
  }

  const yamlBlock = fileContent.substring(3, secondDashIndex).trim()
  const content = fileContent.substring(secondDashIndex + 3).trim()

  const meta = parseYamlBlock(yamlBlock)
  return { meta, content }
}

/**
 * 轻量 YAML 解析器 — 支持嵌套对象、数组、标量
 * 不依赖 js-yaml 库，覆盖技能 Schema 所需的 YAML 子集
 */
function parseYamlBlock(yamlText) {
  const lines = yamlText.split('\n')
  return parseYamlLines(lines, 0, 0).value
}

/**
 * 递归解析 YAML 行
 * @returns {{ value: object, consumed: number }}
 */
function parseYamlLines(lines, startIndex, baseIndent) {
  const result = {}
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trimEnd()

    // 跳过空行和注释
    if (!trimmed || trimmed.trim().startsWith('#')) {
      index++
      continue
    }

    // 计算缩进
    const indent = line.length - line.trimStart().length

    // 缩进小于基准 → 退出当前层级
    if (indent < baseIndent && index > startIndex) {
      break
    }

    const stripped = trimmed.trim()

    // 数组项（- value）在对象上下文中不应出现在顶层
    if (stripped.startsWith('- ') && indent === baseIndent) {
      // 这是一个裸数组，不应该在对象上下文中
      break
    }

    // key: value 对
    const colonIndex = stripped.indexOf(':')
    if (colonIndex === -1) {
      index++
      continue
    }

    const key = stripped.substring(0, colonIndex).trim()
    const rawValue = stripped.substring(colonIndex + 1).trim()

    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      // 值在下一行（嵌套对象、数组、或多行文本）
      index++

      if (index >= lines.length) {
        result[key] = ''
        break
      }

      // 查看下一行的缩进来判断类型
      const nextLine = lines[index]
      const nextTrimmed = nextLine.trim()
      const nextIndent = nextLine.length - nextLine.trimStart().length

      if (nextIndent <= indent && nextTrimmed) {
        // 下一行缩进不够 → 空值
        result[key] = ''
        continue
      }

      if (nextTrimmed.startsWith('- ')) {
        // 数组
        const arrayResult = parseYamlArray(lines, index, nextIndent)
        result[key] = arrayResult.value
        index = arrayResult.nextIndex
      } else if (nextTrimmed.includes(':')) {
        // 嵌套对象
        const objResult = parseYamlLines(lines, index, nextIndent)
        result[key] = objResult.value
        index = index + objResult.consumed
      } else if (rawValue === '|' || rawValue === '>') {
        // 多行文本
        const textResult = parseMultilineText(lines, index, nextIndent)
        result[key] = textResult.value
        index = textResult.nextIndex
      } else {
        result[key] = nextTrimmed
        index++
      }
    } else {
      // 行内值
      result[key] = parseInlineValue(rawValue)
      index++
    }
  }

  return { value: result, consumed: index - startIndex }
}

/**
 * 解析 YAML 数组（- item 格式）
 */
function parseYamlArray(lines, startIndex, baseIndent) {
  const result = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      index++
      continue
    }

    const indent = line.length - line.trimStart().length

    if (indent < baseIndent) break

    if (!trimmed.startsWith('- ')) {
      // 不是数组项 → 可能是嵌套对象的一部分
      if (indent > baseIndent) {
        index++
        continue
      }
      break
    }

    const itemValue = trimmed.substring(2).trim()

    // 检查是否是嵌套对象（- key: value 格式）
    if (itemValue.includes(':') && !itemValue.startsWith('"') && !itemValue.startsWith("'")) {
      // 可能是对象数组项
      const colonIdx = itemValue.indexOf(':')
      const firstKey = itemValue.substring(0, colonIdx).trim()
      const firstVal = itemValue.substring(colonIdx + 1).trim()

      // 检查后续行是否有同缩进的 key: value（属于同一个对象）
      const itemObj = {}
      itemObj[firstKey] = parseInlineValue(firstVal)
      index++

      // 收集同一对象的后续属性
      const itemIndent = baseIndent + 2
      while (index < lines.length) {
        const nextLine = lines[index]
        const nextTrimmed = nextLine.trim()
        const nextIndent = nextLine.length - nextLine.trimStart().length

        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          index++
          continue
        }

        if (nextIndent < itemIndent || nextTrimmed.startsWith('- ')) break

        if (nextTrimmed.includes(':')) {
          const ci = nextTrimmed.indexOf(':')
          const k = nextTrimmed.substring(0, ci).trim()
          const v = nextTrimmed.substring(ci + 1).trim()

          if (v === '' || v === '|' || v === '>') {
            // 嵌套值
            index++
            if (index < lines.length) {
              const deepLine = lines[index]
              const deepIndent = deepLine.length - deepLine.trimStart().length
              const deepTrimmed = deepLine.trim()

              if (deepTrimmed.startsWith('- ')) {
                const arrResult = parseYamlArray(lines, index, deepIndent)
                itemObj[k] = arrResult.value
                index = arrResult.nextIndex
              } else {
                const objResult = parseYamlLines(lines, index, deepIndent)
                itemObj[k] = objResult.value
                index = index + objResult.consumed
              }
            } else {
              itemObj[k] = ''
            }
          } else {
            itemObj[k] = parseInlineValue(v)
            index++
          }
        } else {
          index++
        }
      }

      result.push(itemObj)
    } else {
      // 简单数组项
      result.push(parseInlineValue(itemValue))
      index++
    }
  }

  return { value: result, nextIndex: index }
}

/**
 * 解析多行文本（| 或 > 后的缩进块）
 */
function parseMultilineText(lines, startIndex, baseIndent) {
  const textLines = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    const indent = line.length - line.trimStart().length

    if (line.trim() === '') {
      textLines.push('')
      index++
      continue
    }

    if (indent < baseIndent) break

    textLines.push(line.substring(baseIndent))
    index++
  }

  return { value: textLines.join('\n').trim(), nextIndex: index }
}

/**
 * 解析行内值：布尔、数字、引号字符串、行内数组 [a, b]、行内对象 {a: b}
 */
function parseInlineValue(raw) {
  if (!raw && raw !== 0) return ''

  const trimmed = typeof raw === 'string' ? raw.trim() : String(raw)

  // 布尔
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // null
  if (trimmed === 'null' || trimmed === '~') return null

  // 引号字符串
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  // 行内数组 [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(item => parseInlineValue(item.trim()))
  }

  // 行内对象 {a: b, c: d}（简单支持）
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return {}
    const obj = {}
    // 简单分割，不处理嵌套
    const pairs = inner.split(',')
    for (const pair of pairs) {
      const ci = pair.indexOf(':')
      if (ci !== -1) {
        const k = pair.substring(0, ci).trim().replace(/^["']|["']$/g, '')
        const v = pair.substring(ci + 1).trim()
        obj[k] = parseInlineValue(v)
      }
    }
    return obj
  }

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  return trimmed
}

// ========== Schema 验证 ==========

/**
 * 验证技能 Schema 的完整性
 * @param {object} meta - frontmatter 解析结果
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchema(meta) {
  const errors = []

  if (!meta.name) {
    errors.push('缺少必填字段: name')
  }

  // 验证 triggers
  if (meta.triggers && !Array.isArray(meta.triggers)) {
    errors.push('triggers 必须是数组')
  }

  // 验证 inputs
  if (meta.inputs && typeof meta.inputs === 'object') {
    for (const [paramName, paramDef] of Object.entries(meta.inputs)) {
      if (typeof paramDef !== 'object') {
        errors.push(`inputs.${paramName} 必须是对象`)
        continue
      }
      if (!paramDef.type) {
        errors.push(`inputs.${paramName} 缺少 type 字段`)
      }
      if (paramDef.type === 'enum' && !paramDef.values) {
        errors.push(`inputs.${paramName} 类型为 enum 但缺少 values`)
      }
    }
  }

  // 验证 sideEffects
  if (meta.sideEffects && !Array.isArray(meta.sideEffects)) {
    errors.push('sideEffects 必须是数组')
  }

  // 验证 onError
  if (meta.onError) {
    const validStrategies = ['retry', 'abort', 'fallback', 'ask']
    const strategy = typeof meta.onError === 'string' ? meta.onError.split(':')[0] : null
    if (strategy && !validStrategies.includes(strategy)) {
      errors.push(`onError 策略无效: ${meta.onError}，可选: ${validStrategies.join('/')}`)
    }
  }

  // 验证 requires（运行环境依赖：工具列表）
  if (meta.requires && !Array.isArray(meta.requires)) {
    errors.push('requires 必须是数组，如: [python, ffmpeg]')
  }

  // 验证 pythonPackages（Python 包依赖列表）
  if (meta.pythonPackages && !Array.isArray(meta.pythonPackages)) {
    errors.push('pythonPackages 必须是数组，如: [pillow, requests]')
  }

  // 验证 depends（依赖技能列表）
  if (meta.depends && !Array.isArray(meta.depends)) {
    errors.push('depends 必须是数组，如: [crm-auth-login, another-skill]')
  }

  // 验证 pipeline（工作流阶段定义）
  if (meta.pipeline) {
    const { validatePipeline } = require('./skill-pipeline')
    const pipelineErrors = validatePipeline(meta.pipeline)
    errors.push(...pipelineErrors)
  }

  // 验证 contextTemplates（关联的场景模板）
  if (meta.contextTemplates) {
    if (!Array.isArray(meta.contextTemplates)) {
      errors.push('contextTemplates 必须是数组，如: [frontend-design, code-quality]')
    }
  }

  // 验证 enabled（生命周期状态）
  if (meta.enabled !== undefined && typeof meta.enabled !== 'boolean') {
    errors.push('enabled 必须是布尔值')
  }

  // 验证 priority（触发优先级）
  if (meta.priority !== undefined) {
    if (typeof meta.priority !== 'number' || meta.priority < 0 || meta.priority > 100) {
      errors.push('priority 必须是 0-100 之间的数字')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ========== 参数校验 + 自动追问 ==========

/**
 * 从用户输入中提取参数值
 * @param {string} userInput - 用户输入
 * @param {object} inputs - Schema 定义的 inputs
 * @returns {{ resolved: object, missing: Array<{name: string, def: object}> }}
 */
function resolveInputs(userInput, inputs) {
  if (!inputs || typeof inputs !== 'object') {
    return { resolved: {}, missing: [] }
  }

  const resolved = {}
  const missing = []

  for (const [paramName, paramDef] of Object.entries(inputs)) {
    const value = extractParamFromInput(userInput, paramName, paramDef)

    if (value !== undefined) {
      resolved[paramName] = value
    } else if (paramDef.default !== undefined) {
      resolved[paramName] = paramDef.default
    } else if (paramDef.required !== false && paramDef.askIfMissing !== false) {
      missing.push({ name: paramName, def: paramDef })
    }
  }

  return { resolved, missing }
}

/**
 * 从用户输入中提取单个参数
 */
function extractParamFromInput(userInput, paramName, paramDef) {
  const input = userInput.toLowerCase()

  // enum 类型：检查用户输入是否包含枚举值
  if (paramDef.type === 'enum' && Array.isArray(paramDef.values)) {
    for (const enumValue of paramDef.values) {
      if (input.includes(enumValue.toLowerCase())) {
        return enumValue
      }
    }
    return undefined
  }

  // boolean 类型
  if (paramDef.type === 'boolean') {
    const truePatterns = ['是', 'yes', 'true', '开启', '启用', '需要']
    const falsePatterns = ['否', 'no', 'false', '关闭', '禁用', '不需要']

    for (const pattern of truePatterns) {
      if (input.includes(`${paramName}${pattern}`) || input.includes(`${pattern}${paramName}`)) {
        return true
      }
    }
    for (const pattern of falsePatterns) {
      if (input.includes(`${paramName}${pattern}`) || input.includes(`${pattern}${paramName}`)) {
        return false
      }
    }
    return undefined
  }

  // image/file 类型特殊处理：从 [用户贴图路径] 标记中提取临时文件路径
  // 格式：[用户贴图路径]: /tmp/skill_img_xxx.jpg
  if (paramDef.type === 'string' && (
    paramName.includes('image') || paramName.includes('img') ||
    paramName.includes('photo') || paramName.includes('file') ||
    paramName.includes('path')
  )) {
    const pastedMatch = userInput.match(/\[用户贴图路径\]:\s*([^\n,]+)/)
    if (pastedMatch) {
      return pastedMatch[1].trim().split(',')[0].trim()
    }
  }

  // string/number 类型：尝试用参数名作为关键词提取
  // 例如 "branch master" 或 "branch=master" 或 "branch: master"
  const patterns = [
    new RegExp(`${paramName}[=:\\s]+([^\\s,]+)`, 'i'),
    new RegExp(`--${paramName}[=\\s]+([^\\s,]+)`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = userInput.match(pattern)
    if (match) {
      const extracted = match[1].trim()
      if (paramDef.type === 'number') {
        const num = Number(extracted)
        return isNaN(num) ? undefined : num
      }
      return extracted
    }
  }

  return undefined
}

/**
 * 生成缺参追问消息
 * @param {Array<{name: string, def: object}>} missingParams
 * @returns {string}
 */
function buildAskMessage(missingParams) {
  if (!missingParams.length) return ''

  const lines = ['🤔 执行这个技能还需要以下信息：\n']

  for (const { name, def } of missingParams) {
    const desc = def.description || name
    let hint = ''

    if (def.type === 'enum' && def.values) {
      hint = `（可选值：${def.values.join(' / ')}）`
    } else if (def.type === 'number' && def.min !== undefined) {
      hint = `（范围：${def.min} ~ ${def.max || '∞'}）`
    } else if (def.type === 'string' && def.example) {
      hint = `（示例：${def.example}）`
    }

    lines.push(`- **${desc}** ${hint}`)
  }

  lines.push('\n请提供以上参数，或直接说"使用默认值"。')
  return lines.join('\n')
}

// ========== Triggers 匹配 ==========

/**
 * 检查用户输入是否匹配某个技能的 triggers
 * @param {string} userInput
 * @param {object} skill - 包含 triggers 数组的技能对象
 * @returns {{ matched: boolean, trigger: string|null, score: number }}
 */
function matchTriggers(userInput, skill) {
  if (!skill.triggers || !Array.isArray(skill.triggers) || skill.triggers.length === 0) {
    return { matched: false, trigger: null, score: 0 }
  }

  const input = userInput.toLowerCase().trim()
  let bestMatch = { matched: false, trigger: null, score: 0 }

  for (const trigger of skill.triggers) {
    const triggerLower = trigger.toLowerCase().trim()

    // 精确包含
    if (input.includes(triggerLower)) {
      const score = triggerLower.length / input.length // 越长的匹配越精确
      if (score > bestMatch.score) {
        bestMatch = { matched: true, trigger, score }
      }
    }

    // 分词模糊匹配：trigger 的所有词都出现在 input 中
    const triggerWords = triggerLower.split(/\s+/)
    if (triggerWords.length > 1) {
      const allWordsMatch = triggerWords.every(word => input.includes(word))
      if (allWordsMatch) {
        const score = (triggerWords.join('').length / input.length) * 0.8 // 模糊匹配打折
        if (score > bestMatch.score) {
          bestMatch = { matched: true, trigger, score }
        }
      }
    }
  }

  return bestMatch
}

/**
 * 从所有技能中找到最佳匹配的技能
 * 跳过禁用技能（enabled === false）
 * 优先级越高得分加权越大
 * @param {string} userInput
 * @param {Array} skills - 所有技能列表
 * @returns {{ skill: object|null, trigger: string|null, score: number }}
 */
function findBestTriggerMatch(userInput, skills) {
  let bestResult = { skill: null, trigger: null, score: 0 }

  for (const skill of skills) {
    // 跳过禁用技能
    if (skill.enabled === false) continue

    const match = matchTriggers(userInput, skill)
    if (match.matched) {
      // 优先级加权：priority 越高，最终得分越高
      const priorityBoost = (skill.priority || 0) / 1000  // 0-0.1 的加权
      const adjustedScore = match.score + priorityBoost
      if (adjustedScore > bestResult.score) {
        bestResult = { skill, trigger: match.trigger, score: adjustedScore }
      }
    }
  }

  // 阈值：score > 0.15 才认为是有效匹配
  if (bestResult.score < 0.15) {
    return { skill: null, trigger: null, score: 0 }
  }

  return bestResult
}

// ========== onError 策略解析 ==========

/**
 * 解析 onError 策略
 * 支持格式：'retry', 'retry:3', 'abort', 'fallback', 'ask'
 * @param {string} onError
 * @returns {{ strategy: string, maxRetries: number }}
 */
function parseOnErrorStrategy(onError) {
  if (!onError) return { strategy: 'ask', maxRetries: 2 }

  const parts = onError.split(':')
  const strategy = parts[0]
  const maxRetries = parts[1] ? parseInt(parts[1], 10) : 2

  return { strategy, maxRetries: isNaN(maxRetries) ? 2 : maxRetries }
}

// ========== 生成技能摘要（用于 prompt 注入） ==========

/**
 * 生成技能的 Schema 摘要，用于注入 AI prompt
 * @param {object} skill - 技能对象（含 Schema 字段）
 * @returns {string}
 */
function buildSchemaDigest(skill) {
  const parts = []

  if (skill.version) {
    parts.push(`版本: ${skill.version}`)
  }

  if (skill.triggers && skill.triggers.length > 0) {
    parts.push(`触发词: ${skill.triggers.join(', ')}`)
  }

  if (skill.inputs && Object.keys(skill.inputs).length > 0) {
    const inputLines = []
    for (const [name, def] of Object.entries(skill.inputs)) {
      let line = `  - ${name} (${def.type || 'string'})`
      if (def.description) line += `: ${def.description}`
      if (def.default !== undefined) line += ` [默认: ${def.default}]`
      if (def.required === false) line += ' [可选]'
      if (def.type === 'enum' && def.values) line += ` 可选值: ${def.values.join('/')}`
      inputLines.push(line)
    }
    parts.push(`输入参数:\n${inputLines.join('\n')}`)
  }

  if (skill.sideEffects && skill.sideEffects.length > 0) {
    parts.push(`副作用: ${skill.sideEffects.join(', ')}`)
  }

  if (skill.requires && skill.requires.length > 0) {
    parts.push(`运行依赖工具: ${skill.requires.join(', ')}`)
  }

  if (skill.pythonPackages && skill.pythonPackages.length > 0) {
    parts.push(`Python 包依赖: ${skill.pythonPackages.join(', ')}`)
  }

  if (skill.dangerous) {
    parts.push(`⚠️ 危险操作: 是`)
  }

  if (skill.rollback) {
    parts.push(`回滚命令: ${skill.rollback}`)
  }

  if (skill.onError) {
    parts.push(`错误策略: ${skill.onError}`)
  }

  // Pipeline 摘要
  if (skill.pipeline) {
    const { buildPipelineDigest } = require('./skill-pipeline')
    const pipelineDigest = buildPipelineDigest(skill.pipeline)
    if (pipelineDigest) {
      parts.push(pipelineDigest)
    }
  }

  // 关联场景模板
  if (skill.contextTemplates && skill.contextTemplates.length > 0) {
    parts.push(`关联模板: ${skill.contextTemplates.join(', ')}`)
  }

  // 优先级
  if (skill.priority !== undefined && skill.priority !== 0) {
    parts.push(`优先级: ${skill.priority}`)
  }

  return parts.length > 0 ? parts.join('\n') : ''
}

module.exports = {
  parseFrontmatter,
  parseYamlBlock,
  validateSchema,
  resolveInputs,
  buildAskMessage,
  matchTriggers,
  findBestTriggerMatch,
  parseOnErrorStrategy,
  buildSchemaDigest
}

'use strict'

/**
 * YAML Frontmatter 通用解析器
 *
 * 负责解析 Markdown 文件头部的 YAML frontmatter（--- 包裹的元数据块），
 * 支持：标量值、数组（- item 或 [a, b, c]）、嵌套对象、多行文本。
 * 不依赖 js-yaml 库，覆盖所需的 YAML 子集。
 */

/**
 * 解析 Markdown 文件的 YAML frontmatter
 * @param {string} fileContent - 文件完整内容
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

module.exports = {
  parseFrontmatter,
  parseYamlBlock,
  parseOnErrorStrategy
}

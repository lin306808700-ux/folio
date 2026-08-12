'use strict'

const path = require('path')
const fs = require('fs')
const { callAI } = require('../shared/ai-client')
const semanticCache = require('./semantic-cache')
const tokenMonitor = require('./token-monitor')

// scriptsDir 固定为项目根目录下的 scripts 文件夹
const scriptsDir = path.join(__dirname, '..', '..', 'scripts')

// 上一次生成的脚本指纹 → 文件路径，用于脚本内容未变时复用已有文件
let _lastScriptHash = ''
let _lastScriptPath = ''

/**
 * 从文本中提取第一个完整的 JSON 对象（花括号计数法）。
 *
 * 解决 AI 在一次响应中返回多个 SCRIPT_BLOCK 时，贪婪正则
 * 把所有内容（含中间的普通文本）匹配为一个巨大"JSON"的问题。
 *
 * @param {string} text - 从 SCRIPT_BLOCK: 开始的文本
 * @returns {string} 第一个完整 JSON 对象的字符串
 */
function extractFirstJsonObject(text) {
  // 找到第一个 { 的位置
  const startIndex = text.indexOf('{')
  if (startIndex === -1) throw new Error('未找到 JSON 对象起始 {')

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(startIndex, i + 1)
      }
    }
  }

  // 花括号未闭合，返回从 { 到末尾的内容（交给 repairAndParseJSON 兜底）
  console.warn('[AI][extractFirstJsonObject] 花括号未闭合，返回截断内容')
  return text.slice(startIndex)
}

/**
 * 修复 AI 输出的非标准 JSON 并解析。
 *
 * 设计哲学：Fail-closed（默认假设 JSON 是坏的）
 * AI 生成的 SCRIPT_BLOCK JSON 几乎总是有问题（裸换行、嵌套引号、转义不一致），
 * 所以结构化提取是主路径，直接 JSON.parse 只是快速路径的优化。
 *
 * 解析策略（按优先级）：
 * 1. 快速路径：直接 JSON.parse（AI 偶尔生成合法 JSON 时命中）
 * 2. 主路径：结构化字段提取（利用已知字段名定位，最健壮）
 * 3. 所有路径失败 → 抛出错误
 */
function repairAndParseJSON(raw) {
  // 快速路径：直接解析（AI 偶尔生成合法 JSON 时命中）
  try {
    const parsed = JSON.parse(raw)
    if (validateParsedJSON(parsed)) {
      return parsed
    }
  } catch (_) { /* 预期内的失败，进入修复路径 */ }

  // 判断是 SCRIPT_BLOCK 还是 SEARCH_REPLACE
  const isScriptBlock = /"lang"\s*:/.test(raw) && /"content"\s*:/.test(raw)
  const isSearchReplace = /"file"\s*:/.test(raw) && /"changes"\s*:/.test(raw)

  if (isScriptBlock) {
    // SCRIPT_BLOCK 主路径：结构化字段提取（Fail-closed 设计）
    try {
      const result = extractFieldsFromMalformedJSON(raw)
      if (result && validateParsedJSON(result)) {
        console.log('[AI][repairAndParseJSON] SCRIPT_BLOCK 结构化提取成功')
        return result
      }
    } catch (extractError) {
      console.warn('[AI][repairAndParseJSON] 结构化提取异常:', extractError.message)
    }
  }

  // SEARCH_REPLACE / SCRIPT_BLOCK 兜底：逐字符扫描修复裸换行
  // 适用于字段值包含裸换行但不含嵌套引号的场景
  try {
    const repaired = repairRawNewlines(raw)
    const parsed = JSON.parse(repaired)
    if (validateParsedJSON(parsed)) {
      console.log('[AI][repairAndParseJSON] 逐字符扫描修复成功')
      return parsed
    }
  } catch (_) { /* 继续 */ }

  // SEARCH_REPLACE 专用修复路径：处理 search/replace 值中的未转义双引号
  if (isSearchReplace) {
    try {
      const result = extractSearchReplaceFields(raw)
      if (result && validateParsedJSON(result)) {
        console.log('[AI][repairAndParseJSON] SEARCH_REPLACE 结构化提取成功')
        return result
      }
    } catch (extractError) {
      console.warn('[AI][repairAndParseJSON] SEARCH_REPLACE 结构化提取异常:', extractError.message)
    }
  }

  throw new Error('JSON 修复失败，无法解析')
}

/**
 * 逐字符扫描修复 JSON 字符串值内部的裸换行/回车/制表符。
 * 适用于 SEARCH_REPLACE 等场景，其中字段值包含裸换行但不含嵌套引号。
 */
function repairRawNewlines(raw) {
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
  return repaired
}

/**
 * 验证解析结果的完整性（Fail-closed）。
 * 自动识别 SCRIPT_BLOCK 和 SEARCH_REPLACE 两种格式，缺少必要字段时返回 false。
 */
function validateParsedJSON(parsed) {
  if (!parsed || typeof parsed !== 'object') return false

  // SEARCH_REPLACE 格式：必须有 file 和 changes
  if (parsed.file !== undefined || parsed.changes !== undefined) {
    return typeof parsed.file === 'string' && Array.isArray(parsed.changes)
  }

  // SCRIPT_BLOCK 格式：必须有 lang 和 content
  if (parsed.lang !== undefined || parsed.content !== undefined) {
    return typeof parsed.lang === 'string' && parsed.lang.trim() !== '' &&
           typeof parsed.content === 'string'
  }

  // 未知格式：允许通过（可能是其他类型的 JSON）
  return true
}

/**
 * 从格式错误的 JSON 中按字段名提取值（主路径）。
 *
 * 为什么这是主路径而非兜底？
 * AI 生成的 content 字段经常包含：
 * - 裸换行符（heredoc、多行代码）
 * - 未转义的双引号（node -e "..."、shell 引号嵌套）
 * - 转义不一致（\n 有时是两个字符，有时是真换行）
 * 这些都会导致标准 JSON.parse 和逐字符扫描失败。
 *
 * 策略：利用已知字段名（lang, description, content）的位置关系来切分，
 * 从末尾 "} 反向定位 content 值的边界，然后对 content 内部进行安全转义。
 */
function extractFieldsFromMalformedJSON(raw) {
  // 提取 lang 和 description（这两个字段值通常很短且不含特殊字符）
  const langMatch = raw.match(/"lang"\s*:\s*"([^"]*)"/)
  const descMatch = raw.match(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/)

  if (!langMatch) return null

  // description 可选（某些 AI 输出可能省略）
  const description = descMatch ? descMatch[1] : ''

  // 定位 content 值的起始位置
  const contentKeyMatch = raw.match(/"content"\s*:\s*"/)
  if (!contentKeyMatch) return null

  const contentValueStart = raw.indexOf(contentKeyMatch[0]) + contentKeyMatch[0].length

  // 从末尾反向查找 content 值的结束位置（最后一个 "} 模式）
  const contentValueEnd = findContentEndFromTail(raw, contentValueStart)
  if (contentValueEnd <= contentValueStart) return null

  const contentRaw = raw.substring(contentValueStart, contentValueEnd)

  // 对 content 值进行 JSON 安全转义
  const contentEscaped = escapeContentForJSON(contentRaw)

  // 重新构建合法 JSON 并解析
  const safeDescription = description.replace(/"/g, '\\"')
  const fixedJSON = `{"lang":"${langMatch[1]}","description":"${safeDescription}","content":"${contentEscaped}"}`

  return JSON.parse(fixedJSON)
}

/**
 * 从 JSON 文本末尾反向查找 content 值的结束引号位置。
 * 查找模式：最后一个 "} 中的 " 就是 content 值的结束引号。
 */
function findContentEndFromTail(raw, contentValueStart) {
  for (let i = raw.length - 1; i > contentValueStart; i--) {
    if (raw[i] === '}') {
      // 往前跳过空白找到 "
      let j = i - 1
      while (j > contentValueStart && /\s/.test(raw[j])) j--
      if (raw[j] === '"') {
        return j
      }
    }
  }
  return -1
}

/**
 * 将 content 原始文本转义为 JSON 安全的字符串值。
 *
 * 关键设计决策：
 * - AI 原始文本中的 \n 是两个字符（反斜杠+n），代表代码中的字面量 \n
 * - 但在 JSON 字符串中 \n 会被 JSON.parse 解析为真正的换行符
 * - 所以必须把 \ 双重转义为 \\，让 JSON.parse 后得到代码中的字面量 \n
 * - 裸换行符（真正的换行）则转义为 \n，JSON.parse 后变成真正的换行——这是正确的
 */
function escapeContentForJSON(contentRaw) {
  let escaped = ''
  for (let i = 0; i < contentRaw.length; i++) {
    const ch = contentRaw[i]
    if (ch === '\\' && i + 1 < contentRaw.length) {
      // 反斜杠双重转义：\ → \\
      // 例如代码中的 \n（两个字符）→ JSON 中 \\n → parse 后 \n（两个字符）
      escaped += '\\\\' + contentRaw[i + 1]
      i++
      continue
    }
    if (ch === '\n') { escaped += '\\n'; continue }
    if (ch === '\r') { escaped += '\\r'; continue }
    if (ch === '\t') { escaped += '\\t'; continue }
    if (ch === '"') { escaped += '\\"'; continue }
    escaped += ch
  }
  return escaped
}

/**
 * 从格式错误的 SEARCH_REPLACE JSON 中提取 file 和 changes 字段。
 *
 * SEARCH_REPLACE 的 search/replace 值经常包含：
 * - 裸换行符（Markdown 多行内容）
 * - 未转义的双引号（Markdown 中的引号、HTML 属性等）
 * 这些都会导致 repairRawNewlines 的 inString 状态被错误切换。
 *
 * 策略：利用已知的 JSON 结构标记（"search":、"replace":、},{、}]）来定位
 * 每个 search/replace 值的边界，然后对值内部进行安全转义后重建合法 JSON。
 */
function extractSearchReplaceFields(raw) {
  // 1. 提取 file 字段（通常是简单路径，不含特殊字符）
  const fileMatch = raw.match(/"file"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!fileMatch) return null

  const filePath = fileMatch[1]

  // 2. 定位 changes 数组的起始位置
  const changesKeyMatch = raw.match(/"changes"\s*:\s*\[/)
  if (!changesKeyMatch) return null

  const changesStart = raw.indexOf(changesKeyMatch[0]) + changesKeyMatch[0].length

  // 3. 逐个提取 change 对象中的 search 和 replace 值
  const changes = []
  let position = changesStart

  while (position < raw.length) {
    // 查找下一个 "search": 标记
    const searchKeyPattern = /"search"\s*:\s*"/
    const searchKeyMatch = searchKeyPattern.exec(raw.substring(position))
    if (!searchKeyMatch) break

    const searchValueStart = position + searchKeyMatch.index + searchKeyMatch[0].length

    // 查找 "replace": 标记来定位 search 值的结束
    const replaceKeyPattern = /",\s*"replace"\s*:\s*"/
    const replaceKeyMatch = replaceKeyPattern.exec(raw.substring(searchValueStart))
    if (!replaceKeyMatch) break

    const searchValueEnd = searchValueStart + replaceKeyMatch.index
    const searchRaw = raw.substring(searchValueStart, searchValueEnd)

    const replaceValueStart = searchValueStart + replaceKeyMatch.index + replaceKeyMatch[0].length

    // 查找 replace 值的结束：寻找 "} 或 "},{ 或 "}] 模式
    // 从 replaceValueStart 开始，找到下一个结构性边界
    const replaceValueEnd = findReplaceValueEnd(raw, replaceValueStart)
    if (replaceValueEnd <= replaceValueStart) break

    const replaceRaw = raw.substring(replaceValueStart, replaceValueEnd)

    changes.push({
      search: escapeContentForJSON(searchRaw),
      replace: escapeContentForJSON(replaceRaw)
    })

    // 移动到下一个 change 对象
    position = replaceValueEnd + 1
  }

  if (changes.length === 0) return null

  // 4. 重建合法 JSON
  const changesJSON = changes.map(c => `{"search":"${c.search}","replace":"${c.replace}"}`).join(',')
  const fixedJSON = `{"file":"${filePath}","changes":[${changesJSON}]}`

  return JSON.parse(fixedJSON)
}

/**
 * 查找 replace 值的结束引号位置。
 * 从当前位置向后扫描，寻找 "} 模式（后面跟 , 或 ] 表示 change 对象结束）。
 * 需要区分 replace 值内部的引号和结构性引号。
 *
 * 策略：从后往前找，利用 "}] 或 "},{ 模式定位。
 * 但由于可能有多个 change 对象，我们从 replaceValueStart 向前找最近的结构性边界。
 */
function findReplaceValueEnd(raw, replaceValueStart) {
  // 从 replaceValueStart 开始，找到 "} 后跟 ] 或 , 的位置
  // 或者找到 "} 且 } 后面是 ] 或 ,{ 的位置
  for (let i = replaceValueStart; i < raw.length; i++) {
    if (raw[i] === '"') {
      // 检查这个引号是否是 replace 值的结束引号
      // 条件：后面紧跟 } 且 } 后面是 ] 或 ,
      let j = i + 1
      // 跳过空白
      while (j < raw.length && /\s/.test(raw[j])) j++
      if (raw[j] === '}') {
        let k = j + 1
        while (k < raw.length && /\s/.test(raw[k])) k++
        // change 对象结束：后面是 ] 或 ,
        if (raw[k] === ']' || raw[k] === ',') {
          return i
        }
      }
    }
  }
  return -1
}

/**
 * AI 调用包装函数，集成语义缓存 + 空值自动重试 + Token 监控
 */
async function callAIWithCache(prompt, options = {}) {
  const { source = 'chat', sessionId, contextMode, contextSize } = options

  // 估算 token 量级（粗略：1 token ≈ 4 字符英文 / 2 字符中文）
  const promptLen = typeof prompt === 'string' ? prompt.length : JSON.stringify(prompt).length
  console.log(`[AI][Token] 📤 输入长度: ${promptLen} 字符 (≈${Math.round(promptLen / 3)} tokens) | source: ${source}`)

  try {
    let aiResponse = await callAI(prompt, options)

    // AI 返回空时自动重试 1 次
    if (!aiResponse) {
      console.log('[AI] AI返回空，自动重试...')
      aiResponse = await callAI(prompt, options)
    }

    const responseLen = aiResponse ? aiResponse.length : 0
    console.log(`[AI][Token] 📥 输出长度: ${responseLen} 字符 (≈${Math.round(responseLen / 3)} tokens) | 总计 ≈${Math.round((promptLen + responseLen) / 3)} tokens`)

    // 记录 Token 用量
    tokenMonitor.recordCall({
      source,
      input: prompt,
      output: aiResponse || '',
      contextMode,
      contextSize,
      sessionId,
      intentMatched: false,
    })

    return aiResponse
  } catch (error) {
    console.error('[AI] 调用失败:', error)
    const retryResponse = await callAI(prompt, options)

    // 即使重试也记录
    tokenMonitor.recordCall({
      source,
      input: prompt,
      output: retryResponse || '',
      contextMode,
      contextSize,
      sessionId,
      intentMatched: false,
    })

    return retryResponse
  }
}

/**
 * 处理 AI 响应：清理 markdown 标记、检测 SCRIPT_BLOCK 等
 * @param {string} content - AI 原始响应文本
 * @param {boolean} webSearched - 是否进行了联网搜索
 * @param {BrowserWindow|null} mainWindow - 主窗口引用（用于清除搜索状态）
 */
function processAIResponse(content, webSearched, mainWindow) {
  // 清理可能的 markdown 标记
  let cleanedContent = content.trim()
  cleanedContent = cleanedContent.replace(/```bash\n?/g, '').replace(/```\n?/g, '').trim()

  // 检测响应中包含哪些指令
  const detectedDirectives = ['SEARCH_REPLACE', 'SCRIPT_BLOCK', 'MUSE_TASK', 'SKILL_UPDATE', 'COMMAND_OPTIONS', 'INSTALL_SKILL', 'SAVE_SKILL']
    .filter(directive => new RegExp(`${directive}:`, 'i').test(cleanedContent))
  console.log(`[AI][processAIResponse] 响应长度: ${content.length}${detectedDirectives.length ? ' | 指令: ' + detectedDirectives.join(', ') : ''}`)

  // AI 回复完成后才清除搜索状态，避免闪烁
  if (webSearched && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai:searchStatus', { searching: false })
  }

  // 括号平衡算法，正确提取嵌套 JSON（避免非贪婪正则被第一个 } 截断）
  function extractBalancedJSONFromText(text, startIndex) {
    let depth = 0
    let inString = false
    let escaped = false
    let jsonStart = -1
    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\' && inString) { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') {
        if (depth === 0) jsonStart = i
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) return text.substring(jsonStart, i + 1)
      }
    }
    return null
  }

  // ========== 检测 MUSE_TASK（AI 决定转交 Muse 智能体） ==========
  const museTaskHeaderMatch = cleanedContent.match(/MUSE_TASK:\s*\n?\s*\{/i)
  if (museTaskHeaderMatch) {
    const braceStart = museTaskHeaderMatch.index + museTaskHeaderMatch[0].lastIndexOf('{')
    const museTaskJson = extractBalancedJSONFromText(cleanedContent, braceStart)
    if (museTaskJson) {
      try {
        const museData = JSON.parse(museTaskJson)
        const task = museData.task
        if (task) {
          console.log('[AI] 检测到 MUSE_TASK 指令:', task)
          return {
            success: true,
            content: cleanedContent,
            webSearched,
            isMuseTask: true,
            museTask: task
          }
        }
      } catch (e) {
        console.error('[AI] MUSE_TASK 解析失败:', e.message)
      }
    }
  }

  // ========== 功能减法：OPEN_IN_BROWSER（侧边栏浏览器）已下线，不再解析 ==========

  // ========== 检测 SEARCH_REPLACE（代码增量变更） ==========
  const hasSearchReplace = /SEARCH_REPLACE:\s*\n?\s*\{/i.test(cleanedContent)
  if (hasSearchReplace) {
    const fileChanges = []
    let allSuccess = true
    const errors = []

    // 提取所有 SEARCH_REPLACE 块（支持多个）
    // 使用括号平衡匹配来正确提取嵌套 JSON
    function extractBalancedJSON(text, startIndex) {
      let depth = 0
      let inString = false
      let escaped = false
      let jsonStart = -1

      for (let i = startIndex; i < text.length; i++) {
        const ch = text[i]
        if (escaped) { escaped = false; continue }
        if (ch === '\\' && inString) { escaped = true; continue }
        if (ch === '"' && !escaped) { inString = !inString; continue }
        if (inString) continue
        if (ch === '{') {
          if (depth === 0) jsonStart = i
          depth++
        } else if (ch === '}') {
          depth--
          if (depth === 0) {
            return { json: text.substring(jsonStart, i + 1), endIndex: i + 1 }
          }
        }
      }
      return null
    }

    const blockHeaderRegex = /SEARCH_REPLACE:\s*\n?\s*/gi
    let headerMatch
    const extractedBlocks = [] // 记录每个块的起止位置，用于后续提取 runCommand
    while ((headerMatch = blockHeaderRegex.exec(cleanedContent)) !== null) {
      const jsonResult = extractBalancedJSON(cleanedContent, headerMatch.index + headerMatch[0].length)
      if (!jsonResult) continue
      extractedBlocks.push({ start: headerMatch.index, end: jsonResult.endIndex })
      const blockMatch = [null, jsonResult.json] // 兼容后续代码
      // 更新 regex lastIndex 跳过已解析的 JSON 块
      blockHeaderRegex.lastIndex = jsonResult.endIndex
      try {
        const changeData = repairAndParseJSON(blockMatch[1])
        const { file: filePath, changes } = changeData

        if (!filePath || !changes || !Array.isArray(changes)) {
          errors.push(`无效的 SEARCH_REPLACE 格式：缺少 file 或 changes 字段`)
          allSuccess = false
          continue
        }

        if (!fs.existsSync(filePath)) {
          errors.push(`文件不存在: ${filePath}`)
          allSuccess = false
          continue
        }

        let fileContent = fs.readFileSync(filePath, 'utf-8')
        const appliedChanges = []

        for (const change of changes) {
          const { search, replace } = change
          if (typeof search !== 'string' || typeof replace !== 'string') {
            errors.push(`无效的变更块：search 和 replace 必须是字符串`)
            allSuccess = false
            continue
          }

          // 处理 AI 输出中的转义换行符
          const normalizedSearch = search.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          const normalizedReplace = replace.replace(/\\n/g, '\n').replace(/\\t/g, '\t')

          if (!fileContent.includes(normalizedSearch)) {
            errors.push(`在 ${path.basename(filePath)} 中未找到匹配内容: "${normalizedSearch.substring(0, 60)}..."`)
            allSuccess = false
            continue
          }

          fileContent = fileContent.replace(normalizedSearch, normalizedReplace)
          appliedChanges.push({
            search: normalizedSearch,
            replace: normalizedReplace,
            status: 'applied'
          })
        }

        // 写入变更后的文件
        if (appliedChanges.length > 0) {
          fs.writeFileSync(filePath, fileContent, 'utf-8')
          console.log(`[AI] SEARCH_REPLACE 已应用 ${appliedChanges.length} 处变更到: ${filePath}`)
        }

        fileChanges.push({
          file: filePath,
          filename: path.basename(filePath),
          changesApplied: appliedChanges.length,
          changesTotal: changes.length,
          changes: appliedChanges
        })
      } catch (e) {
        console.error('[AI] SEARCH_REPLACE 解析失败:', e.message)
        errors.push(`解析失败: ${e.message}`)
        allSuccess = false
      }
    }

    // 构建结果摘要
    const resultLines = ['**📝 代码变更结果**', '']
    for (const fc of fileChanges) {
      const icon = fc.changesApplied === fc.changesTotal ? '✅' : '⚠️'
      resultLines.push(`${icon} \`${fc.filename}\` — 应用 ${fc.changesApplied}/${fc.changesTotal} 处变更`)
    }
    if (errors.length > 0) {
      resultLines.push('', '**错误：**')
      errors.forEach(err => resultLines.push(`- ❌ ${err}`))
    }

    return {
      success: true,
      content: JSON.stringify({
        type: 'search_replace',
        fileChanges,
        errors,
        allSuccess,
        summary: resultLines.join('\n')
      }),
      webSearched,
      isSearchReplace: true
    }
  }

  // ========== 检测 SCRIPT_BLOCK ==========
  const scriptBlockIndex = cleanedContent.search(/SCRIPT_BLOCK:\s*\n?\s*\{/i)
  if (scriptBlockIndex !== -1) {
    try {
      // 用花括号计数法提取第一个完整 JSON 对象，避免贪婪正则匹配多个 SCRIPT_BLOCK
      const firstJsonStr = extractFirstJsonObject(cleanedContent.slice(scriptBlockIndex))
      const scriptData = repairAndParseJSON(firstJsonStr)
      const { lang, description, content: scriptBody, isDangerous, dangerReason, targetFiles } = scriptData

      const extMap = { python: 'py', sh: 'sh', node: 'js', ruby: 'rb', bash: 'sh' }
      const ext = extMap[lang] || 'sh'

      // JSON.parse 已正确处理转义（\n → 换行符，\\n → \n 字面量），无需额外替换
      const scriptContent = scriptBody

      // 脚本内容指纹：内容一致时复用已有文件，避免重复生成
      const crypto = require('crypto')
      const scriptHash = crypto.createHash('md5').update(scriptContent).digest('hex')

      let filepath, filename
      if (scriptHash === _lastScriptHash && _lastScriptPath && fs.existsSync(_lastScriptPath)) {
        filepath = _lastScriptPath
        filename = path.basename(filepath)
        console.log('[AI] 脚本内容未变，复用已有文件:', filepath)
      } else {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        filename = `script_${timestamp}.${ext}`

        fs.mkdirSync(scriptsDir, { recursive: true })

        filepath = path.join(scriptsDir, filename)
        fs.writeFileSync(filepath, scriptContent, 'utf8')

        if (ext === 'sh') fs.chmodSync(filepath, '755')

        _lastScriptHash = scriptHash
        _lastScriptPath = filepath
        console.log('[AI] 脚本已保存:', filepath)
      }

      const runnerMap = { py: 'python3', js: 'node', rb: 'ruby', sh: 'bash' }
      const runner = runnerMap[ext] || 'bash'
      const runCommand = `${runner} "${filepath}"`

      return {
        success: true,
        content: JSON.stringify({
          type: 'script',
          scriptFile: filepath,
          filename,
          lang,
          description: description || '脚本',
          scriptContent,
          runCommand,
          isDangerous: !!isDangerous,
          dangerReason: dangerReason || '',
          targetFiles: Array.isArray(targetFiles) ? targetFiles : []
        }),
        webSearched,
        isScript: true
      }
    } catch (e) {
      const rawSnippet = cleanedContent.slice(scriptBlockIndex)
      console.error('[AI] SCRIPT_BLOCK 解析失败:', e.message)
      console.error('[AI] 原始内容(前200字符):', rawSnippet.substring(0, 200))

      // 将错误信息和原始内容格式化为 Markdown，方便用户在 UI 上查看和复制
      const errorContent = [
        '❌ **SCRIPT_BLOCK 解析失败**',
        '',
        `> ${e.message}`,
        '',
        '原始内容：',
        '```json',
        rawSnippet,
        '```'
      ].join('\n')

      return { success: true, content: errorContent, webSearched }
    }
  }

  // ========== 检测 ReAct 协议 JSON（type:final / type:action）泄漏 ==========
  // AI 在普通聊天路径中偶尔返回 ReAct 内部协议 JSON，需剥除避免泄漏到消息气泡
  const reactJsonHeaderMatch = cleanedContent.match(/\{\s*"type"\s*:\s*"(final|action)"/)
  if (reactJsonHeaderMatch) {
    const braceStart = reactJsonHeaderMatch.index
    const reactJsonStr = extractBalancedJSONFromText(cleanedContent, braceStart)
    if (reactJsonStr) {
      try {
        const reactData = JSON.parse(reactJsonStr)
        if (reactData.type === 'final') {
          const answer = reactData.answer || reactData.final_answer || reactData.thought || ''
          console.log('[AI] 检测到 ReAct final JSON 泄漏，提取 answer:', answer.substring(0, 100))
          const textBefore = cleanedContent.slice(0, braceStart).trim()
          const textAfter = cleanedContent.slice(braceStart + reactJsonStr.length).trim()
          const cleanText = [textBefore, answer, textAfter].filter(Boolean).join('\n\n')
          return { success: true, content: cleanText || answer, webSearched }
        }
        if (reactData.type === 'action') {
          console.log('[AI] 检测到 ReAct action JSON 泄漏，剥除')
          const textBefore = cleanedContent.slice(0, braceStart).trim()
          const textAfter = cleanedContent.slice(braceStart + reactJsonStr.length).trim()
          const cleanText = [textBefore, textAfter].filter(Boolean).join('\n\n')
          return { success: true, content: cleanText || '（正在处理中…）', webSearched }
        }
      } catch (e) {
        console.warn('[AI] ReAct JSON 解析失败但模式匹配命中，剥除原文')
        const textBefore = cleanedContent.slice(0, braceStart).trim()
        const textAfter = cleanedContent.slice(braceStart + reactJsonStr.length).trim()
        const cleanText = [textBefore, textAfter].filter(Boolean).join('\n\n')
        if (cleanText) return { success: true, content: cleanText, webSearched }
      }
    }
  }

  console.log('[Main] AI 调用成功, 联网搜索:', webSearched)
  return { success: true, content: cleanedContent, webSearched }
}

module.exports = { callAIWithCache, processAIResponse }

'use strict'

/**
 * 精确文件编辑模块
 * 
 * 通过 AI 生成 old_string/new_string 替换对，精确修改已有文件，
 * 避免每次修改都重新生成整个文件。
 * 
 * 核心流程：
 *   1. 读取目标文件内容
 *   2. AI 分析修改需求，输出替换对数组
 *   3. 逐个执行替换（验证 old_string 唯一存在）
 *   4. 写回文件
 */

const fs = require('fs')
const path = require('path')
const { callAI } = require('../../shared/ai-client')
const { getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { AI_TIMEOUT_LONG } = require('./config')

const MAX_FILE_SIZE_FOR_EDIT = 200 * 1024 // 200KB，超过此大小不走精确编辑
const MAX_EDIT_RETRIES = 2

/**
 * 精确编辑文件
 * 
 * @param {string} filePath - 要编辑的文件绝对路径
 * @param {string} editRequest - 修改需求描述（如"颜色太深了"、"标题字体换大一点"）
 * @param {object} [options]
 * @param {string} [options.originalCommand] - 原始任务描述（提供更多上下文）
 * @param {string[]} [options.feedbackHistory] - 主人的反馈历史
 * @returns {Promise<{success: boolean, editCount: number, error?: string}>}
 */
async function editFileInPlace(filePath, editRequest, options = {}) {
  console.log('[FileEditor] 📝 精确编辑文件:', path.basename(filePath))
  console.log('[FileEditor] 修改需求:', editRequest)

  // 1. 验证文件存在且可编辑
  if (!fs.existsSync(filePath)) {
    return { success: false, editCount: 0, error: `文件不存在: ${filePath}` }
  }

  const stat = fs.statSync(filePath)
  if (stat.size > MAX_FILE_SIZE_FOR_EDIT) {
    return { success: false, editCount: 0, error: `文件过大 (${(stat.size / 1024).toFixed(1)}KB)，不适合精确编辑` }
  }

  // 2. 读取文件内容
  const originalContent = fs.readFileSync(filePath, 'utf8')
  const fileName = path.basename(filePath)
  const fileExt = path.extname(filePath).slice(1)

  // 3. 调用 AI 生成替换对
  const edits = await generateEdits(originalContent, fileName, fileExt, editRequest, options)
  if (!edits || edits.length === 0) {
    return { success: false, editCount: 0, error: 'AI 未生成有效的编辑指令' }
  }

  console.log(`[FileEditor] 📋 收到 ${edits.length} 个编辑指令`)

  // 4. 逐个执行替换
  let currentContent = originalContent
  let appliedCount = 0
  const errors = []

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    if (!edit.old_string || edit.new_string === undefined) {
      errors.push(`编辑 #${i + 1}: 缺少 old_string 或 new_string`)
      continue
    }

    // 验证 old_string 存在
    const occurrences = countOccurrences(currentContent, edit.old_string)
    if (occurrences === 0) {
      console.warn(`[FileEditor] ⚠️ 编辑 #${i + 1}: old_string 未找到，跳过`)
      errors.push(`编辑 #${i + 1}: old_string 未找到`)
      continue
    }

    if (occurrences > 1) {
      console.warn(`[FileEditor] ⚠️ 编辑 #${i + 1}: old_string 有 ${occurrences} 处匹配，全部替换`)
    }

    // 执行替换
    currentContent = currentContent.replace(edit.old_string, edit.new_string)
    appliedCount++
    console.log(`[FileEditor] ✅ 编辑 #${i + 1} 已应用`)
  }

  if (appliedCount === 0) {
    return { success: false, editCount: 0, error: `所有编辑均失败: ${errors.join('; ')}` }
  }

  // 5. 写回文件（先备份）
  const backupPath = filePath + '.bak'
  try {
    fs.writeFileSync(backupPath, originalContent, 'utf8')
    fs.writeFileSync(filePath, currentContent, 'utf8')
    // 写入成功后删除备份
    try { fs.unlinkSync(backupPath) } catch {}
  } catch (writeErr) {
    // 写入失败，尝试恢复
    try { fs.writeFileSync(filePath, originalContent, 'utf8') } catch {}
    return { success: false, editCount: 0, error: `文件写入失败: ${writeErr.message}` }
  }

  console.log(`[FileEditor] ✅ 精确编辑完成: ${appliedCount}/${edits.length} 个编辑已应用`)

  return {
    success: true,
    editCount: appliedCount,
    totalEdits: edits.length,
    skippedEdits: edits.length - appliedCount,
    errors: errors.length > 0 ? errors : undefined
  }
}

/**
 * 批量精确编辑多个文件
 * 
 * @param {Array<{filePath: string, editRequest: string}>} fileEdits - 文件编辑列表
 * @param {object} [options] - 同 editFileInPlace 的 options
 * @returns {Promise<{success: boolean, results: Array}>}
 */
async function editMultipleFiles(fileEdits, options = {}) {
  console.log(`[FileEditor] 📝 批量编辑 ${fileEdits.length} 个文件`)

  const results = []
  let allSuccess = true

  for (const { filePath, editRequest } of fileEdits) {
    const result = await editFileInPlace(filePath, editRequest, options)
    results.push({ filePath: path.basename(filePath), ...result })
    if (!result.success) allSuccess = false
  }

  return { success: allSuccess, results }
}

/**
 * 智能判断：应该精确编辑还是重新生成
 * 
 * @param {string} modificationRequest - 修改需求
 * @param {string[]} outputFiles - 已有产物文件列表
 * @param {string} taskDir - 任务工作目录
 * @returns {{shouldEdit: boolean, editableFiles: Array<{filePath: string, reason: string}>}}
 */
function shouldUseFileEdit(modificationRequest, outputFiles, taskDir) {
  if (!outputFiles || outputFiles.length === 0) {
    outputFiles = []

    // 1. 优先扫描任务目录
    if (taskDir && fs.existsSync(taskDir)) {
      try {
        const files = fs.readdirSync(taskDir).filter(f => !f.startsWith('.') && !f.startsWith('temp_'))
        outputFiles = files.map(f => path.join(taskDir, f))
      } catch {}
    }

    // 2. 任务目录没找到产物，尝试扫描桌面（兼容旧任务产物保存到桌面的情况）
    if (outputFiles.length === 0) {
      const desktopDir = path.join(require('os').homedir(), 'Desktop')
      if (fs.existsSync(desktopDir)) {
        try {
          // 只查找最近 24 小时内修改的文件，避免误匹配
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
          const recentFiles = fs.readdirSync(desktopDir)
            .filter(f => !f.startsWith('.'))
            .map(f => ({ name: f, fullPath: path.join(desktopDir, f) }))
            .filter(f => {
              try {
                const stat = fs.statSync(f.fullPath)
                return stat.isFile() && stat.mtimeMs > oneDayAgo
              } catch { return false }
            })
            .map(f => f.fullPath)
          outputFiles = recentFiles
        } catch {}
      }
    }

    if (outputFiles.length === 0) {
      return { shouldEdit: false, editableFiles: [] }
    }
  }

  // 可精确编辑的文件类型
  const editableExtensions = new Set([
    '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx',
    '.svg', '.xml', '.json', '.md', '.txt', '.yaml', '.yml',
    '.py', '.sh', '.bash', '.vue', '.less', '.scss', '.sass'
  ])

  const editableFiles = []

  for (const file of outputFiles) {
    const absPath = path.isAbsolute(file) ? file : path.join(taskDir || '', file)
    if (!fs.existsSync(absPath)) continue

    const ext = path.extname(absPath).toLowerCase()
    if (!editableExtensions.has(ext)) continue

    const stat = fs.statSync(absPath)
    if (stat.size > MAX_FILE_SIZE_FOR_EDIT) continue

    editableFiles.push({
      filePath: absPath,
      fileName: path.basename(absPath),
      extension: ext,
      size: stat.size
    })
  }

  return {
    shouldEdit: editableFiles.length > 0,
    editableFiles
  }
}

// ========== 内部函数 ==========

/**
 * 调用 AI 生成编辑替换对
 */
async function generateEdits(fileContent, fileName, fileExt, editRequest, options = {}) {
  const feedbackContext = options.feedbackHistory?.length > 0
    ? `\n【主人的历史反馈】\n${options.feedbackHistory.slice(-3).join('\n')}`
    : ''

  const originalCommandContext = options.originalCommand
    ? `\n【原始任务】\n${options.originalCommand.slice(0, 500)}`
    : ''

  const prompt = `${SOUL_PROMPT}

你需要精确编辑一个已有文件。不要重新生成整个文件，只输出需要修改的部分。

【文件名】${fileName}
【文件类型】${fileExt}
${originalCommandContext}${feedbackContext}

【修改需求】
${editRequest}

【当前文件内容】
\`\`\`${fileExt}
${fileContent}
\`\`\`

请分析修改需求，输出精确的替换指令。以 JSON 格式返回：
{
  "edits": [
    {
      "old_string": "要被替换的原始文本（必须与文件中的内容完全一致，包括空格和换行）",
      "new_string": "替换后的新文本",
      "description": "这个修改做了什么（10字以内）"
    }
  ],
  "summary": "整体修改概述（30字以内）"
}

重要规则：
1. old_string 必须是文件中实际存在的、完全匹配的文本片段
2. old_string 要足够长以确保唯一性（至少包含完整的一行或一个代码块）
3. 不要输出未修改的部分
4. 如果修改涉及多处，输出多个 edit 对象
5. new_string 可以是空字符串（表示删除）
6. 保持原有的缩进和格式风格
7. 返回纯 JSON，不要解释`

  for (let retry = 0; retry <= MAX_EDIT_RETRIES; retry++) {
    try {
      const response = await callAI(prompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_LONG
      })

      const result = parseMuseResponse(response)
      if (result?.edits && Array.isArray(result.edits) && result.edits.length > 0) {
        console.log(`[FileEditor] AI 返回 ${result.edits.length} 个编辑: ${result.summary || ''}`)
        return result.edits
      }

      if (retry < MAX_EDIT_RETRIES) {
        console.warn(`[FileEditor] ⚠️ 第 ${retry + 1} 次生成编辑失败，重试...`)
      }
    } catch (err) {
      console.error(`[FileEditor] AI 调用失败 (第 ${retry + 1} 次):`, err.message)
    }
  }

  return null
}

/**
 * 统计字符串在文本中出现的次数
 */
function countOccurrences(text, searchString) {
  let count = 0
  let position = 0
  while ((position = text.indexOf(searchString, position)) !== -1) {
    count++
    position += searchString.length
  }
  return count
}

module.exports = {
  editFileInPlace,
  editMultipleFiles,
  shouldUseFileEdit
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 大文件分块分析模块
 * 将大文件按行切分为多个 chunk，逐块调用 AI 提取摘要，最终合并生成完整报告
 */

const fs = require('fs')
const path = require('path')
const { callAI } = require('../../shared/ai-client')
const { getMuseSessionId } = require('./context')
const { SOUL_PROMPT } = require('./prompt')
const { writeJournal } = require('./core')
const { CHUNK_LINES, LARGE_FILE_THRESHOLD, CHUNK_MERGE_BATCH_SIZE, CHUNK_SUMMARY_MAX_CHARS, AI_TIMEOUT_NORMAL, AI_TIMEOUT_LONG } = require('./config')

/**
 * 按行切分文件
 * @param {string} filePath - 文件绝对路径
 * @param {number} chunkLines - 每块行数
 * @returns {string[]} chunk 数组
 */
function readFileChunks(filePath, chunkLines = CHUNK_LINES) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const chunks = []

  for (let i = 0; i < lines.length; i += chunkLines) {
    const chunk = lines.slice(i, i + chunkLines).join('\n')
    if (chunk.trim()) {
      chunks.push(chunk)
    }
  }

  return chunks
}

/**
 * 获取文件行数
 * @param {string} filePath - 文件绝对路径
 * @returns {number} 行数
 */
function getFileLineCount(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return content.split('\n').length
  } catch {
    return 0
  }
}

/**
 * 检查文件是否为大文件
 * @param {string} filePath - 文件绝对路径
 * @returns {boolean}
 */
function isLargeFile(filePath) {
  return getFileLineCount(filePath) > LARGE_FILE_THRESHOLD
}

/**
 * 逐块调用 AI 提取摘要
 * @param {string[]} chunks - 文件块数组
 * @param {string} taskPrompt - 用户的分析指令
 * @returns {Promise<string[]>} 每块的摘要
 */
async function analyzeChunks(chunks, taskPrompt) {
  const summaries = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    console.log(`[Muse] 📄 分块分析 ${i + 1}/${chunks.length}...`)

    const prompt = `${SOUL_PROMPT}

你正在帮主人分析一个大文件，当前是第 ${i + 1}/${chunks.length} 块。

【主人的分析指令】
${taskPrompt}

【文件片段（第 ${i + 1}/${chunks.length} 块）】
${chunk}

请根据主人的指令，分析这段内容。要求：
1. 只输出与指令相关的结构化发现，不要复述原文
2. 用简洁的要点列出发现
3. 如果这段内容没有与指令相关的发现，输出"本段无相关发现"
4. 标注发现所在的大致行号范围（如有）`

    try {
      const result = await callAI(prompt, {
        sessionId: getMuseSessionId(),
        timeout: AI_TIMEOUT_NORMAL
      })
      summaries.push(`【第${i + 1}块摘要（行 ${i * CHUNK_LINES + 1}-${Math.min((i + 1) * CHUNK_LINES, (i + 1) * CHUNK_LINES)}）】\n${result}`)
    } catch (err) {
      console.error(`[Muse] ⚠️ 第 ${i + 1} 块分析失败:`, err.message)
      summaries.push(`【第${i + 1}块】分析失败: ${err.message}`)
    }
  }

  return summaries
}

/**
 * 合并摘要（支持分层合并）
 * 如果合并后的摘要总字符数超过阈值，先分批合并再做最终合并
 * @param {string[]} summaries - 各块摘要
 * @param {string} taskPrompt - 用户的分析指令
 * @returns {Promise<string>} 最终合并报告
 */
async function mergeSummaries(summaries, taskPrompt) {
  let mergedText = summaries.join('\n\n')

  // 如果合并后仍然很大，分批二次合并
  if (mergedText.length > CHUNK_SUMMARY_MAX_CHARS) {
    console.log(`[Muse] 📄 摘要总量较大（${mergedText.length} 字符），进行分层合并...`)

    const subSummaries = []
    for (let i = 0; i < summaries.length; i += CHUNK_MERGE_BATCH_SIZE) {
      const batch = summaries.slice(i, i + CHUNK_MERGE_BATCH_SIZE)
      const batchText = batch.join('\n\n')

      console.log(`[Muse] 📄 分层合并批次 ${Math.floor(i / CHUNK_MERGE_BATCH_SIZE) + 1}...`)

      const batchPrompt = `${SOUL_PROMPT}

你正在帮主人分析一个大文件。以下是部分块的分析摘要，请合并去重，提炼关键发现。

【主人的分析指令】
${taskPrompt}

【部分摘要】
${batchText}

请合并这些摘要，去除重复，保留所有独特的发现。用简洁的要点输出。`

      try {
        const result = await callAI(batchPrompt, {
          sessionId: getMuseSessionId(),
          timeout: AI_TIMEOUT_NORMAL
        })
        subSummaries.push(result)
      } catch (err) {
        console.error(`[Muse] ⚠️ 分层合并失败:`, err.message)
        subSummaries.push(batchText.slice(0, 2000)) // 降级：截取前2000字符
      }
    }

    mergedText = subSummaries.join('\n\n')
  }

  // 最终合并
  console.log('[Muse] 📄 生成最终分析报告...')

  const finalPrompt = `${SOUL_PROMPT}

你已经完成了对一个大文件的分块分析。以下是所有块的分析摘要，请生成最终的综合分析报告。

【主人的分析指令】
${taskPrompt}

【所有摘要】
${mergedText}

请生成一份完整的分析报告，包含：
1. 总体概述
2. 按指令要求归类的详细发现（按重要性/频率排序）
3. 具体的建议和改进方案
4. 如果涉及自动化建议，给出可行的实现思路

报告要结构清晰、重点突出，直接输出报告内容。`

  const finalReport = await callAI(finalPrompt, {
    sessionId: getMuseSessionId(),
    timeout: AI_TIMEOUT_LONG
  })

  return finalReport
}

/**
 * 分块分析大文件（主入口）
 * @param {string} filePath - 文件绝对路径
 * @param {string} taskPrompt - 用户的分析指令（如"找出重复工作"）
 * @param {object} options - 可选配置
 * @param {number} options.chunkLines - 每块行数，默认使用 CHUNK_LINES
 * @returns {Promise<{success: boolean, result: string, chunks: number}>}
 */
async function chunkedAnalyzeFile(filePath, taskPrompt, options = {}) {
  const chunkLines = options.chunkLines || CHUNK_LINES
  const fileName = path.basename(filePath)

  console.log(`[Muse] 📄 检测到大文件，启用分块分析: ${fileName}`)

  try {
    // 1. 按行切分
    const chunks = readFileChunks(filePath, chunkLines)
    const lineCount = getFileLineCount(filePath)
    console.log(`[Muse] 📄 文件 ${fileName}: ${lineCount} 行，切分为 ${chunks.length} 块`)

    writeJournal(`**分块分析大文件**: ${fileName}\n- 行数: ${lineCount}\n- 块数: ${chunks.length}\n- 分析指令: ${taskPrompt}`, 'chunk-analyze')

    // 2. 逐块分析
    const summaries = await analyzeChunks(chunks, taskPrompt)

    // 3. 合并生成报告
    const finalReport = await mergeSummaries(summaries, taskPrompt)

    console.log(`[Muse] ✅ 分块分析完成: ${fileName}，共 ${chunks.length} 块`)

    writeJournal(`**分块分析完成**: ${fileName}\n- 块数: ${chunks.length}\n- 报告长度: ${finalReport.length} 字符`, 'chunk-analyze')

    return {
      success: true,
      result: finalReport,
      chunks: chunks.length,
      fileName
    }
  } catch (err) {
    console.error(`[Muse] ❌ 分块分析失败: ${fileName}`, err.message)

    writeJournal(`**分块分析失败**: ${fileName}\n- 错误: ${err.message}`, 'chunk-analyze')

    return {
      success: false,
      result: null,
      error: err.message,
      fileName
    }
  }
}

module.exports = {
  chunkedAnalyzeFile,
  isLargeFile,
  getFileLineCount,
  readFileChunks
}

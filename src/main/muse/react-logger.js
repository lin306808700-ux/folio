// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * ReAct 执行全链路日志记录器
 * 
 * 记录从用户输入 → 意图分类 → ReAct 每步推理/工具调用/观察 → 最终结果
 * 每次 ReAct 执行生成一个独立 JSON 日志文件，便于事后分析和系统优化
 * 
 * 日志目录: ~/.folio/muse/react-logs/
 * 文件命名: {date}_{sessionId}.json
 */

const fs = require('fs')
const path = require('path')
const { REACT_LOG_DIR } = require('./config')

// 确保目录存在
fs.mkdirSync(REACT_LOG_DIR, { recursive: true })

// 日志保留天数
const LOG_RETENTION_DAYS = 30

/**
 * 单次 ReAct 执行的日志会话
 */
class ReactLogSession {
  constructor({ userInput, sessionId, source, intentClassification }) {
    this.sessionId = sessionId || `react_${Date.now()}`
    this.startedAt = new Date().toISOString()
    this.userInput = userInput || ''
    this.source = source || 'unknown' // 'router_tool' | 'muse_task' | 'router_followup'
    this.intentClassification = intentClassification || null
    this.context = {}
    this.promptSnapshots = []
    this.steps = []
    this.result = null
    this.finishedAt = null
    this.durationMs = 0
    this.error = null
  }

  /** 记录传给 ReAct 的上下文摘要（不记录完整 prompt 正文，只记长度和关键字段） */
  logContext(context) {
    this.context = {
      workspace: context.workspace || '',
      hasMemories: !!(context.memories && context.memories.length > 0),
      memoriesLength: (context.memories || '').length,
      hasProfile: !!(context.profile && context.profile.length > 0),
      hasPreviousTask: !!context.previousTask,
    }
  }

  /** 记录发给 AI 的完整 prompt（每步一个快照） */
  logPrompt(stepNum, prompt) {
    this.promptSnapshots.push({
      step: stepNum,
      promptLength: prompt.length,
      // 只存前 500 和后 500 字符，避免日志过大；完整 prompt 可通过 verbose 模式开启
      promptHead: prompt.slice(0, 500),
      promptTail: prompt.slice(-500),
      timestamp: new Date().toISOString(),
    })
  }

  /** 记录 AI 原始返回 */
  logAIResponse(stepNum, rawResponse, parseResult, aiDurationMs) {
    const stepEntry = this._getOrCreateStep(stepNum)
    stepEntry.aiResponse = {
      rawLength: (rawResponse || '').length,
      rawHead: (rawResponse || '').slice(0, 800),
      parseType: parseResult?.type || 'unknown',
      parsedThought: (parseResult?.thought || '').slice(0, 200),
      parsedAction: parseResult?.actionName || parseResult?.type || '',
      parsedInput: parseResult?.actionInput ? JSON.stringify(parseResult.actionInput).slice(0, 300) : '',
      durationMs: aiDurationMs,
    }
    stepEntry.timestamp = new Date().toISOString()
  }

  /** 记录工具执行结果 */
  logToolExecution(stepNum, actionName, actionInput, observation, success, toolDurationMs) {
    const stepEntry = this._getOrCreateStep(stepNum)
    stepEntry.toolExecution = {
      action: actionName,
      input: JSON.stringify(actionInput || {}).slice(0, 500),
      observationLength: (observation || '').length,
      observationHead: (observation || '').slice(0, 500),
      success,
      durationMs: toolDurationMs,
    }
  }

  /** 记录元认知信号 */
  logMetacogSignals(stepNum, signals) {
    if (!signals || signals.length === 0) return
    const stepEntry = this._getOrCreateStep(stepNum)
    stepEntry.metacogSignals = signals
  }

  /** 记录最终结果 */
  logResult({ success, finalAnswer, totalSteps, error }) {
    this.finishedAt = new Date().toISOString()
    this.durationMs = Date.now() - new Date(this.startedAt).getTime()
    this.result = {
      success,
      finalAnswerLength: (finalAnswer || '').length,
      finalAnswerHead: (finalAnswer || '').slice(0, 500),
      totalSteps,
    }
    this.error = error || null
  }

  /** 写入日志文件 */
  flush() {
    try {
      const date = this.startedAt.slice(0, 10)
      const shortId = this.sessionId.slice(-8)
      const fileName = `${date}_${shortId}.json`
      const filePath = path.join(REACT_LOG_DIR, fileName)

      const logData = {
        sessionId: this.sessionId,
        startedAt: this.startedAt,
        finishedAt: this.finishedAt,
        durationMs: this.durationMs,
        userInput: this.userInput,
        source: this.source,
        intentClassification: this.intentClassification,
        context: this.context,
        steps: this.steps,
        promptSnapshots: this.promptSnapshots,
        result: this.result,
        error: this.error,
      }

      fs.writeFileSync(filePath, JSON.stringify(logData, null, 2), 'utf-8')
      console.log(`[ReactLogger] 日志已写入: ${fileName} (${this.steps.length} steps, ${this.durationMs}ms)`)
      return filePath
    } catch (err) {
      console.warn('[ReactLogger] 日志写入失败:', err.message)
      return null
    }
  }

  _getOrCreateStep(stepNum) {
    let step = this.steps.find(s => s.step === stepNum)
    if (!step) {
      step = { step: stepNum, timestamp: new Date().toISOString() }
      this.steps.push(step)
    }
    return step
  }
}

/**
 * 清理过期日志
 */
function cleanupOldLogs() {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const files = fs.readdirSync(REACT_LOG_DIR).filter(f => f.endsWith('.json'))
    let cleaned = 0
    for (const file of files) {
      const filePath = path.join(REACT_LOG_DIR, file)
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath)
        cleaned++
      }
    }
    if (cleaned > 0) {
      console.log(`[ReactLogger] 清理了 ${cleaned} 个过期日志`)
    }
  } catch (err) {
    console.warn('[ReactLogger] 日志清理失败:', err.message)
  }
}

module.exports = { ReactLogSession, cleanupOldLogs }

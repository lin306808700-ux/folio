'use strict'

/**
 * Token 监控与主动优化模块
 *
 * 功能：
 * 1. 轻量 Token 估算（中文 ~1.5 token/字，英文 ~0.75 token/word）
 * 2. 环形缓冲调用日志（最近 200 条）
 * 3. 高频低效模式自动检测 + 优化触发
 * 4. 统计报告输出
 */

class TokenMonitor {
  constructor() {
    // 环形缓冲区
    this._logs = []
    this._maxLogs = 200

    // 主窗口引用（用于 IPC push）
    this._window = null

    // 统计聚合
    this._stats = {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      bySource: {},         // source → { calls, inputTokens, outputTokens }
      intentIntercepted: 0, // 被意图引擎拦截的次数（零 Token）
    }

    // 高频模式检测状态
    this._sessionOptimizations = new Map()  // sessionId → { compressedPrompt, ... }
    this._recentInputs = []                 // { text, timestamp } 用于检测重复
    this._recentInputsMax = 20

    // ═══ 上下文长度追踪 ═══
    // 基础长度：首次请求时注入的默认上下文（systemPrompt + 画像 + 技能等）
    // 增量长度：每次对话额外增加的上下文（用户输入 + AI 响应 + 搜索结果等）
    this._contextStats = {
      baseLength: 0,           // 基础上下文长度（字符数）
      baseTokens: 0,           // 基础上下文 Token 估算
      incrementalLength: 0,    // 累计增量长度（字符数）
      incrementalTokens: 0,    // 累计增量 Token 估算
      totalLength: 0,          // 总长度 = 基础 + 增量
      totalTokens: 0,          // 总 Token = 基础 + 增量
      breakdown: {},           // 各部分长度明细 { systemPrompt, memory, skills, ... }
      roundCount: 0,           // 对话轮次
    }
  }

  /**
   * 注入主窗口引用（用于实时推送 Token 更新到前端）
   */
  setWindow(win) {
    this._window = win
  }

  /**
   * 推送 Token 更新事件到前端
   */
  _pushToRenderer(logEntry) {
    if (!this._window || this._window.isDestroyed()) return
    try {
      this._window.webContents.send('token:update', {
        // 本次调用
        call: {
          source: logEntry.source,
          inputTokens: logEntry.inputTokens,
          outputTokens: logEntry.outputTokens,
          totalTokens: logEntry.totalTokens,
          contextMode: logEntry.contextMode,
          timestamp: logEntry.timestamp,
        },
        // 累计统计
        stats: {
          totalCalls: this._stats.totalCalls,
          totalTokens: this._stats.totalInputTokens + this._stats.totalOutputTokens,
          totalInputTokens: this._stats.totalInputTokens,
          totalOutputTokens: this._stats.totalOutputTokens,
          intentIntercepted: this._stats.intentIntercepted,
        }
      })
    } catch (e) {
      // 静默失败
    }
  }

  // ═══════════════════════════════════════════
  //  Token 估算
  // ═══════════════════════════════════════════

  /**
   * 估算文本的 Token 数量
   * 中文 ≈ 1.5 token/字，英文 ≈ 0.75 token/word，其他 ≈ 0.5 token/char
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
    const digits = (text.match(/\d+/g) || []).join('').length
    const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length - digits
    return Math.ceil(
      chineseChars * 1.5 +
      englishWords * 0.75 +
      digits * 0.3 +
      Math.max(0, otherChars) * 0.5
    )
  }

  // ═══════════════════════════════════════════
  //  调用日志记录
  // ═══════════════════════════════════════════

  /**
   * 记录一次 AI 调用
   * @param {Object} entry
   * @param {string} entry.source - 调用来源: 'chat' | 'react' | 'planner' | 'analyzer'
   * @param {string} entry.input - 输入 prompt
   * @param {string} entry.output - AI 响应
   * @param {string} entry.contextMode - 'full' | 'light'
   * @param {number} entry.contextSize - 上下文字符数
   * @param {string} entry.sessionId
   * @param {boolean} entry.intentMatched - 是否先经过意图引擎
   */
  recordCall(entry) {
    const inputTokens = this.estimateTokens(entry.input)
    const outputTokens = this.estimateTokens(entry.output)

    const logEntry = {
      timestamp: Date.now(),
      source: entry.source || 'chat',
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      contextMode: entry.contextMode || 'unknown',
      contextSize: entry.contextSize || 0,
      sessionId: entry.sessionId || '',
      intentMatched: entry.intentMatched || false,
    }

    // 写入环形缓冲
    if (this._logs.length >= this._maxLogs) {
      this._logs.shift()
    }
    this._logs.push(logEntry)

    // 更新统计
    this._stats.totalCalls++
    this._stats.totalInputTokens += inputTokens
    this._stats.totalOutputTokens += outputTokens

    const src = logEntry.source
    if (!this._stats.bySource[src]) {
      this._stats.bySource[src] = { calls: 0, inputTokens: 0, outputTokens: 0 }
    }
    this._stats.bySource[src].calls++
    this._stats.bySource[src].inputTokens += inputTokens
    this._stats.bySource[src].outputTokens += outputTokens

    // 推送到前端
    this._pushToRenderer(logEntry)

    // 定期输出统计（每 20 次调用）
    if (this._stats.totalCalls % 20 === 0) {
      this._printStats()
    }

    return logEntry
  }

  /**
   * 记录意图引擎拦截（零 Token 响应）
   */
  recordIntentIntercept() {
    this._stats.intentIntercepted++
  }

  // ═══════════════════════════════════════════
  //  高频低效模式检测
  // ═══════════════════════════════════════════

  /**
   * 获取 session 级别的优化状态
   * @param {string} sessionId
   * @returns {Object}
   */
  getSessionOptimizations(sessionId) {
    if (!this._sessionOptimizations.has(sessionId)) {
      this._sessionOptimizations.set(sessionId, {
        useCompressedPrompt: false, // 是否使用压缩 systemPrompt
        memoryLimit: null,        // 记忆注入上限覆盖
      })
    }
    return this._sessionOptimizations.get(sessionId)
  }



  /**
   * 检查 inputTokens 是否触发优化
   * @param {number} inputTokens
   * @param {string} sessionId
   * @returns {{ shouldCompress: boolean, shouldLimitMemory: boolean, memoryLimit: number }}
   */
  checkOptimizations(inputTokens, sessionId) {
    const opts = this.getSessionOptimizations(sessionId)
    const result = {
      shouldCompress: false,
      shouldLimitMemory: false,
      memoryLimit: 5,
    }

    // systemPrompt 膨胀检测: inputTokens > 3000
    if (inputTokens > 3000) {
      result.shouldCompress = true
      opts.useCompressedPrompt = true
      console.log(`[TokenMonitor] inputTokens=${inputTokens} > 3000, 建议压缩 systemPrompt`)
    }

    // 记忆冗余检测: inputTokens > 2000 时限制记忆数
    if (inputTokens > 2000) {
      result.shouldLimitMemory = true
      result.memoryLimit = 3
      opts.memoryLimit = 3
      console.log(`[TokenMonitor] inputTokens=${inputTokens} > 2000, 限制记忆注入为 Top-3`)
    }

    return result
  }

  /**
   * 检查是否有高频重复输入（5 分钟内 ≥ 2 次相似输入）
   * @param {string} userInput
   * @returns {boolean} 是否应该启用语义缓存
   */
  checkRepeatInput(userInput) {
    const now = Date.now()
    const fiveMinutes = 5 * 60 * 1000

    // 清理过期记录
    this._recentInputs = this._recentInputs.filter(r => now - r.timestamp < fiveMinutes)

    // 检查相似输入
    const normalizedInput = userInput.trim().toLowerCase()
    const similar = this._recentInputs.filter(r =>
      r.text === normalizedInput ||
      (r.text.length > 5 && normalizedInput.includes(r.text)) ||
      (normalizedInput.length > 5 && r.text.includes(normalizedInput))
    )

    // 记录当前输入
    if (this._recentInputs.length >= this._recentInputsMax) {
      this._recentInputs.shift()
    }
    this._recentInputs.push({ text: normalizedInput, timestamp: now })

    if (similar.length >= 1) {
      console.log(`[TokenMonitor] 检测到重复输入 (${similar.length + 1} 次)，建议启用语义缓存`)
      return true
    }
    return false
  }



  // ═══════════════════════════════════════════
  //  统计与报告
  // ═══════════════════════════════════════════

  /**
   * 获取统计摘要
   */
  getStats() {
    const avgInputTokens = this._stats.totalCalls > 0
      ? Math.round(this._stats.totalInputTokens / this._stats.totalCalls)
      : 0
    const avgOutputTokens = this._stats.totalCalls > 0
      ? Math.round(this._stats.totalOutputTokens / this._stats.totalCalls)
      : 0

    return {
      totalCalls: this._stats.totalCalls,
      totalInputTokens: this._stats.totalInputTokens,
      totalOutputTokens: this._stats.totalOutputTokens,
      totalTokens: this._stats.totalInputTokens + this._stats.totalOutputTokens,
      avgInputTokens,
      avgOutputTokens,
      intentIntercepted: this._stats.intentIntercepted,
      tokensSavedByIntent: this._stats.intentIntercepted * avgInputTokens,
      bySource: { ...this._stats.bySource },
      recentLogs: this._logs.slice(-10),
    }
  }

  /**
   * 获取最耗 Token 的调用 Top-N
   * @param {number} n
   * @returns {Array}
   */
  getTopConsumers(n = 10) {
    return [...this._logs]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, n)
      .map(log => ({
        source: log.source,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
        totalTokens: log.totalTokens,
        contextMode: log.contextMode,
        timestamp: new Date(log.timestamp).toLocaleTimeString('zh-CN'),
      }))
  }

  // ═══════════════════════════════════════════
  //  上下文长度追踪
  // ═══════════════════════════════════════════

  /**
   * 记录首次请求的基础上下文长度（Full 模式）
   * @param {Object} breakdown - 各部分长度明细
   * @param {number} breakdown.systemPrompt - 系统提示词长度
   * @param {number} breakdown.envContext - 环境上下文长度
   * @param {number} breakdown.workspaceContext - 工作区上下文长度
   * @param {number} breakdown.memoryContext - 记忆上下文长度
   * @param {number} breakdown.skillListContext - 技能清单长度
   * @param {number} breakdown.skillContext - 激活技能长度
   * @param {number} breakdown.browserContext - 浏览器上下文长度
   * @param {number} breakdown.userInput - 用户输入长度
   * @param {number} breakdown.searchContext - 搜索结果长度
   * @param {number} breakdown.scriptExecContext - 脚本执行结果长度
   * @param {number} breakdown.mentionedSkillContext - 提及技能长度
   */
  recordBaseContext(breakdown) {
    const baseLength = (breakdown.systemPrompt || 0) +
      (breakdown.envContext || 0) +
      (breakdown.workspaceContext || 0) +
      (breakdown.memoryContext || 0) +
      (breakdown.skillListContext || 0) +
      (breakdown.skillContext || 0)

    const incrementalLength = (breakdown.userInput || 0) +
      (breakdown.searchContext || 0) +
      (breakdown.scriptExecContext || 0) +
      (breakdown.browserContext || 0) +
      (breakdown.mentionedSkillContext || 0)

    this._contextStats.baseLength = baseLength
    this._contextStats.baseTokens = this.estimateTokens('x'.repeat(baseLength))
    this._contextStats.incrementalLength = incrementalLength
    this._contextStats.incrementalTokens = this.estimateTokens('x'.repeat(incrementalLength))
    this._contextStats.totalLength = baseLength + incrementalLength
    this._contextStats.totalTokens = this._contextStats.baseTokens + this._contextStats.incrementalTokens
    this._contextStats.breakdown = { ...breakdown }
    this._contextStats.roundCount = 1

    console.log(`[TokenMonitor] 基础上下文: ${baseLength} 字 (~${this._contextStats.baseTokens} tokens), 增量: ${incrementalLength} 字`)
    this._pushContextStats()
  }

  /**
   * 记录后续请求的增量上下文长度（Light 模式）
   * @param {number} incrementSize - 本轮增量长度（字符数）
   * @param {Object} [incrementBreakdown] - 增量明细（可选）
   */
  recordIncrementalContext(incrementSize, incrementBreakdown) {
    this._contextStats.incrementalLength += incrementSize
    this._contextStats.incrementalTokens = this.estimateTokens('x'.repeat(this._contextStats.incrementalLength))
    this._contextStats.totalLength = this._contextStats.baseLength + this._contextStats.incrementalLength
    this._contextStats.totalTokens = this._contextStats.baseTokens + this._contextStats.incrementalTokens
    this._contextStats.roundCount++

    if (incrementBreakdown) {
      // 合并增量明细到 breakdown（累加 userInput、searchContext 等动态部分）
      for (const [key, val] of Object.entries(incrementBreakdown)) {
        if (typeof val === 'number') {
          this._contextStats.breakdown[key] = (this._contextStats.breakdown[key] || 0) + val
        }
      }
    }

    console.log(`[TokenMonitor] 增量 +${incrementSize} 字 (轮次 #${this._contextStats.roundCount}), 总计: ${this._contextStats.totalLength} 字 (~${this._contextStats.totalTokens} tokens)`)
    this._pushContextStats()
  }

  /**
   * 清空增量部分（用户清空对话时调用）
   * 保留基础长度，重置增量
   */
  resetIncrementalContext() {
    this._contextStats.incrementalLength = 0
    this._contextStats.incrementalTokens = 0
    this._contextStats.totalLength = this._contextStats.baseLength
    this._contextStats.totalTokens = this._contextStats.baseTokens
    this._contextStats.roundCount = 0
    // 保留 breakdown 中的基础部分，清空动态部分
    const { systemPrompt, envContext, workspaceContext, memoryContext, skillListContext, skillContext } = this._contextStats.breakdown
    this._contextStats.breakdown = { systemPrompt, envContext, workspaceContext, memoryContext, skillListContext, skillContext }

    console.log(`[TokenMonitor] 增量已重置，保留基础上下文: ${this._contextStats.baseLength} 字`)
    this._pushContextStats()
  }

  /**
   * 获取上下文长度统计
   */
  getContextStats() {
    return { ...this._contextStats }
  }

  /**
   * 推送上下文统计到前端
   */
  _pushContextStats() {
    if (!this._window || this._window.isDestroyed()) return
    try {
      this._window.webContents.send('context:stats', {
        baseLength: this._contextStats.baseLength,
        baseTokens: this._contextStats.baseTokens,
        incrementalLength: this._contextStats.incrementalLength,
        incrementalTokens: this._contextStats.incrementalTokens,
        totalLength: this._contextStats.totalLength,
        totalTokens: this._contextStats.totalTokens,
        roundCount: this._contextStats.roundCount,
        breakdown: this._contextStats.breakdown,
      })
    } catch (e) {
      // 静默失败
    }
  }

  /**
   * 内部打印统计（控制台）
   */
  _printStats() {
    const stats = this.getStats()
    console.log(`[TokenMonitor] ═══ 统计 (${stats.totalCalls} 次调用) ═══`)
    console.log(`  总 Token: ${stats.totalTokens} (输入: ${stats.totalInputTokens}, 输出: ${stats.totalOutputTokens})`)
    console.log(`  平均每次: 输入 ${stats.avgInputTokens}, 输出 ${stats.avgOutputTokens}`)
    console.log(`  意图引擎拦截: ${stats.intentIntercepted} 次 (节省约 ${stats.tokensSavedByIntent} tokens)`)

    for (const [source, data] of Object.entries(stats.bySource)) {
      console.log(`  [${source}] ${data.calls} 次, 输入 ${data.inputTokens}, 输出 ${data.outputTokens}`)
    }
  }

  /**
   * 清空统计数据
   */
  reset() {
    this._logs = []
    this._stats = {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      bySource: {},
      intentIntercepted: 0,
    }
    this._sessionOptimizations.clear()
    this._recentInputs = []
    this._contextStats = {
      baseLength: 0,
      baseTokens: 0,
      incrementalLength: 0,
      incrementalTokens: 0,
      totalLength: 0,
      totalTokens: 0,
      breakdown: {},
      roundCount: 0,
    }
    console.log('[TokenMonitor] 统计数据已重置')
  }
}

module.exports = new TokenMonitor()

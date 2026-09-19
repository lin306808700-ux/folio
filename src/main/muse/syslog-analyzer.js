// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * Syslog 自动分析模块
 * 心跳空闲时分析系统日志，发现行为模式，主动来信洞察
 */

const fs = require('fs')
const path = require('path')
const { callAI } = require('../../shared/ai-client')
const { readSyslog } = require('./syslog')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { writeJournal, writeInsight, updateProfile } = require('./core')
const { sendLetter } = require('./mailbox')
const { SYSLOG_DIR, AI_TIMEOUT_NORMAL } = require('./config')

// 记录上次分析日期，每天最多分析一次
const ANALYSIS_STATE_FILE = path.join(SYSLOG_DIR, '.analysis-state.json')

function loadAnalysisState() {
  try {
    if (fs.existsSync(ANALYSIS_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(ANALYSIS_STATE_FILE, 'utf8'))
    }
  } catch {}
  return { lastAnalyzedDate: null, analysisCount: 0 }
}

function saveAnalysisState(state) {
  try {
    fs.writeFileSync(ANALYSIS_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[Muse] 保存分析状态失败:', err.message)
  }
}

/**
 * 检查今天是否已分析过
 */
function shouldAnalyzeToday() {
  const state = loadAnalysisState()
  const today = new Date().toISOString().slice(0, 10)
  return state.lastAnalyzedDate !== today
}

/**
 * 获取最近 N 天的 syslog 数据
 */
function getRecentSyslogs(days = 3) {
  const logs = []
  const now = new Date()

  for (let i = 0; i < days; i++) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)
    const log = readSyslog(dateStr)
    if (log) {
      logs.push(log)
    }
  }

  return logs
}

/**
 * 压缩 syslog 数据为分析摘要（控制 token 用量）
 */
function compressSyslogForAnalysis(logs) {
  return logs.map(log => {
    const apps = (log.runningApps || []).slice(0, 15).join(', ')
    const tabs = (log.browserTabs || []).slice(0, 10).map(t => t.title).join(' | ')
    const gitCommits = (log.gitLog || []).slice(0, 10).map(g => `${g.datetime?.slice(0, 16)} ${g.subject}`).join('\n')
    const shellCmds = (log.shellHistory || []).slice(-20).join('\n')

    return `【${log.date}】
运行App: ${apps || '无'}
浏览器: ${tabs || '无'}
Git提交:\n${gitCommits || '无'}
Shell命令:\n${shellCmds || '无'}`
  }).join('\n\n---\n\n')
}

/**
 * 分析 syslog 并生成洞察
 */
async function analyzeSyslog() {
  if (!shouldAnalyzeToday()) {
    console.log('[Muse] 📊 今日已分析过 syslog，跳过')
    return { skipped: true }
  }

  const logs = getRecentSyslogs(3)
  if (logs.length === 0) {
    console.log('[Muse] 📊 无可用 syslog 数据')
    return { noData: true }
  }

  console.log('[Muse] 📊 开始分析 syslog，覆盖', logs.length, '天数据')

  const compressed = compressSyslogForAnalysis(logs)
  const context = gatherOwnerContext()

  const prompt = `${SOUL_PROMPT}

你正在分析主人最近几天的系统日志，目标是发现有价值的行为模式和洞察。

【系统日志数据】
${compressed}

【已有主人画像】
${(context.profile || '').slice(0, 500)}

请深度分析，以 JSON 返回：
{
  "patterns": [
    {
      "type": "work_rhythm|interest_shift|tool_usage|project_focus|habit",
      "observation": "你观察到的模式（50字以内）",
      "evidence": "支撑证据（30字以内）"
    }
  ],
  "insights": [
    {
      "title": "洞察标题",
      "content": "对主人有价值的发现或建议（100字以内）",
      "actionable": true/false
    }
  ],
  "profileUpdate": {
    "shouldUpdate": true/false,
    "section": "要更新的画像维度名（如：工作习惯、技术栈、近期关注）",
    "content": "更新内容"
  },
  "shouldNotify": true/false,
  "notifyTitle": "如果值得来信通知，标题是什么",
  "notifyContent": "通知内容（简洁有价值，不要废话）"
}

规则：
- 只报告真正有价值的发现，不要编造
- shouldNotify 只在发现重要模式变化时为 true
- profileUpdate 只在发现新的持久性特征时更新
- 返回纯 JSON`

  try {
    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_NORMAL
    })

    const result = parseMuseResponse(response)
    if (!result) {
      console.log('[Muse] 📊 syslog 分析解析失败')
      return { error: 'parse_failed' }
    }

    // 写入分析日志
    const patternsText = (result.patterns || [])
      .map(p => `- **[${p.type}]** ${p.observation}（${p.evidence}）`)
      .join('\n')
    writeJournal(`**Syslog 自动分析**\n\n${patternsText}`, 'syslog-analysis')

    // 生成洞察报告
    const valuableInsights = (result.insights || []).filter(i => i.actionable)
    if (valuableInsights.length > 0) {
      const insightContent = valuableInsights
        .map(i => `## ${i.title}\n\n${i.content}`)
        .join('\n\n---\n\n')
      writeInsight('行为分析洞察', insightContent)
    }

    // 更新画像
    if (result.profileUpdate?.shouldUpdate && result.profileUpdate.section) {
      updateProfile(result.profileUpdate.section, result.profileUpdate.content)
      console.log('[Muse] 📊 画像已更新:', result.profileUpdate.section)
    }

    // 主动来信
    if (result.shouldNotify && result.notifyTitle) {
      sendLetter({
        title: `📊 ${result.notifyTitle}`,
        content: result.notifyContent,
        priority: 'normal',
        source: 'syslog-analysis'
      })
    }

    // 更新分析状态
    const state = loadAnalysisState()
    state.lastAnalyzedDate = new Date().toISOString().slice(0, 10)
    state.analysisCount = (state.analysisCount || 0) + 1
    saveAnalysisState(state)

    console.log('[Muse] 📊 syslog 分析完成，发现', (result.patterns || []).length, '个模式')
    return { success: true, result }
  } catch (err) {
    console.error('[Muse] 📊 syslog 分析失败:', err.message)
    return { error: err.message }
  }
}

module.exports = {
  analyzeSyslog,
  shouldAnalyzeToday
}

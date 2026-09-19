// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 自主等级管理模块
 * 
 * 实现 Muse 的渐进式自主：从新手期（每次确认）到自主期（事后汇报）
 * 基于任务成功率、领域覆盖度、总任务量等指标自动评估等级
 */

const fs = require('fs')
const path = require('path')
const { MUSE_HOME, AUTONOMY_EVALUATE_INTERVAL } = require('./config')

const AUTONOMY_STATE_FILE = path.join(MUSE_HOME, 'autonomy-state.json')

// 确保目录存在
if (!fs.existsSync(MUSE_HOME)) {
  fs.mkdirSync(MUSE_HOME, { recursive: true })
}

// 等级定义
const LEVELS = {
  0: { name: '新手', desc: '几乎所有任务都需要确认', confirmThreshold: 'all' },
  1: { name: '成长', desc: '简单任务直接执行，复杂任务确认', confirmThreshold: 'complex' },
  2: { name: '成熟', desc: '仅高风险任务确认', confirmThreshold: 'high_risk' },
  3: { name: '自主', desc: '几乎不确认，事后汇报', confirmThreshold: 'none' }
}

// 升级条件
const LEVEL_UP_CRITERIA = {
  0: { minTasks: 10, minDomains: 3, minSuccessRate: 0.60 },
  1: { minTasks: 30, minDomains: 5, minSuccessRate: 0.75 },
  2: { minTasks: 50, minDomains: 8, minSuccessRate: 0.85 },
}

// 滚动窗口大小
const RECENT_TASK_WINDOW = 20

/**
 * 加载状态
 */
function loadState() {
  try {
    if (fs.existsSync(AUTONOMY_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(AUTONOMY_STATE_FILE, 'utf8'))
    }
  } catch (err) {
    console.warn('[Muse] 加载自主等级状态失败:', err.message)
  }
  return {
    level: 0,
    metrics: {
      totalTasks: 0,
      recentResults: [],
      domainCoverage: [],
      totalExplores: 0,
      totalInsights: 0,
    },
    lastEvaluatedAt: null,
    levelHistory: []
  }
}

/**
 * 保存状态
 */
function saveState(state) {
  try {
    fs.writeFileSync(AUTONOMY_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[Muse] 保存自主等级状态失败:', err.message)
  }
}

/**
 * 获取当前自主等级
 */
function getLevel() {
  return loadState().level
}

/**
 * 获取完整状态（含等级信息）
 */
function getState() {
  const state = loadState()
  const levelInfo = LEVELS[state.level] || LEVELS[0]
  return {
    ...state,
    levelName: levelInfo.name,
    levelDesc: levelInfo.desc,
    confirmThreshold: levelInfo.confirmThreshold,
    successRate: calculateSuccessRate(state.metrics.recentResults)
  }
}

/**
 * 计算滚动成功率
 */
function calculateSuccessRate(recentResults) {
  if (!recentResults || recentResults.length === 0) return 0
  const successes = recentResults.filter(r => r.success).length
  return successes / recentResults.length
}

/**
 * 记录任务结果
 * @param {boolean} success - 任务是否成功
 * @param {string} domain - 任务领域（如：前端开发、数据分析）
 */
function recordTaskResult(success, domain) {
  const state = loadState()
  
  // 更新总任务数
  state.metrics.totalTasks = (state.metrics.totalTasks || 0) + 1
  
  // 更新滚动结果窗口
  if (!state.metrics.recentResults) state.metrics.recentResults = []
  state.metrics.recentResults.push({ success, domain, at: new Date().toISOString() })
  if (state.metrics.recentResults.length > RECENT_TASK_WINDOW) {
    state.metrics.recentResults = state.metrics.recentResults.slice(-RECENT_TASK_WINDOW)
  }
  
  // 更新领域覆盖
  if (domain && !state.metrics.domainCoverage.includes(domain)) {
    state.metrics.domainCoverage.push(domain)
  }
  
  saveState(state)
  
  // 每 AUTONOMY_EVALUATE_INTERVAL 次任务评估一次等级
  if (state.metrics.totalTasks % AUTONOMY_EVALUATE_INTERVAL === 0) {
    return evaluateLevel()
  }
  return { evaluated: false, level: state.level }
}

/**
 * 记录探索次数
 */
function recordExplore() {
  const state = loadState()
  state.metrics.totalExplores = (state.metrics.totalExplores || 0) + 1
  saveState(state)
}

/**
 * 记录洞察产出
 */
function recordInsight() {
  const state = loadState()
  state.metrics.totalInsights = (state.metrics.totalInsights || 0) + 1
  saveState(state)
}

/**
 * 评估是否应该升级
 */
function evaluateLevel() {
  const state = loadState()
  const currentLevel = state.level
  const criteria = LEVEL_UP_CRITERIA[currentLevel]
  
  if (!criteria) {
    // 已到最高级
    return { evaluated: true, level: currentLevel, upgraded: false, reason: 'max_level' }
  }
  
  const successRate = calculateSuccessRate(state.metrics.recentResults)
  const totalTasks = state.metrics.totalTasks || 0
  const domainCount = (state.metrics.domainCoverage || []).length
  
  const meetsTasks = totalTasks >= criteria.minTasks
  const meetsDomains = domainCount >= criteria.minDomains
  const meetsSuccessRate = successRate >= criteria.minSuccessRate
  
  if (meetsTasks && meetsDomains && meetsSuccessRate) {
    // 升级
    const newLevel = currentLevel + 1
    state.level = newLevel
    state.lastEvaluatedAt = new Date().toISOString()
    state.levelHistory = state.levelHistory || []
    state.levelHistory.push({
      from: currentLevel,
      to: newLevel,
      at: new Date().toISOString(),
      metrics: {
        totalTasks,
        successRate: Math.round(successRate * 100) / 100,
        domainCount,
        totalExplores: state.metrics.totalExplores || 0,
        totalInsights: state.metrics.totalInsights || 0
      }
    })
    saveState(state)
    
    const levelInfo = LEVELS[newLevel]
    console.log(`[Muse] 🎉 自主等级提升: ${currentLevel} → ${newLevel} (${levelInfo.name})`)
    return { 
      evaluated: true, 
      upgraded: true, 
      from: currentLevel, 
      to: newLevel,
      levelName: levelInfo.name,
      levelDesc: levelInfo.desc
    }
  }
  
  state.lastEvaluatedAt = new Date().toISOString()
  saveState(state)
  
  return { 
    evaluated: true, 
    upgraded: false, 
    level: currentLevel,
    reason: 'criteria_not_met',
    progress: {
      tasks: `${totalTasks}/${criteria.minTasks}`,
      domains: `${domainCount}/${criteria.minDomains}`,
      successRate: `${Math.round(successRate * 100)}%/${Math.round(criteria.minSuccessRate * 100)}%`
    }
  }
}

/**
 * 根据自主等级决定是否需要执行前确认
 * @param {Object} taskStrategy - AI 分析的任务策略
 * @returns {boolean} 是否需要确认
 */
function shouldConfirmBeforeExec(taskStrategy) {
  const state = loadState()
  const threshold = LEVELS[state.level]?.confirmThreshold || 'all'
  
  switch (threshold) {
    case 'all':
      // 新手期：所有非 trivial 任务都需要确认
      return taskStrategy.needsConfirmBeforeExec !== false
    
    case 'complex':
      // 成长期：简单任务直接执行，复杂/跨领域确认
      if (taskStrategy.shouldSplit && taskStrategy.subtasks?.length > 2) return true
      if (taskStrategy.needsOwnerDecision) return true
      return taskStrategy.needsConfirmBeforeExec === true
    
    case 'high_risk':
      // 成熟期：仅高风险确认（不可逆操作、大量修改）
      if (taskStrategy.needsOwnerDecision) return true
      return false
    
    case 'none':
      // 自主期：几乎不确认
      return false
    
    default:
      return true
  }
}

module.exports = {
  getLevel,
  getState,
  recordTaskResult,
  recordExplore,
  recordInsight,
  evaluateLevel,
  shouldConfirmBeforeExec,
  LEVELS,
  AUTONOMY_STATE_FILE
}

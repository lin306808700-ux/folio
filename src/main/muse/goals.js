'use strict'

/**
 * 目标管理模块
 * 
 * Muse 的长期目标系统。与单次任务（tasks.js）不同，Goal 是持续性的：
 * - 一个目标可以驱动多次探索步骤
 * - 每次探索的洞察积累在目标下
 * - 目标完成后，积累的知识沉淀为结构化记忆
 */

const fs = require('fs')
const path = require('path')
const { MUSE_HOME } = require('./config')

const GOALS_FILE = path.join(MUSE_HOME, 'goals.json')

// 确保目录存在
if (!fs.existsSync(MUSE_HOME)) {
  fs.mkdirSync(MUSE_HOME, { recursive: true })
}

/**
 * 加载所有目标
 */
function loadGoals() {
  try {
    if (fs.existsSync(GOALS_FILE)) {
      return JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'))
    }
  } catch (err) {
    console.warn('[Muse] 加载目标列表失败:', err.message)
  }
  return []
}

/**
 * 保存目标列表
 */
function saveGoals(goals) {
  try {
    fs.writeFileSync(GOALS_FILE, JSON.stringify(goals, null, 2), 'utf8')
  } catch (err) {
    console.error('[Muse] 保存目标列表失败:', err.message)
  }
}

/**
 * 创建新目标
 */
function createGoal(title, description, direction = '') {
  const goals = loadGoals()
  const goal = {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description: description || '',
    direction: direction || title,
    status: 'active',
    autonomyLevel: 0,
    exploreSteps: [],
    relatedDomain: direction || '',
    insights: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  goals.unshift(goal)
  saveGoals(goals)
  console.log('[Muse] 🎯 目标已创建:', goal.id, title)
  return goal
}

/**
 * 获取活跃目标
 */
function getActiveGoals() {
  return loadGoals().filter(g => g.status === 'active')
}

/**
 * 按 ID 获取目标
 */
function getById(id) {
  return loadGoals().find(g => g.id === id) || null
}

/**
 * 更新目标
 */
function updateGoal(id, updates) {
  const goals = loadGoals()
  const goal = goals.find(g => g.id === id)
  if (!goal) return false

  const cleanUpdates = {}
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) cleanUpdates[key] = value
  }
  Object.assign(goal, cleanUpdates, { updatedAt: new Date().toISOString() })
  saveGoals(goals)
  return true
}

/**
 * 删除目标
 */
function deleteGoal(id) {
  const goals = loadGoals().filter(g => g.id !== id)
  saveGoals(goals)
  return true
}

/**
 * 获取目标的下一个未探索步骤
 * @returns {Object|null} { topic, stepIndex } 或 null
 */
function getNextExploreStep(goalId) {
  const goal = getById(goalId)
  if (!goal) return null

  const pendingStep = (goal.exploreSteps || []).find(s => s.status === 'pending')
  if (pendingStep) {
    const stepIndex = goal.exploreSteps.indexOf(pendingStep)
    return { topic: pendingStep.topic, stepIndex }
  }

  return null
}

/**
 * 添加探索步骤到目标
 */
function addExploreStep(goalId, topic) {
  const goal = getById(goalId)
  if (!goal) return null

  if (!goal.exploreSteps) goal.exploreSteps = []
  const step = {
    topic,
    status: 'pending',
    insightId: null,
    at: new Date().toISOString()
  }
  goal.exploreSteps.push(step)
  updateGoal(goalId, { exploreSteps: goal.exploreSteps })
  return step
}

/**
 * 完成探索步骤，记录洞察
 */
function completeExploreStep(goalId, stepIndex, insight) {
  const goal = getById(goalId)
  if (!goal || !goal.exploreSteps[stepIndex]) return false

  goal.exploreSteps[stepIndex].status = 'completed'
  goal.exploreSteps[stepIndex].insightId = insight?.id || null
  goal.exploreSteps[stepIndex].completedAt = new Date().toISOString()

  // 记录洞察摘要
  if (insight) {
    if (!goal.insights) goal.insights = []
    goal.insights.push({
      title: insight.title || insight.summary?.slice(0, 60) || '',
      summary: insight.summary || '',
      stepIndex,
      at: new Date().toISOString()
    })
  }

  updateGoal(goalId, {
    exploreSteps: goal.exploreSteps,
    insights: goal.insights
  })

  console.log(`[Muse] 🎯 目标 ${goalId} 步骤 ${stepIndex} 已完成`)
  return true
}

/**
 * 标记目标完成
 */
function completeGoal(goalId) {
  return updateGoal(goalId, {
    status: 'completed',
    completedAt: new Date().toISOString()
  })
}

/**
 * 暂停目标
 */
function pauseGoal(goalId) {
  return updateGoal(goalId, { status: 'paused' })
}

/**
 * 恢复目标
 */
function resumeGoal(goalId) {
  return updateGoal(goalId, { status: 'active' })
}

/**
 * 检查目标是否所有步骤都已完成
 */
function areAllStepsCompleted(goalId) {
  const goal = getById(goalId)
  if (!goal || !goal.exploreSteps || goal.exploreSteps.length === 0) return false
  return goal.exploreSteps.every(s => s.status === 'completed')
}

/**
 * 获取目标进度摘要
 */
function getGoalProgress(goalId) {
  const goal = getById(goalId)
  if (!goal) return null

  const steps = goal.exploreSteps || []
  const completed = steps.filter(s => s.status === 'completed').length
  const total = steps.length

  return {
    id: goal.id,
    title: goal.title,
    direction: goal.direction,
    status: goal.status,
    totalSteps: total,
    completedSteps: completed,
    insights: (goal.insights || []).length,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt
  }
}

module.exports = {
  GOALS_FILE,
  loadGoals,
  saveGoals,
  createGoal,
  getActiveGoals,
  getById,
  updateGoal,
  deleteGoal,
  getNextExploreStep,
  addExploreStep,
  completeExploreStep,
  completeGoal,
  pauseGoal,
  resumeGoal,
  areAllStepsCompleted,
  getGoalProgress
}

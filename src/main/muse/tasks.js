'use strict'

const fs = require('fs')
const { TASKS_FILE, MAX_FEEDBACK_HISTORY, MAX_MODIFICATION_HISTORY } = require('./config')

// 延迟加载 archive 模块，避免循环依赖（archive.js 也引用了 tasks.js）
let _archiveCompletedTask = null
function getArchiveCompletedTask() {
  if (!_archiveCompletedTask) {
    _archiveCompletedTask = require('./archive').archiveCompletedTask
  }
  return _archiveCompletedTask
}

// 启动清理标志：首次 loadTasks 时将 executing 状态的残留任务标记为 failed
let _startupCleanupDone = false

/**
 * 加载任务清单
 */
function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf8')
      const tasks = JSON.parse(data)

      // 启动清理：重启后 executing 状态的任务不可能还在运行，标记为 failed
      if (!_startupCleanupDone) {
        _startupCleanupDone = true
        let cleaned = false
        for (const task of tasks) {
          if (task.status === 'executing') {
            task.status = 'failed'
            task.error = '客户端重启，任务执行被中断'
            task.completedAt = new Date().toISOString()
            cleaned = true
            console.log('[Muse] 🧹 启动清理: 将中断的任务标记为 failed:', task.id)
          }
        }
        if (cleaned) {
          fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8')
        }
      }

      return tasks
    }
  } catch (err) {
    console.warn('[Muse] 加载任务清单失败:', err.message)
  }
  return []
}

/**
 * 保存任务清单
 */
function saveTasks(tasks) {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8')
    console.log('[Muse] 任务清单已保存，共', tasks.length, '个任务')
  } catch (err) {
    console.error('[Muse] 保存任务清单失败:', err.message)
  }
}

/**
 * 添加任务到清单
 */
function addTask(command, priority = 'high', options = {}) {
  const tasks = loadTasks()
  const task = {
    id: options.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    command,
    priority,
    status: options.status || 'pending',
    type: options.type || 'normal',
    parentId: options.parentId || null,
    subtasks: [],
    createdAt: options.createdAt || new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    suspendedAt: null,
    suspendReason: null,
    result: null,
    error: null,
    attempts: 0,
    feedbackHistory: [],
    modificationHistory: [],
    // 限制历史长度
    _maxFeedbackHistory: MAX_FEEDBACK_HISTORY,
    _maxModificationHistory: MAX_MODIFICATION_HISTORY
  }
  tasks.unshift(task)
  saveTasks(tasks)
  console.log('[Muse] 📝 任务已加入清单:', task.id, options.type ? `(${options.type})` : '')
  return task
}

/**
 * 获取待执行任务（按优先级排序：high > normal > low）
 */
function getPendingTask() {
  const tasks = loadTasks()
  const priorityOrder = { high: 0, normal: 1, low: 2 }
  const pendingTasks = tasks
    .filter(t => t.status === 'pending' && !t.parentId)
    .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1))
  return pendingTasks[0] || null
}

/**
 * 更新任务状态
 */
function updateTaskStatus(taskId, updates) {
  const tasks = loadTasks()
  const task = tasks.find(t => t.id === taskId)
  if (!task) {
    console.warn('[Muse] 任务不存在:', taskId)
    return false
  }
  
  // 状态流转校验：防止非法状态跳转
  const VALID_TRANSITIONS = {
    pending: ['executing', 'completed', 'cancelled', 'suspended', 'waiting_reply'],
    executing: ['completed', 'failed', 'suspended', 'waiting_reply', 'pending'],
    completed: ['pending'], // 仅允许追加修改时回到 pending
    failed: ['pending', 'cancelled'], // 允许重试
    suspended: ['pending', 'cancelled'],
    waiting_reply: ['executing', 'pending', 'cancelled'],
  }
  if (updates.status && updates.status !== task.status) {
    const allowed = VALID_TRANSITIONS[task.status]
    if (allowed && !allowed.includes(updates.status)) {
      console.warn(`[Muse] ⚠️ 非法状态流转: ${task.status} → ${updates.status} (任务 ${taskId})`)
      return false
    }
  }

  // 过滤掉 undefined 值，防止意外覆盖已有字段
  const cleanUpdates = {}
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleanUpdates[key] = value
    }
  }
  Object.assign(task, cleanUpdates)
  
  // 限制历史数组长度
  if (task.feedbackHistory && task.feedbackHistory.length > MAX_FEEDBACK_HISTORY) {
    task.feedbackHistory = task.feedbackHistory.slice(-MAX_FEEDBACK_HISTORY)
  }
  if (task.modificationHistory && task.modificationHistory.length > MAX_MODIFICATION_HISTORY) {
    task.modificationHistory = task.modificationHistory.slice(-MAX_MODIFICATION_HISTORY)
  }
  
  // 即时归档已关闭，所有任务保留在活跃列表
  // 归档由定时任务（heartbeat 中的 archiveOldTasks）统一处理
  saveTasks(tasks)
  
  if (cleanUpdates.status) {
    console.log('[Muse] 任务状态已更新:', taskId, cleanUpdates.status)
  } else {
    console.log('[Muse] 任务字段已更新:', taskId, Object.keys(cleanUpdates).join(', '))
  }
  return true
}

/**
 * 添加子任务到父任务
 */
function addSubtask(parentId, subtaskCommand, options = {}) {
  const tasks = loadTasks()
  const parentTask = tasks.find(t => t.id === parentId)
  if (!parentTask) {
    console.warn('[Muse] 父任务不存在:', parentId)
    return null
  }

  // 检查父任务是否已经是子任务（防止嵌套超过 1 层）
  if (parentTask.parentId) {
    console.error('[Muse] ❌ 不允许创建子任务的子任务，父任务:', parentId, '深度:', parentTask.depth || 0)
    return null
  }

  // 计算子任务执行顺序
  const existingSubtasks = tasks.filter(t => t.parentId === parentId)
  const executionOrder = existingSubtasks.length + 1

  const subtask = {
    id: options.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    command: subtaskCommand,
    priority: options.priority || 'normal',
    status: options.status || 'pending',
    type: 'subtask',
    parentId: parentId,
    rootId: parentTask.rootId || parentId,
    depth: 1,
    executionOrder,
    subtasks: [],
    createdAt: options.createdAt || new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    suspendedAt: null,
    suspendReason: null,
    result: null,
    error: null,
    attempts: 0,
    feedbackHistory: [],
    modificationHistory: []
  }

  tasks.unshift(subtask)

  if (!parentTask.subtasks) parentTask.subtasks = []
  parentTask.subtasks.push(subtask.id)
  
  if (!parentTask.rootId) parentTask.rootId = parentId
  if (!parentTask.depth) parentTask.depth = 0
  
  saveTasks(tasks)

  console.log('[Muse] 📎 子任务已添加:', subtask.id, '-> 父任务:', parentId, '顺序:', executionOrder)
  return subtask
}

/**
 * 获取父任务的所有子任务
 */
function getSubtasks(parentId) {
  const tasks = loadTasks()
  return tasks.filter(t => t.parentId === parentId)
}

/**
 * 检查父任务的所有子任务是否完成
 */
function areAllSubtasksCompleted(parentId) {
  const subtasks = getSubtasks(parentId)
  if (subtasks.length === 0) return false
  return subtasks.every(t => t.status === 'completed')
}

/**
 * 挂起任务
 */
function suspendTask(taskId, reason) {
  return updateTaskStatus(taskId, {
    status: 'suspended',
    suspendedAt: new Date().toISOString(),
    suspendReason: reason
  })
}

/**
 * 恢复任务
 */
function resumeTask(taskId) {
  return updateTaskStatus(taskId, {
    status: 'pending',
    suspendedAt: null,
    suspendReason: null
  })
}

module.exports = {
  TASKS_FILE,
  loadTasks,
  saveTasks,
  addTask,
  getPendingTask,
  updateTaskStatus,
  addSubtask,
  getSubtasks,
  areAllSubtasksCompleted,
  suspendTask,
  resumeTask
}

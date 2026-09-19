// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const path = require('path')
const fs = require('fs')
const { app } = require('electron')

/**
 * 任务状态管理
 * 内存存储 + JSON 文件持久化
 */

class TaskStateManager {
  constructor(options = {}) {
    // 内存中的任务存储
    this.tasks = new Map();
    
    // 任务历史（已完成的任务）
    this.taskHistory = [];
    this.maxHistorySize = 50;

    // 持久化相关
    this._persistPath = options.persistPath || null
    this._persistTimer = null
    this._persistDelay = options.persistDelay ?? 500 // debounce 500ms
  }

  /**
   * 获取持久化文件路径（懒初始化，避免 app 未 ready 时调用）
   */
  _getPersistPath() {
    if (!this._persistPath) {
      const dataDir = path.join(app.getPath('userData'), 'data')
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }
      this._persistPath = path.join(dataDir, 'task-history.json')
    }
    return this._persistPath
  }

  /**
   * 从磁盘加载持久化数据
   */
  loadPersistedData() {
    try {
      const filePath = this._getPersistPath()
      if (!fs.existsSync(filePath)) {
        console.log('[TaskState] 无持久化文件，跳过加载')
        return []
      }

      const raw = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw)

      // 恢复任务历史
      if (Array.isArray(data.taskHistory)) {
        this.taskHistory = data.taskHistory.slice(0, this.maxHistorySize)
        console.log('[TaskState] 加载任务历史:', this.taskHistory.length, '条')
      }

      this.tasks.clear()

      // 恢复未完成任务（pending / running / paused 状态）
      if (Array.isArray(data.unfinishedTasks)) {
        for (const task of data.unfinishedTasks) {
          if (!task || !task.id || !task.plan || !Array.isArray(task.plan.steps)) continue
          // 将 running 状态标记为 paused（重启后不可能还在运行）
          if (task.status === 'running') {
            task.status = 'paused'
            task.pauseReason = 'restart'
          }
          task.context = task.context || task.contextSummary || {}
          task.results = Array.isArray(task.results) ? task.results : []
          task.currentStepIndex = Number.isInteger(task.currentStepIndex) ? task.currentStepIndex : 0
          task.pausedAtStep = Number.isInteger(task.pausedAtStep) ? task.pausedAtStep : task.currentStepIndex
          this.tasks.set(task.id, task)
        }
        console.log('[TaskState] 恢复未完成任务:', this.tasks.size, '个')
      }
      return Array.from(this.tasks.values())
    } catch (e) {
      console.warn('[TaskState] 加载持久化数据失败:', e.message)
      return []
    }
  }

  /**
   * 持久化到磁盘（debounce）
   */
  _schedulePersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer)
    }
    this._persistTimer = setTimeout(() => {
      this._persistToDisk()
    }, this._persistDelay)
  }

  /**
   * 立即写盘
   */
  _persistToDisk() {
    let tempPath = null
    try {
      const filePath = this._getPersistPath()

      // 收集未完成任务（排除已完成/已取消/已失败的）
      const unfinishedTasks = Array.from(this.tasks.values())
        .filter(task => ['pending', 'running', 'paused'].includes(task.status))
        .map(task => ({
        id: task.id,
        plan: task.plan,
        status: task.status,
        currentStepIndex: task.currentStepIndex,
        pausedAtStep: task.pausedAtStep,
        context: this._makeSerializable(task.context || {}),
        results: this._makeSerializable(task.results || []),
        pendingConfirmation: this._makeSerializable(task.pendingConfirmation),
        isTrusted: !!task.isTrusted,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        pauseReason: task.pauseReason || null,
        pauseError: task.pauseError || null
      }))

      const data = {
        version: 1,
        savedAt: Date.now(),
        taskHistory: this.taskHistory,
        unfinishedTasks
      }

      tempPath = `${filePath}.tmp-${process.pid}`
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
      fs.renameSync(tempPath, filePath)
      tempPath = null
    } catch (e) {
      console.warn('[TaskState] 持久化失败:', e.message)
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath) } catch {}
      }
    }
  }

  flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer)
      this._persistTimer = null
    }
    this._persistToDisk()
  }

  dispose() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer)
      this._persistTimer = null
    }
  }

  /**
   * 提取 context 的轻量摘要，避免序列化循环引用
   */
  _buildContextSummary(context) {
    if (!context) return {}
    const summary = {}
    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'object' && value !== null) {
        summary[key] = {
          success: value.success,
          hasData: !!value.data,
          skipped: value.skipped || false
        }
      } else {
        summary[key] = value
      }
    }
    return summary
  }

  _makeSerializable(value) {
    const seen = new WeakSet()
    const serialized = JSON.stringify(value, (key, item) => {
      if (typeof item === 'bigint') return item.toString()
      if (typeof item === 'function' || typeof item === 'symbol') return undefined
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]'
        seen.add(item)
      }
      return item
    })
    return serialized === undefined ? null : JSON.parse(serialized)
  }

  trackTask(task) {
    this.tasks.set(task.id, task)
    this._schedulePersist()
    return task
  }

  touchTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return { success: false, error: '任务不存在' }
    task.updatedAt = Date.now()
    this._schedulePersist()
    return { success: true }
  }

  /**
   * 获取未完成的任务（供前端启动时查询）
   */
  getUnfinishedTasks() {
    return Array.from(this.tasks.values())
      .filter(t => ['pending', 'running', 'paused'].includes(t.status))
      .map(t => ({
        id: t.id,
        originalInput: t.plan?.originalInput || '',
        taskName: t.plan?.taskName || '',
        status: t.status,
        pauseReason: t.pauseReason || null,
        stepCount: t.plan?.steps?.length || 0,
        completedSteps: t.results?.length || 0,
        currentStepIndex: t.currentStepIndex,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt
      }))
  }

  /**
   * 清除指定的未完成任务
   */
  clearUnfinishedTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      return { success: false, error: '任务不存在' }
    }
    task.status = 'cancelled'
    task.completedAt = Date.now()
    this._addToHistory(task)
    this.tasks.delete(taskId)
    this._schedulePersist()
    return { success: true }
  }

  /**
   * 清除所有未完成任务
   */
  clearAllUnfinished() {
    const count = this.tasks.size
    for (const task of this.tasks.values()) {
      task.status = 'cancelled'
      task.completedAt = Date.now()
      this._addToHistory(task)
    }
    this.tasks.clear()
    this._schedulePersist()
    return { success: true, cleared: count }
  }

  /**
   * 创建新任务
   */
  createTask(plan) {
    const task = {
      id: plan.id,
      plan: plan,
      status: 'pending',
      currentStepIndex: -1,
      context: {},
      results: [],
      pendingConfirmation: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null
    };

    this.tasks.set(task.id, task);
    this._schedulePersist()
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * 更新任务状态
   */
  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    Object.assign(task, updates, { updatedAt: Date.now() });
    this._schedulePersist()
    return { success: true, task };
  }

  /**
   * 更新步骤结果
   */
  addStepResult(taskId, stepId, result) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    task.context[stepId] = result.data;
    task.results.push({
      stepId,
      result,
      timestamp: Date.now()
    });
    task.updatedAt = Date.now();
    this._schedulePersist()

    return { success: true };
  }

  /**
   * 设置等待确认状态
   */
  setPendingConfirmation(taskId, step, preview) {
    return this.updateTask(taskId, {
      status: 'paused',
      pendingConfirmation: { step, preview }
    });
  }

  /**
   * 清除等待确认状态
   */
  clearPendingConfirmation(taskId) {
    return this.updateTask(taskId, {
      status: 'running',
      pendingConfirmation: null
    });
  }

  /**
   * 完成任务
   */
  completeTask(taskId, summary) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    task.status = 'completed';
    task.summary = summary;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this._addToHistory(task);
    this.tasks.delete(taskId);
    this._schedulePersist()

    return { success: true, task };
  }

  /**
   * 失败任务
   */
  failTask(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    task.status = 'failed';
    task.error = error;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this._addToHistory(task);
    this.tasks.delete(taskId);
    this._schedulePersist()

    return { success: true, task };
  }

  /**
   * 取消任务
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: '任务不存在' };
    }

    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    this._addToHistory(task);
    this.tasks.delete(taskId);
    this._schedulePersist()

    return { success: true, task };
  }

  /**
   * 获取所有活跃任务
   */
  getActiveTasks() {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取任务历史
   */
  getTaskHistory(limit = 20) {
    return this.taskHistory.slice(0, limit);
  }

  /**
   * 清理旧任务（保留最近 N 个活跃任务）
   */
  cleanupOldTasks(maxActive = 10) {
    const activeTasks = this.getActiveTasks();
    if (activeTasks.length <= maxActive) {
      return { cleaned: 0 };
    }

    const sorted = activeTasks.sort((a, b) => b.updatedAt - a.updatedAt);
    const toRemove = sorted.slice(maxActive);

    for (const task of toRemove) {
      this.cancelTask(task.id);
    }

    return { cleaned: toRemove.length };
  }

  /**
   * 添加到历史
   */
  _addToHistory(task) {
    const historyEntry = {
      id: task.id,
      originalInput: task.plan?.originalInput || '',
      taskName: task.plan?.taskName || '',
      status: task.status,
      stepCount: task.plan?.steps?.length || 0,
      completedSteps: task.results?.length || 0,
      summary: task.summary,
      error: task.error,
      createdAt: task.createdAt,
      completedAt: task.completedAt
    };

    this.taskHistory.unshift(historyEntry);

    if (this.taskHistory.length > this.maxHistorySize) {
      this.taskHistory = this.taskHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const active = this.getActiveTasks();
    const history = this.taskHistory;

    return {
      activeCount: active.length,
      totalCompleted: history.filter(t => t.status === 'completed').length,
      totalFailed: history.filter(t => t.status === 'failed').length,
      totalCancelled: history.filter(t => t.status === 'cancelled').length,
      averageSteps: history.length > 0 
        ? history.reduce((sum, t) => sum + t.stepCount, 0) / history.length 
        : 0
    };
  }
}

const taskStateManager = new TaskStateManager()
module.exports = taskStateManager
module.exports.TaskStateManager = TaskStateManager

/**
 * 任务执行引擎（精简版）
 * 保留 Executor + StateManager，供 self-check 使用
 * 规划和浏览器路由已迁移到 muse/router.js
 */

const executor = require('./executor');
const stateManager = require('./state');
const toolRegistry = require('./tools');
const { Memories } = require('../database');

class TaskEngine {
  constructor() {
    this.executor = executor;
    this.stateManager = stateManager;
    this.toolRegistry = toolRegistry;
    
    const memoryTool = this.toolRegistry.get('memory');
    if (memoryTool && Memories) {
      memoryTool.setDatabase(Memories);
    }
  }

  /**
   * 确认并继续执行任务
   */
  async confirmTask(taskId, confirmed, callbacks = {}) {
    return await this.executor.confirmAndContinue(taskId, confirmed, callbacks);
  }

  cancelTask(taskId) {
    const result = this.executor.cancel(taskId);
    if (result.success) {
      this.stateManager.cancelTask(taskId);
    }
    return result;
  }

  getTaskStatus(taskId) {
    return this.executor.getTaskStatus(taskId);
  }

  getActiveTasks() {
    return this.stateManager.getActiveTasks();
  }

  getTaskHistory(limit = 20) {
    return this.stateManager.getTaskHistory(limit);
  }

  getStats() {
    return this.stateManager.getStats();
  }

  restoreTasks(tasks) {
    return this.executor.restoreTasks(tasks)
  }

  async pause(taskId) {
    const result = this.executor.pause(taskId);
    if (result.success) {
      this.stateManager.updateTask(taskId, { status: 'paused', pauseReason: 'manual' });
    }
    return result;
  }

  async resume(taskId, modifiedSteps = null, callbacks = {}) {
    const result = await this.executor.resume(taskId, modifiedSteps, callbacks);
    if (result.success) {
      this.stateManager.updateTask(taskId, { status: 'running' });
    }
    return result;
  }
}

module.exports = new TaskEngine();

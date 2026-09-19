// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const toolRegistry = require('./tools');
const { callAI } = require('../../shared/ai-client');
const errorHandler = require('./error-handler');
const environmentContext = require('./environment-context');
const { evaluateCondition } = require('./executor-utils');
const { resolveParams } = require('./param-resolver');
const stateManager = require('./state');

/**
 * 任务执行器
 * 管理步骤执行流程，处理安全确认，维护执行状态
 */

class TaskExecutor {
  constructor() {
    this.activeTasks = new Map();
    this._pauseRequests = new Set();
  }

  restoreTasks(tasks = []) {
    let restored = 0;
    for (const task of tasks) {
      if (!task || !task.id || task.status !== 'paused') continue;
      this.activeTasks.set(task.id, task);
      restored++;
    }
    return { restored };
  }

  _consumePauseRequest(taskId) {
    if (!this._pauseRequests.has(taskId)) return false;
    this._pauseRequests.delete(taskId);
    return true;
  }

  /**
   * 暂停当前正在执行的任务
   * @param {string} taskId - 要暂停的任务 ID
   * @returns {{ success: boolean, error?: string }}
   */
  pause(taskId) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { success: false, error: '任务不存在或已结束' };
    }

    if (taskState.status !== 'running') {
      return { success: false, error: `任务当前状态为 ${taskState.status}，无法暂停` };
    }

    // 设置暂停请求标记
    this._pauseRequests.add(taskId);
    taskState.status = 'paused';
    taskState.pauseReason = 'manual';
    taskState.pausedAtStep = taskState.currentStepIndex;
    stateManager.touchTask(taskId);

    console.log(`[Executor] 任务 ${taskId} 收到暂停请求，将在下一个步骤前暂停`);
    return { success: true };
  }

  /**
   * 恢复暂停的任务
   * @param {string} taskId - 要恢复的任务 ID
   * @param {Array} modifiedSteps - 可选，修改后的步骤列表
   * @param {Object} callbacks - 回调函数
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async resume(taskId, modifiedSteps, callbacks = {}) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { success: false, error: '任务不存在或已结束' };
    }

    if (taskState.status !== 'paused') {
      return { success: false, error: `任务当前状态为 ${taskState.status}，不在暂停状态` };
    }

    // 如果提供了修改后的步骤，更新任务计划
    if (modifiedSteps && Array.isArray(modifiedSteps)) {
      taskState.plan.steps = modifiedSteps;
      console.log(`[Executor] 任务 ${taskId} 使用修改后的步骤列表，共 ${modifiedSteps.length} 步`);
    }

    console.log(`[Executor] 任务 ${taskId} 恢复执行，从步骤 ${taskState.pausedAtStep} 继续`);

    // 使用已有的 _retryFromPause 逻辑恢复执行
    return await this._retryFromPause(taskId, callbacks);
  }

  /**
   * 执行任务计划
   */
  async execute(plan, callbacks = {}) {
    const taskId = plan.id;

    const taskState = {
      id: taskId,
      plan: plan,
      currentStepIndex: 0,
      context: {},
      status: 'running',
      pendingConfirmation: null,
      results: [],
      isTrusted: plan.needConfirm === false
    };
    
    this.activeTasks.set(taskId, taskState);
    stateManager.trackTask(taskState);
    
    try {
      const loopResult = await this._executeStepLoop(taskState, 0, callbacks);
      
      if (loopResult.status !== 'done') {
        return loopResult;
      }
      
      // 任务完成
      taskState.status = 'completed';
      const summary = await this._generateSummary(plan, taskState.context);
      
      if (callbacks.onComplete) {
        callbacks.onComplete(summary, taskState.context);
      }
      
      this.activeTasks.delete(taskId);
      stateManager.completeTask(taskId, summary);
      
      return {
        status: 'completed',
        taskId: taskId,
        summary: summary,
        context: taskState.context
      };
      
    } catch (error) {
      return await this._handleExecutionError(error, taskState, callbacks);
    }
  }

  /**
   * 确认并继续执行
   */
  async confirmAndContinue(taskId, confirmed, callbacks = {}) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { success: false, error: '任务不存在或已结束' };
    }

    if (taskState.status !== 'paused') {
      return { success: false, error: '任务不在等待确认状态' };
    }

    // 处理步骤失败后的编辑场景
    if (taskState.pauseReason === 'step_error') {
      if (!confirmed) {
        taskState.status = 'cancelled';
        this.activeTasks.delete(taskId);
        return { success: false, status: 'cancelled', message: '用户取消了任务' };
      }
      
      // 用户提供了修改后的步骤
      if (callbacks.modifiedStep) {
        const failedStepIndex = taskState.pausedAtStep;
        const modifiedStep = callbacks.modifiedStep;
        
        // 更新任务计划中的失败步骤
        if (taskState.plan.steps[failedStepIndex]) {
          taskState.plan.steps[failedStepIndex] = {
            ...taskState.plan.steps[failedStepIndex],
            ...modifiedStep
          };
        }
      }
      
      // 从失败步骤重新执行
      return await this._retryFromPause(taskId, callbacks);
    }

    // 处理错误暂停状态（非确认型暂停）
    if (!taskState.pendingConfirmation) {
      if (!confirmed) {
        taskState.status = 'cancelled';
        this.activeTasks.delete(taskId);
        stateManager.cancelTask(taskId);
        return { success: false, status: 'cancelled', message: '用户取消了操作' };
      }
      // 用户选择继续，从暂停位置重试
      return await this._retryFromPause(taskId, callbacks);
    }

    if (!confirmed) {
      taskState.status = 'cancelled';
      this.activeTasks.delete(taskId);
      stateManager.cancelTask(taskId);
      return { success: false, status: 'cancelled', message: '用户取消了操作' };
    }

    const { step, result } = taskState.pendingConfirmation;
    
    try {
      let confirmResult;
      
      if (step.tool === 'file' && step.method === 'writeFile') {
        const fileTool = toolRegistry.get('file');
        confirmResult = await fileTool.confirmWriteFile(
          result.preview.path,
          result.preview.fullContent || result.preview.content
        );
      } else if (step.tool === 'file' && step.method === 'deleteFile') {
        const fileTool = toolRegistry.get('file');
        confirmResult = await fileTool.confirmDeleteFile(result.preview.path);
      } else if (step.tool === 'command') {
        const commandTool = toolRegistry.get('command');
        confirmResult = await commandTool.confirmExecute(result.preview.command);
      }

      if (!confirmResult || !confirmResult.success) {
        throw new Error(confirmResult?.error || '确认执行失败');
      }

      taskState.context[step.id] = confirmResult.data;
      taskState.results.push({ step, result: confirmResult });

      taskState.status = 'running';
      taskState.pendingConfirmation = null;

      // 继续执行后续步骤
      return await this._continueExecution(taskId, callbacks);
      
    } catch (error) {
      taskState.status = 'failed';
      this.activeTasks.delete(taskId);
      
      if (callbacks.onError) {
        callbacks.onError(error, taskState.currentStepIndex);
      }
      
      return {
        status: 'failed',
        taskId: taskId,
        error: error.message
      };
    }
  }

  /**
   * 从暂停位置重试执行
   */
  async _retryFromPause(taskId, callbacks = {}) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { success: false, error: '任务不存在' };
    }

    if (taskState.status !== 'paused') {
      return { success: false, error: '任务不在暂停状态' };
    }

    // 重置状态为运行中
    taskState.status = 'running';
    const pausedStepIndex = taskState.pausedAtStep ?? taskState.currentStepIndex;
    taskState.pausedAtStep = null;
    taskState.pauseReason = null;
    taskState.pauseError = null;
    taskState.pauseErrorAnalysis = null;

    try {
      // 从暂停的步骤开始重新执行
      const loopResult = await this._executeStepLoop(taskState, pausedStepIndex, callbacks);
      
      if (loopResult.status !== 'done') {
        return loopResult;
      }
      
      // 任务完成
      taskState.status = 'completed';
      const summary = await this._generateSummary(taskState.plan, taskState.context);
      
      if (callbacks.onComplete) {
        callbacks.onComplete(summary, taskState.context);
      }
      
      this.activeTasks.delete(taskId);
      stateManager.completeTask(taskId, summary);
      
      return {
        status: 'completed',
        taskId: taskId,
        summary: summary,
        context: taskState.context
      };
      
    } catch (error) {
      return await this._handleExecutionError(error, taskState, callbacks);
    }
  }

  /**
   * 继续执行任务（从暂停位置的下一步开始）
   */
  async _continueExecution(taskId, callbacks) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { success: false, error: '任务不存在' };
    }

    const startIndex = taskState.currentStepIndex + 1;

    if (startIndex >= taskState.plan.steps.length) {
      taskState.status = 'completed';
      const summary = await this._generateSummary(taskState.plan, taskState.context);
      this.activeTasks.delete(taskId);
      stateManager.completeTask(taskId, summary);
      
      if (callbacks.onComplete) {
        callbacks.onComplete(summary, taskState.context);
      }
      
      return {
        status: 'completed',
        taskId: taskId,
        summary: summary,
        context: taskState.context
      };
    }

    try {
      const loopResult = await this._executeStepLoop(taskState, startIndex, callbacks);
      
      if (loopResult.status !== 'done') {
        return loopResult;
      }
      
      taskState.status = 'completed';
      const summary = await this._generateSummary(taskState.plan, taskState.context);
      
      if (callbacks.onComplete) {
        callbacks.onComplete(summary, taskState.context);
      }
      
      this.activeTasks.delete(taskId);
      stateManager.completeTask(taskId, summary);
      
      return {
        status: 'completed',
        taskId: taskId,
        summary: summary,
        context: taskState.context
      };

    } catch (error) {
      taskState.status = 'failed';
      this.activeTasks.delete(taskId);
      stateManager.failTask(taskId, error.message);

      if (callbacks.onError) {
        callbacks.onError(error, taskState.currentStepIndex);
      }

      return {
        status: 'failed',
        taskId: taskId,
        error: error.message,
        failedAtStep: taskState.currentStepIndex
      };
    }
  }

  // ========== 并发安全性声明 ==========
  // 借鉴 Claude Code StreamingToolExecutor 的 isConcurrencySafe 自声明模式
  // 每种步骤类型声明是否可以并行执行（Fail-closed：默认不安全）

  /**
   * 判断步骤是否可以并发执行（只读操作可并行，写入/执行/浏览器操作必须串行）
   * Fail-closed 设计：默认不安全，必须主动声明为安全
   */
  _isConcurrencySafe(step) {
    // 步骤级别可通过 concurrent: false 强制串行
    if (step.concurrent === false) return false

    // 按步骤类型判断（只读操作可并行）
    const safeTypes = new Set(['read', 'check'])
    return safeTypes.has(step.type)
  }

  /**
   * 检查步骤的依赖是否已全部满足
   */
  _areDependenciesSatisfied(step, context) {
    if (!step.dependsOn || step.dependsOn.length === 0) return true

    return step.dependsOn.every(dep => {
      const depId = typeof dep === 'object' ? dep.stepId : dep
      const depType = typeof dep === 'object' ? (dep.type || 'required') : 'required'

      const depResult = context[depId]
      if (depResult === undefined) return depType === 'optional'
      if (depResult.skipped && !depResult._depFailed) return true
      if (depResult._failed || depResult._depFailed) {
        return depType === 'optional'
      }
      return true
    })
  }

  /**
   * 将步骤列表分批：连续的可并行步骤分为一组，不可并行的单独一组
   * 有未满足依赖的步骤会打断并行批次
   *
   * 示例：[read, read, write, read, read, execute]
   *   → [[read, read], [write], [read, read], [execute]]
   *   前两个 read 并行，write 串行，后两个 read 并行，execute 串行
   */
  _partitionSteps(steps, startIndex, context) {
    const batches = []
    let currentBatch = []
    let currentBatchIsConcurrent = false

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i]
      const isSafe = this._isConcurrencySafe(step)
      const depsReady = this._areDependenciesSatisfied(step, context)

      // 有未满足依赖的步骤不能并行（需要等前面的步骤完成）
      const canConcurrent = isSafe && depsReady

      if (currentBatch.length === 0) {
        // 新批次开始
        currentBatch.push({ step, index: i })
        currentBatchIsConcurrent = canConcurrent
      } else if (canConcurrent && currentBatchIsConcurrent) {
        // 继续追加到当前并行批次
        currentBatch.push({ step, index: i })
      } else {
        // 类型切换，结束当前批次，开始新批次
        batches.push({ items: currentBatch, concurrent: currentBatchIsConcurrent })
        currentBatch = [{ step, index: i }]
        currentBatchIsConcurrent = canConcurrent
      }
    }

    if (currentBatch.length > 0) {
      batches.push({ items: currentBatch, concurrent: currentBatchIsConcurrent })
    }

    return batches
  }

  /**
   * 核心步骤循环 — execute 和 _continueExecution 的统一实现
   *
   * 并发控制策略（借鉴 Claude Code StreamingToolExecutor）：
   * - 只读步骤（read/check）自动并行执行
   * - 写入/执行/浏览器步骤串行执行
   * - 有依赖关系的步骤等待依赖完成后才执行
   * - execute 类型失败时级联取消同批次的兄弟步骤
   *
   * @returns {{ status: 'done' } | { status: 'paused', ... }}
   */
  async _executeStepLoop(taskState, startIndex, callbacks) {
    const { onStepStart, onStepComplete, onNeedConfirm, onProgress, onPaused } = callbacks;
    const plan = taskState.plan;

    // 将步骤分批（并行批次 / 串行批次）
    const batches = this._partitionSteps(plan.steps, startIndex, taskState.context)

    if (batches.some(b => b.concurrent && b.items.length > 1)) {
      const concurrentCount = batches.filter(b => b.concurrent && b.items.length > 1).reduce((sum, b) => sum + b.items.length, 0)
      console.log(`[Executor] 步骤分批完成: ${batches.length} 批次, 其中 ${concurrentCount} 个步骤可并行`)
    }

    for (const batch of batches) {
      if (taskState.status === 'cancelled') {
        return { status: 'cancelled', taskId: taskState.id };
      }
      // 检查暂停请求
      if (this._consumePauseRequest(taskState.id)) {
        const firstStep = batch.items[0]
        taskState.currentStepIndex = firstStep.index;
        taskState.status = 'paused';
        taskState.pausedAtStep = firstStep.index;
        taskState.pauseReason = 'manual';

        console.log(`[Executor] 任务 ${taskState.id} 在步骤 ${firstStep.index} 处暂停（手动）`);

        if (onPaused) {
          onPaused({
            taskId: taskState.id,
            reason: 'manual',
            stepIndex: firstStep.index,
            step: firstStep.step
          });
        }

        return {
          status: 'paused',
          taskId: taskState.id,
          message: `任务已暂停，停在步骤 "${firstStep.step.description}" 之前`,
          stepIndex: firstStep.index,
          reason: 'manual'
        };
      }

      if (batch.concurrent && batch.items.length > 1) {
        // ===== 并行执行批次 =====
        const batchResult = await this._executeBatchConcurrently(batch.items, taskState, callbacks)
        stateManager.touchTask(taskState.id)
        if (batchResult) return batchResult // 暂停或需要确认
      } else {
        // ===== 串行执行批次 =====
        for (const { step, index } of batch.items) {
          const stepResult = await this._executeSingleStep(step, index, taskState, callbacks)
          stateManager.touchTask(taskState.id)
          if (stepResult) return stepResult // 暂停或需要确认
        }
      }
    }

    return { status: 'done' };
  }

  /**
   * 并行执行一批步骤（仅用于只读/检查类步骤）
   * @returns {null | Object} null 表示继续，Object 表示需要暂停
   */
  async _executeBatchConcurrently(items, taskState, callbacks) {
    const { onStepStart, onStepComplete, onProgress } = callbacks
    const plan = taskState.plan
    const stepDescriptions = items.map(({ step }) => step.description).join(', ')
    console.log(`[Executor] 并行执行 ${items.length} 个步骤: ${stepDescriptions}`)

    // 通知所有步骤开始
    for (const { step, index } of items) {
      taskState.currentStepIndex = index
      if (onStepStart) {
        onStepStart(step, index + 1, plan.steps.length)
      }
    }

    // 并行执行所有步骤
    const promises = items.map(async ({ step, index }) => {
      // 条件检查
      if (step.condition) {
        const { satisfied, reason } = evaluateCondition(step.condition, taskState.context)
        if (!satisfied) {
          return { step, index, skipped: true, reason }
        }
      }

      // 依赖检查（并行批次中的步骤理论上依赖已满足，但做防御性检查）
      if (!this._areDependenciesSatisfied(step, taskState.context)) {
        return { step, index, skipped: true, reason: '依赖未满足' }
      }

      const result = await this._executeStep(step, taskState.context, { trusted: taskState.isTrusted })
      return { step, index, result }
    })

    const results = await Promise.all(promises)

    if (taskState.status === 'cancelled') {
      return { status: 'cancelled', taskId: taskState.id }
    }

    // 按原始顺序处理结果（保序）
    for (const { step, index, result, skipped, reason } of results) {
      taskState.currentStepIndex = index

      if (skipped) {
        const skipData = { success: true, skipped: true, reason, data: { skipped: true, reason } }
        taskState.context[step.id] = skipData.data
        taskState.results.push({ step, result: skipData })
        if (onStepComplete) {
          onStepComplete(step, skipData, index + 1, plan.steps.length)
        }
        continue
      }

      // 处理执行失败（并行批次中的只读步骤失败不级联，只记录）
      if (result && result.success === false) {
        taskState.context[step.id] = { ...result.data, _failed: true, _error: result.error }
        taskState.results.push({ step, result })
        if (onStepComplete) {
          onStepComplete(step, { ...result, failed: true }, index + 1, plan.steps.length)
        }
        if (step.onError !== 'skip') {
          console.log(`[Executor] 并行步骤 ${step.id} 失败（只读操作，不级联）: ${result.error}`)
        }
        continue
      }

      // 存储成功结果
      taskState.context[step.id] = result.data
      taskState.results.push({ step, result })
      if (onStepComplete) {
        onStepComplete(step, result, index + 1, plan.steps.length)
      }
    }

    // 更新进度（以批次中最后一个步骤为准）
    const lastItem = items[items.length - 1]
    if (onProgress) {
      onProgress({
        current: lastItem.index + 1,
        total: plan.steps.length,
        percentage: Math.round(((lastItem.index + 1) / plan.steps.length) * 100)
      })
    }

    return null // 继续执行
  }

  /**
   * 串行执行单个步骤（含依赖检查、条件检查、重试、错误处理）
   * @returns {null | Object} null 表示继续，Object 表示需要暂停
   */
  async _executeSingleStep(step, stepIndex, taskState, callbacks) {
    const { onStepStart, onStepComplete, onNeedConfirm, onProgress, onPaused } = callbacks
    const plan = taskState.plan
    taskState.currentStepIndex = stepIndex

    // 0. 检查暂停请求
    if (this._consumePauseRequest(taskState.id)) {
      taskState.status = 'paused';
      taskState.pausedAtStep = stepIndex;
      taskState.pauseReason = 'manual';

      console.log(`[Executor] 任务 ${taskState.id} 在步骤 ${stepIndex} 处暂停（手动）`);

      if (onPaused) {
        onPaused({
          taskId: taskState.id,
          reason: 'manual',
          stepIndex: stepIndex,
          step: step
        });
      }

      return {
        status: 'paused',
        taskId: taskState.id,
        message: `任务已暂停，停在步骤 "${step.description}" 之前`,
        stepIndex: stepIndex,
        reason: 'manual'
      };
    }

    // 1. 检查依赖是否满足
    if (!this._areDependenciesSatisfied(step, taskState.context)) {
      console.log(`[Executor] 步骤 ${step.id} 跳过：必需依赖步骤未通过`);
      const skipResult = { success: true, skipped: true, _depFailed: true, reason: '必需依赖步骤失败' };
      taskState.context[step.id] = skipResult;
      taskState.results.push({ step, result: { success: true, data: skipResult } });
      if (onStepComplete) {
        onStepComplete(step, { success: true, data: skipResult }, stepIndex + 1, plan.steps.length);
      }
      return null
    }

    // 2. 检查条件是否满足
    if (step.condition) {
      const { satisfied, reason } = evaluateCondition(step.condition, taskState.context);

      if (!satisfied) {
        const skipResult = {
          success: true,
          skipped: true,
          reason: reason,
          data: { skipped: true, reason: reason }
        };

        taskState.context[step.id] = skipResult.data;
        taskState.results.push({ step, result: skipResult });

        if (onStepComplete) {
          onStepComplete(step, skipResult, stepIndex + 1, plan.steps.length);
        }
        if (onProgress) {
          onProgress({
            current: stepIndex + 1,
            total: plan.steps.length,
            percentage: Math.round(((stepIndex + 1) / plan.steps.length) * 100)
          });
        }
        return null
      }
    }

    // 3. 通知步骤开始
    if (onStepStart) {
      onStepStart(step, stepIndex + 1, plan.steps.length);
    }

    // 4. 执行步骤（含自动重试机制）
    if (step.type === 'browser' && step.maxRetries === undefined) {
      step.maxRetries = 1;
    }

    let result = await this._executeStep(step, taskState.context, { trusted: taskState.isTrusted });

    if (taskState.status === 'cancelled') {
      return { status: 'cancelled', taskId: taskState.id };
    }
    let retryCount = 0;
    const maxRetries = step.maxRetries || 0;

    // 失败时自动重试
    while (result && result.success === false && retryCount < maxRetries) {
      if (taskState.status === 'cancelled') {
        return { status: 'cancelled', taskId: taskState.id };
      }
      retryCount++;
      console.log(`[Executor] 步骤 ${step.id} 失败，尝试自动恢复 (${retryCount}/${maxRetries})，错误: ${result.error}`);

      if (callbacks.onStepRetry) {
        callbacks.onStepRetry({
          step,
          currentRetry: retryCount,
          maxRetries,
          error: result.error,
          strategy: step.tool === 'browser' && result.error?.includes('未找到')
            ? '关闭遮罩后重试'
            : '延迟后重试'
        });
      }

      if (step.tool === 'browser' && (result.error?.includes('未找到') || result.error?.includes('not found') || result.error?.includes('No element'))) {
        console.log(`[Executor] 检测到元素查找失败，尝试关闭遮罩...`);
        try {
          const dismissResult = await this._executeStep(
            {
              id: `${step.id}_dismiss_${retryCount}`,
              type: 'browser',
              tool: 'browser',
              method: 'dismissOverlay',
              params: {},
              description: `[自动恢复] 关闭遮罩 (步骤 ${step.id} 重试 ${retryCount})`
            },
            taskState.context,
            { trusted: true }
          );
          console.log(`[Executor] 遮罩关闭结果:`, dismissResult?.success ? '成功' : '未成功');
        } catch (dismissErr) {
          console.log(`[Executor] 遮罩关闭异常:`, dismissErr.message);
        }
      }

      const delay = step.retryDelay || 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      result = await this._executeStep(step, taskState.context, { trusted: taskState.isTrusted });
      if (taskState.status === 'cancelled') {
        return { status: 'cancelled', taskId: taskState.id };
      }
    }

    if (result && result.success === false && maxRetries > 0) {
      if (callbacks.onMaxRetryReached) {
        callbacks.onMaxRetryReached({
          step,
          error: result.error,
          retryCount,
          maxRetries
        });
      }
    }

    // 5. 处理执行失败
    if (result && result.success === false) {
      taskState.context[step.id] = { ...result.data, _failed: true, _error: result.error };
      taskState.results.push({ step, result });

      if (onStepComplete) {
        onStepComplete(step, { ...result, failed: true }, stepIndex + 1, plan.steps.length);
      }

      if (step.onError === 'skip') {
        return null
      }

      taskState.status = 'paused';
      taskState.pausedAtStep = stepIndex;
      taskState.pauseReason = 'step_error';
      taskState.pauseError = result.error;
      taskState.failedStep = step;

      return {
        status: 'paused',
        taskId: taskState.id,
        message: `步骤 "${step.description}" 执行失败，请修改后继续`,
        error: result.error,
        stepIndex: stepIndex,
        failedStep: step,
        canEdit: true
      };
    }

    // 6. 处理需要确认
    if (result.needConfirm) {
      taskState.status = 'paused';
      taskState.pendingConfirmation = { step, result };

      if (onNeedConfirm) {
        onNeedConfirm(step, result.preview, taskState.id);
      }

      return {
        status: 'paused',
        taskId: taskState.id,
        message: `步骤 "${step.description}" 需要确认`,
        preview: result.preview
      };
    }

    // 7. 存储结果
    taskState.context[step.id] = result.data;
    taskState.results.push({ step, result });

    if (onStepComplete) {
      onStepComplete(step, result, stepIndex + 1, plan.steps.length);
    }
    if (onProgress) {
      onProgress({
        current: stepIndex + 1,
        total: plan.steps.length,
        percentage: Math.round(((stepIndex + 1) / plan.steps.length) * 100)
      });
    }

    return null
  }

  /**
   * 执行单个步骤
   */
  async _executeStep(step, context, options = {}) {
    if (step.type !== 'analyze' && (!step.tool || !step.method)) {
      throw new Error(`步骤配置不完整: 缺少 ${!step.tool ? 'tool' : 'method'} 字段。步骤内容: ${JSON.stringify({id: step.id, type: step.type, tool: step.tool, method: step.method})}`);
    }
    
    const resolvedParams = resolveParams(step.params, context);
    
    const paramsWithTrust = options.trusted 
      ? { ...resolvedParams, trusted: true }
      : resolvedParams;
    
    switch (step.type) {
      case 'read':
      case 'write':
      case 'execute':
      case 'check':
        return await toolRegistry.execute(step.tool, step.method, paramsWithTrust, context);
      
      case 'browser':
        return await toolRegistry.execute('browser', step.method, paramsWithTrust, context);
      
      case 'arch-designer':
        return await toolRegistry.execute('arch-designer', step.method, paramsWithTrust, context);
      
      case 'analyze':
        return await this._executeAnalyzeStep(step, context);
      
      default:
        // 尝试使用 step.tool 作为工具名直接执行，支持动态扩展的工具类型
        if (step.tool && step.method) {
          return await toolRegistry.execute(step.tool, step.method, paramsWithTrust, context);
        }
        throw new Error(`未知的步骤类型: ${step.type}`);
    }
  }

  /**
   * 安全序列化，处理循环引用
   */
  _safeStringify(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (typeof value === 'function') {
        return '[Function]';
      }
      return value;
    }, indent);
  }

  /**
   * 执行分析步骤（调用 AI）
   */
  async _executeAnalyzeStep(step, context) {
    // 只序列化 step.contextKeys 指定的步骤结果，或默认序列化全部
    const keysToInclude = step.contextKeys && Array.isArray(step.contextKeys)
      ? step.contextKeys
      : Object.keys(context);

    const contextStr = keysToInclude
      .filter(key => context[key] !== undefined)
      .map(key => `步骤 ${key} 的结果:\n${this._safeStringify(context[key], 2)}`)
      .join('\n\n');

    // 如果步骤声明了 outputSchema，要求 AI 输出严格的 JSON 结构
    const hasOutputSchema = step.outputSchema && typeof step.outputSchema === 'object';

    // 优先使用步骤自定义的 prompt，没有时才用 description 构建默认 prompt
    const taskDescription = step.prompt || step.description;

    let prompt;
    if (hasOutputSchema) {
      const schemaStr = this._safeStringify(step.outputSchema, 2);
      const contextSection = contextStr
        ? `## 上下文数据\n${contextStr}\n\n`
        : '';
      prompt = `${contextSection}## 任务\n${taskDescription}\n\n## 输出格式要求\n你必须只输出一个合法的 JSON 对象，不要有任何额外的文字、解释或 markdown 代码块。\nJSON 结构如下（字段含义见注释）：\n${schemaStr}\n\n请直接输出 JSON，不要包含 \`\`\`json 或其他标记。`;
    } else {
      const contextSection = contextStr
        ? `## 上下文数据\n${contextStr}\n\n`
        : '';
      prompt = `${contextSection}## 任务\n${taskDescription}\n\n请给出结构化的分析结果。`;
    }

    try {
      const content = await callAI(prompt, { sessionId: `task_analyze_${Date.now()}`, timeout: 60000 });

      // 如果声明了 outputSchema，尝试解析 AI 返回的 JSON
      if (hasOutputSchema) {
        let parsedOutput = null;
        try {
          // 去除可能的 markdown 代码块包裹
          const cleanedContent = content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/, '')
            .trim();
          parsedOutput = JSON.parse(cleanedContent);
        } catch (parseError) {
          // JSON 解析失败时，尝试从文本中提取第一个 JSON 对象
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsedOutput = JSON.parse(jsonMatch[0]);
            } catch {
              // 提取也失败，回退到纯文本模式
            }
          }
        }

        if (parsedOutput) {
          return {
            success: true,
            data: {
              ...parsedOutput,
              analysis: content,
            },
            needConfirm: false
          };
        }

        // JSON 解析彻底失败，返回错误让步骤可以感知
        return {
          success: false,
          error: `analyze 步骤要求结构化输出，但 AI 返回内容无法解析为 JSON。原始内容: ${content.substring(0, 200)}`,
          needConfirm: false
        };
      }

      return {
        success: true,
        data: {
          analysis: content,
          rawContext: context
        },
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 处理执行过程中的异常
   */
  async _handleExecutionError(error, taskState, callbacks) {
    const failedStep = taskState.plan.steps[taskState.currentStepIndex] || null;
    
    // 安全提取 context，避免循环引用
    const safeContext = {};
    try {
      for (const [key, value] of Object.entries(taskState.context || {})) {
        if (typeof value === 'object' && value !== null) {
          safeContext[key] = { 
            success: value.success, 
            summary: typeof value.data === 'string' ? value.data.substring(0, 200) : '[object]'
          };
        } else {
          safeContext[key] = value;
        }
      }
    } catch (e) {
      // 如果提取也失败，使用空对象
    }
    
    const errorContext = {
      currentStep: failedStep,
      taskContext: safeContext,
      projectContext: await this._getCurrentProjectContext(),
      recentSteps: this._getRecentSteps(taskState)
    };
    
    let errorAnalysis = null;
    try {
      errorAnalysis = await errorHandler.analyzeError(error, errorContext);
    } catch (analysisErr) {
      console.error('[TaskExecutor] 错误分析自身也失败:', analysisErr.message);
    }
    
    // 任务执行异常时，暂停任务等待用户决策，而不是直接失败
    taskState.status = 'paused';
    taskState.pausedAtStep = taskState.currentStepIndex;
    taskState.pauseReason = 'error';
    taskState.pauseError = error.message;
    taskState.pauseErrorAnalysis = errorAnalysis;
    
    if (callbacks.onError) {
      callbacks.onError({
        taskId: taskState.id,
        error: error,
        analysis: errorAnalysis,
        stepIndex: taskState.currentStepIndex,
        failedStep: failedStep
      }, taskState.currentStepIndex);
    }
    
    // 不删除任务，保持活跃状态以便用户可以重试
    // this.activeTasks.delete(taskState.id);
    
    return {
      status: 'paused',
      taskId: taskState.id,
      message: `步骤执行异常: ${error.message}，已暂停等待处理`,
      error: error.message,
      errorAnalysis: errorAnalysis,
      pausedAtStep: taskState.currentStepIndex,
      canRetry: true
    };
  }

  /**
   * 生成任务总结
   */
  async _generateSummary(plan, context) {
    const lastStep = plan.steps[plan.steps.length - 1];
    if (lastStep.type === 'analyze' && context[lastStep.id]) {
      return context[lastStep.id].analysis || context[lastStep.id];
    }
    return `任务已完成，共执行 ${plan.steps.length} 个步骤`;
  }

  /**
   * 获取当前项目上下文
   */
  async _getCurrentProjectContext() {
    try {
      return await environmentContext.analyzeProjectContext();
    } catch (error) {
      console.warn('项目上下文分析失败:', error.message);
      return {};
    }
  }

  /**
   * 获取最近执行的步骤
   */
  _getRecentSteps(taskState, count = 3) {
    const recent = [];
    const startIndex = Math.max(0, taskState.currentStepIndex - count);
    
    for (let i = startIndex; i < taskState.currentStepIndex; i++) {
      if (taskState.plan.steps[i]) {
        recent.push({
          step: taskState.plan.steps[i],
          result: taskState.results[i]
        });
      }
    }
    
    return recent;
  }

  /**
   * 获取智能错误处理工具
   */
  getErrorHandler() {
    return errorHandler;
  }

  /**
   * 获取环境上下文工具
   */
  getEnvironmentContext() {
    return environmentContext;
  }

  cancel(taskId) {
    const taskState = this.activeTasks.get(taskId);
    if (taskState) {
      taskState.status = 'cancelled';
      this._pauseRequests.delete(taskId);
      this.activeTasks.delete(taskId);
      return { success: true };
    }
    return { success: false, error: '任务不存在' };
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId) {
    const taskState = this.activeTasks.get(taskId);
    if (!taskState) {
      return { exists: false };
    }

    return {
      exists: true,
      status: taskState.status,
      currentStep: taskState.currentStepIndex + 1,
      totalSteps: taskState.plan.steps.length,
      pendingConfirmation: taskState.pendingConfirmation
    };
  }
}

const taskExecutor = new TaskExecutor()
module.exports = taskExecutor
module.exports.TaskExecutor = TaskExecutor

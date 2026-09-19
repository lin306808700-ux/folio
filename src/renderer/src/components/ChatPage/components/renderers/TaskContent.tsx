// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { UnifiedTaskCard } from '../UnifiedTaskCard'
import { useMessageBubbleContext } from '../MessageBubbleContext'

// Plan 相关 UI 已移除 — 任务管理统一由 Muse 任务系统（右侧面板 TasksTab）承载

/** task_progress 类型 */
export function TaskProgressContent() {
  const {
    msg, onConfirmTask, onCancelTask, onEditStep, onDeleteStep,
    onPauseTask, onResumeTask, onRetryTask, onSkipStep, onAnalyzeError, onInterveneTask,
  } = useMessageBubbleContext()

  if (!msg.taskProgressData) return null

  const data = msg.taskProgressData

  return (
    <UnifiedTaskCard
      taskId={data.taskId}
      mode={data.status === 'error' || data.pauseReason === 'error' ? 'error' : data.status === 'completed' ? 'completed' : 'executing'}
      steps={data.steps}
      currentStep={data.currentStep}
      status={data.status}
      pauseReason={data.pauseReason}
      pauseError={data.pauseError}
      retryCount={data.retryCount}
      maxRetries={data.maxRetries}
      retryStrategy={data.retryStrategy}
      onConfirm={(steps) => onConfirmTask && onConfirmTask(data.taskId, true, { steps })}
      onCancel={() => onCancelTask?.(data.taskId)}
      onEditStep={onEditStep}
      onDeleteStep={onDeleteStep}
      onPause={onPauseTask ? () => onPauseTask(data.taskId) : undefined}
      onResume={onResumeTask ? () => onResumeTask(data.taskId) : undefined}
      onRetry={onRetryTask ? () => onRetryTask(data.taskId) : undefined}
      onSkipStep={onSkipStep ? () => onSkipStep(data.taskId) : undefined}
      onAnalyzeError={onAnalyzeError ? () => onAnalyzeError(data.taskId) : undefined}
      onIntervene={onInterveneTask ? (message) => onInterveneTask(data.taskId, message) : undefined}
    />
  )
}

/** task_step_error 类型 */
export function TaskStepErrorContent() {
  const {
    msg, allMessages, onConfirmTask, onCancelTask,
    onEditStep, onDeleteStep, onRetryTask,
  } = useMessageBubbleContext()

  if (!msg.taskStepErrorData) return null

  const errorData = msg.taskStepErrorData

  // 尝试从最近的任务进度消息中获取完整步骤列表
  const taskProgressMsg = allMessages?.findLast(m =>
    m.type === 'task_progress' &&
    Array.isArray(m.taskProgressData?.steps) &&
    m.taskProgressData!.steps.length > 0
  )
  const steps = taskProgressMsg?.taskProgressData?.steps || [errorData.failedStep]

  return (
    <UnifiedTaskCard
      taskId={errorData.taskId}
      mode="error"
      steps={steps}
      currentStep={errorData.stepIndex + 1}
      status="paused"
      pauseReason="error"
      pauseError={errorData.error}
      failedStep={errorData.failedStep}
      onConfirm={(steps) => onConfirmTask && onConfirmTask(errorData.taskId, true, steps[0])}
      onCancel={() => onCancelTask?.(errorData.taskId)}
      onEditStep={onEditStep}
      onDeleteStep={onDeleteStep}
      onRetry={onRetryTask ? () => onRetryTask(errorData.taskId) : undefined}
    />
  )
}

/** task_confirm 类型 — 确认/取消后自动折叠为一行状态提示 */
export function TaskConfirmContent() {
  const { msg, loading, isElectron, onConfirmTask } = useMessageBubbleContext()
  const [resolved, setResolved] = React.useState<'confirmed' | 'cancelled' | null>(null)

  if (msg.type !== 'task_confirm' || msg.role !== 'assistant' || !isElectron || !msg.taskConfirmData) return null

  // 已确认/取消：折叠为一行轻量提示
  if (resolved) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-text-faint">
        {resolved === 'confirmed'
          ? <><CheckCircle size={12} className="text-emerald-500" /> <span>已确认执行</span></>
          : <><X size={12} className="text-slate-400" /> <span>已取消</span></>
        }
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
        <div className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
          <AlertCircle size={14} className="inline mr-1" /> 需要确认的操作
        </div>
        {msg.taskConfirmData.preview && (
          <div className="text-xs text-amber-700 dark:text-amber-400 font-mono bg-white dark:bg-black/20 p-2 rounded border border-amber-100 dark:border-amber-500/10 overflow-x-auto">
            {msg.taskConfirmData.preview.command || msg.taskConfirmData.preview.path || JSON.stringify(msg.taskConfirmData.preview, null, 2)}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => { onConfirmTask(msg.taskConfirmData!.taskId, true); setResolved('confirmed') }}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />} 确认执行
        </button>
        <button
          onClick={() => { onConfirmTask(msg.taskConfirmData!.taskId, false); setResolved('cancelled') }}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </div>
  )
}

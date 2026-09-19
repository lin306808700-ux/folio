// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect } from 'react'
import { AlertCircle, Play, Trash2, X, Clock } from 'lucide-react'

interface UnfinishedTask {
  id: string
  originalInput: string
  taskName: string
  status: string
  pauseReason: string | null
  stepCount: number
  completedSteps: number
  currentStepIndex: number
  createdAt: number
  updatedAt: number
}

interface TaskRecoveryBannerProps {
  isElectron: boolean
  onTaskResumed?: (taskId: string) => void
}

/** 格式化时间差 */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function TaskRecoveryBanner({ isElectron, onTaskResumed }: TaskRecoveryBannerProps) {
  const [tasks, setTasks] = useState<UnfinishedTask[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [resumingTaskId, setResumingTaskId] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<{ taskId: string; message: string } | null>(null)

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.task?.getUnfinished) return

    window.electronAPI.task.getUnfinished().then(result => {
      if (result.success && result.data.length > 0) {
        setTasks(result.data)
      }
    }).catch(() => {})
  }, [isElectron])

  const handleClearTask = async (taskId: string) => {
    await window.electronAPI?.task?.clearUnfinished?.(taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  const handleClearAll = async () => {
    await window.electronAPI?.task?.clearAllUnfinished?.()
    setTasks([])
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  const handleResumeTask = async (taskId: string) => {
    setResumingTaskId(taskId)
    setResumeError(null)
    try {
      const result = await window.electronAPI?.task?.resume?.({ taskId })
      if (!result || result.success === false || result.status === 'failed') {
        throw new Error(result?.error || '任务恢复失败')
      }
      setTasks(prev => prev.filter(task => task.id !== taskId))
      onTaskResumed?.(taskId)
    } catch (error) {
      setResumeError({ taskId, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setResumingTaskId(null)
    }
  }

  if (!isElectron || tasks.length === 0 || dismissed) return null

  return (
    <div className="mx-4 mt-3 mb-1 animate-in fade-in slide-in-from-top-2">
      <div className="border border-amber-200 bg-amber-50/80 rounded-xl overflow-hidden">
        {/* 头部 */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-amber-100">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="text-amber-600" />
            <span className="text-sm font-medium text-amber-800">
              发现 {tasks.length} 个未完成任务
            </span>
          </div>
          <div className="flex items-center gap-2">
            {tasks.length > 1 && (
              <button
                onClick={handleClearAll}
                className="text-[11px] text-amber-600 hover:text-amber-800 hover:bg-amber-100 px-2 py-1 rounded transition-colors"
              >
                全部清除
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="p-1 text-amber-400 hover:text-amber-600 rounded transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 任务列表 */}
        <div className="divide-y divide-amber-100">
          {tasks.map(task => (
            <div key={task.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 truncate">
                  {task.originalInput || task.taskName || '未命名任务'}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                  <Clock size={10} />
                  <span>{timeAgo(task.updatedAt)}</span>
                  <span>·</span>
                  <span>{task.completedSteps}/{task.stepCount} 步完成</span>
                  {task.pauseReason === 'restart' && (
                    <>
                      <span>·</span>
                      <span className="text-amber-500">重启中断</span>
                    </>
                  )}
                </div>
                {resumeError?.taskId === task.id && (
                  <div className="mt-1 text-[11px] text-red-600">{resumeError.message}</div>
                )}
              </div>
              <button
                onClick={() => handleResumeTask(task.id)}
                disabled={resumingTaskId === task.id}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-[11px] font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
              >
                <Play size={13} />
                {resumingTaskId === task.id ? '恢复中' : '继续任务'}
              </button>
              <button
                onClick={() => handleClearTask(task.id)}
                className="flex-shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="清除此任务"
                aria-label="清除此未完成任务"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Play, X, CheckCircle, AlertCircle, Clock, Loader2, Ban } from 'lucide-react'

interface Task {
  id: string
  command: string
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'suspended' | 'waiting_reply' | 'cancelled'
  priority: string
  createdAt: string
  completedAt: string | null
  error: string | null
  attempts: number
  subtasks?: any[]
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending: { label: '待执行', icon: <Clock size={12} />, color: 'text-amber-500' },
  executing: { label: '执行中', icon: <Loader2 size={12} className="animate-spin" />, color: 'text-violet-500' },
  completed: { label: '已完成', icon: <CheckCircle size={12} />, color: 'text-emerald-500' },
  failed: { label: '失败', icon: <AlertCircle size={12} />, color: 'text-red-500' },
  suspended: { label: '已挂起', icon: <Clock size={12} />, color: 'text-orange-500' },
  waiting_reply: { label: '等待回复', icon: <Clock size={12} />, color: 'text-blue-500' },
  cancelled: { label: '已取消', icon: <Ban size={12} />, color: 'text-slate-400' },
}

export function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const result = await (window as any).electronAPI?.workspace?.listTasks?.()
      if (result?.success) {
        setTasks(result.tasks.filter((t: Task) => !t.id?.startsWith('subtask_')))
      }
    } catch (error) {
      console.error('加载任务失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const handleRetry = async (taskId: string) => {
    setActionLoading(taskId)
    try {
      await (window as any).electronAPI?.workspace?.retryTask?.(taskId)
      await fetchTasks()
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancel = async (taskId: string) => {
    setActionLoading(taskId)
    try {
      await (window as any).electronAPI?.workspace?.cancelTask?.(taskId)
      await fetchTasks()
    } finally {
      setActionLoading(null)
    }
  }

  const activeTasks = tasks.filter(t => ['pending', 'executing', 'suspended', 'waiting_reply'].includes(t.status))
  const finishedTasks = tasks.filter(t => ['completed', 'failed', 'cancelled'].includes(t.status))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle/50 dark:border-white/[0.06]">
        <span className="text-xs font-semibold text-text-muted dark:text-slate-400">
          任务队列 {activeTasks.length > 0 && <span className="text-violet-500">({activeTasks.length})</span>}
        </span>
        <button
          onClick={fetchTasks}
          className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted transition-colors"
          title="刷新"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 overflow-y-auto scroll-dark">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-faint text-xs">
            <Loader2 size={14} className="animate-spin mr-2" /> 加载中...
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-faint text-xs gap-2">
            <CheckCircle size={24} className="opacity-30" />
            <span>暂无任务</span>
          </div>
        ) : (
          <div className="p-3 space-y-4">
            {/* 活跃任务 */}
            {activeTasks.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-semibold text-text-faint uppercase tracking-wider">进行中</span>
                {activeTasks.map(task => (
                  <TaskCard key={task.id} task={task} actionLoading={actionLoading} onRetry={handleRetry} onCancel={handleCancel} />
                ))}
              </div>
            )}

            {/* 已完成任务 */}
            {finishedTasks.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] font-semibold text-text-faint uppercase tracking-wider">历史</span>
                {finishedTasks.slice(0, 10).map(task => (
                  <TaskCard key={task.id} task={task} actionLoading={actionLoading} onRetry={handleRetry} onCancel={handleCancel} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskCard({ task, actionLoading, onRetry, onCancel }: {
  task: Task
  actionLoading: string | null
  onRetry: (id: string) => void
  onCancel: (id: string) => void
}) {
  const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
  const isActioning = actionLoading === task.id
  const timeStr = task.createdAt
    ? new Date(task.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="rounded-lg border border-border-subtle/50 dark:border-white/[0.06] bg-surface/40 dark:bg-white/[0.02] p-3 space-y-2">
      {/* 状态行 */}
      <div className="flex items-center gap-2">
        <span className={config.color}>{config.icon}</span>
        <span className={`text-[11px] font-medium ${config.color}`}>{config.label}</span>
        <span className="ml-auto text-[10px] text-text-faint font-mono">{timeStr}</span>
      </div>

      {/* 任务描述 */}
      <p className="text-xs text-text-primary dark:text-white/80 leading-relaxed line-clamp-3">
        {task.command}
      </p>

      {/* 错误信息 */}
      {task.error && (
        <p className="text-[11px] text-red-400 bg-red-500/5 rounded px-2 py-1 line-clamp-2">
          {task.error}
        </p>
      )}

      {/* 操作按钮 */}
      {(task.status === 'failed' || task.status === 'suspended' || task.status === 'pending') && (
        <div className="flex items-center gap-2 pt-1">
          {(task.status === 'failed' || task.status === 'suspended') && (
            <button
              onClick={() => onRetry(task.id)}
              disabled={isActioning}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-colors disabled:opacity-50"
            >
              <Play size={10} /> 重试
            </button>
          )}
          <button
            onClick={() => onCancel(task.id)}
            disabled={isActioning}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-slate-500/10 hover:bg-slate-500/20 text-slate-400 transition-colors disabled:opacity-50"
          >
            <X size={10} /> 取消
          </button>
        </div>
      )}
    </div>
  )
}

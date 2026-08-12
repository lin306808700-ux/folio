import React, { useState, useCallback } from 'react'
import { ListTodo, RefreshCw, Edit2, Check, X, AlertTriangle, Trash2, Plus, Pause, Play, Archive, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Task } from '../../types'

interface TasksTabProps {
  tasks: Task[]
  fetchTasks: () => Promise<void>
  updateTask: (taskId: string, updates: any) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  addSubtask: (parentId: string, command: string, priority?: string) => Promise<any>
  onConfirmTask?: (taskId: string, confirmed: boolean) => Promise<void>
  replyLoading?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  executing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  reviewing: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  closed: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  suspended: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  waiting_reply: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  repairing: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  executing: '执行中',
  reviewing: '待审核',
  completed: '已完成',
  failed: '失败',
  closed: '已关闭',
  suspended: '已挂起',
  waiting_reply: '等待确认',
  repairing: '修复中'
}

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-400',
  executing: 'bg-blue-400 animate-pulse',
  failed: 'bg-red-400',
  suspended: 'bg-orange-400',
  pending: 'bg-amber-400',
  reviewing: 'bg-purple-400',
  closed: 'bg-slate-400',
  waiting_reply: 'bg-cyan-400 animate-pulse',
  repairing: 'bg-yellow-400 animate-pulse'
}

const TasksTab: React.FC<TasksTabProps> = ({ tasks, fetchTasks, updateTask, deleteTask, addSubtask, onConfirmTask, replyLoading }) => {
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [editCommand, setEditCommand] = useState('')
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null)
  const [editSubtaskCommand, setEditSubtaskCommand] = useState('')
  const [editSubtaskStatus, setEditSubtaskStatus] = useState<string>('')
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null)
  const [newSubtaskCommand, setNewSubtaskCommand] = useState('')
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([])
  const [loadingArchived, setLoadingArchived] = useState(false)

  const toggleSubtasks = (taskId: string) => {
    setExpandedSubtasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const loadArchivedTasks = useCallback(async () => {
    if (showArchived) { setShowArchived(false); return }
    setLoadingArchived(true)
    try {
      const result = await (window as any).electronAPI.muse.getArchivedTasks()
      if (result.success) setArchivedTasks(result.tasks || [])
    } catch (err) {
      console.error('加载归档任务失败:', err)
    }
    setLoadingArchived(false)
    setShowArchived(true)
  }, [showArchived])

  if (tasks.length === 0 && !showArchived) {
    return (
      <div className="text-center py-16 text-text-muted">
        <ListTodo size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">暂无任务</p>
        <p className="text-xs mt-1 text-text-faint">给缪斯下达指令，她会自动创建任务</p>
        <button onClick={loadArchivedTasks} className="mt-3 flex items-center gap-1 mx-auto text-xs text-text-muted hover:text-text-secondary transition-colors">
          <Archive size={12} /> 查看归档任务
        </button>
      </div>
    )
  }

  const parentTasks = tasks
    .filter(t => !t.parentId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <div className="space-y-2">
      {parentTasks.map(task => {
        const subtasks = tasks
          .filter(t => t.parentId === task.id)
          .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
        const completedCount = subtasks.filter(s => s.status === 'completed').length
        const isSubtasksExpanded = expandedSubtasks.has(task.id)
        const hasActiveSubtask = subtasks.some(s => s.status === 'executing')

        return (
          <div key={task.id} className="bg-surface/50 dark:bg-white/[0.03] rounded-xl border border-border-subtle/50 dark:border-white/[0.08] overflow-hidden">
            {/* 任务头部 - 紧凑单行 */}
            <div className="flex items-center gap-3 px-3 py-2.5 group">
              {/* 状态标签 */}
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full border shrink-0 ${STATUS_COLORS[task.status]}`}>
                {STATUS_LABELS[task.status]}
              </span>

              {/* 任务描述 */}
              {editingTask === task.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    value={editCommand}
                    onChange={(e) => setEditCommand(e.target.value)}
                    className="flex-1 bg-inset dark:bg-black/30 border border-cyan-500/30 rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-cyan-500/50"
                    autoFocus
                  />
                  <select
                    value={task.status}
                    onChange={(e) => updateTask(task.id, { status: e.target.value })}
                    className="bg-inset dark:bg-black/30 border border-border-subtle dark:border-white/20 rounded px-1.5 py-1 text-[10px] text-text-primary focus:outline-none"
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <button onClick={async () => { await updateTask(task.id, { command: editCommand }); setEditingTask(null) }}
                    className="p-1 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 rounded transition-colors"><Check size={12} /></button>
                  <button onClick={() => setEditingTask(null)}
                    className="p-1 text-text-muted hover:bg-text-primary/10 rounded transition-colors"><X size={12} /></button>
                </div>
              ) : (
                <span className="flex-1 text-xs text-text-secondary dark:text-slate-300 truncate" title={task.command}>{task.command}</span>
              )}

              {/* 错误提示 */}
              {task.error && !editingTask && (
                <span className="text-[10px] text-red-500 dark:text-red-400 flex items-center gap-0.5 shrink-0" title={task.error}>
                  <AlertTriangle size={10} />
                </span>
              )}

              {/* 等待确认 — 快捷确认/拒绝按钮 */}
              {task.status === 'waiting_reply' && !editingTask && onConfirmTask && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onConfirmTask(task.id, true)}
                    disabled={replyLoading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors text-[11px] font-medium disabled:opacity-40"
                  >
                    {replyLoading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                    确认
                  </button>
                  <button
                    onClick={() => onConfirmTask(task.id, false)}
                    disabled={replyLoading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors text-[11px] disabled:opacity-40"
                  >
                    <XCircle size={11} />
                    拒绝
                  </button>
                </div>
              )}

              {/* 子任务进度摘要 - 可点击展开 */}
              {subtasks.length > 0 && !editingTask && (
                <button
                  onClick={() => toggleSubtasks(task.id)}
                  className="flex items-center gap-1.5 shrink-0 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  {hasActiveSubtask && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                  <span className="font-mono">{completedCount}/{subtasks.length}</span>
                  <div className="w-12 bg-text-primary/[0.06] dark:bg-white/5 rounded-full h-1">
                    <div className="bg-cyan-500 h-1 rounded-full transition-all" style={{ width: `${(completedCount / subtasks.length) * 100}%` }} />
                  </div>
                  {isSubtasksExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
              )}

              {/* 操作按钮 - 内联 */}
              {!editingTask && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => { setEditingTask(task.id); setEditCommand(task.command) }}
                    className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-cyan-500 dark:hover:text-cyan-400" title="编辑">
                    <Edit2 size={11} />
                  </button>
                  {(task.status === 'pending' || task.status === 'executing') && (
                    <button onClick={() => updateTask(task.id, { status: 'suspended', suspendReason: '用户手动暂停' })}
                      className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-orange-500 dark:hover:text-orange-400" title="暂停">
                      <Pause size={11} />
                    </button>
                  )}
                  {task.status === 'suspended' && (
                    <button onClick={() => updateTask(task.id, { status: 'pending', suspendReason: null })}
                      className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-green-500 dark:hover:text-green-400" title="恢复">
                      <Play size={11} />
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button onClick={() => updateTask(task.id, { status: 'pending', error: null })}
                      className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-amber-500 dark:hover:text-amber-400" title="重试">
                      <RefreshCw size={11} />
                    </button>
                  )}
                  <button onClick={() => deleteTask(task.id)}
                    className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-red-500 dark:hover:text-red-400" title="删除">
                    <Trash2 size={11} />
                  </button>
                  {subtasks.length === 0 && (
                    <button onClick={() => { setAddingSubtaskFor(task.id); setNewSubtaskCommand('') }}
                      className="p-1 hover:bg-text-primary/10 rounded transition-colors text-text-muted hover:text-cyan-500 dark:hover:text-cyan-400" title="添加子任务">
                      <Plus size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 子任务折叠区域 */}
            {isSubtasksExpanded && subtasks.length > 0 && (
              <div className="border-t border-border-subtle/40 dark:border-white/5 bg-inset/40 dark:bg-black/10 px-3 py-1.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-text-faint font-medium">子任务</span>
                  {addingSubtaskFor !== task.id && (
                    <button onClick={() => { setAddingSubtaskFor(task.id); setNewSubtaskCommand('') }}
                      className="flex items-center gap-0.5 text-[10px] text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 px-1.5 py-0.5 rounded transition-colors">
                      <Plus size={9} /> 添加
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-text-primary/[0.03] transition-colors group/st">
                      {editingSubtask === st.id ? (
                        <div className="flex-1 flex items-center gap-1.5">
                          <input value={editSubtaskCommand} onChange={(e) => setEditSubtaskCommand(e.target.value)}
                            className="flex-1 bg-inset dark:bg-black/30 border border-cyan-500/30 rounded px-1.5 py-0.5 text-[11px] text-text-primary focus:outline-none" autoFocus />
                          <select value={editSubtaskStatus} onChange={(e) => setEditSubtaskStatus(e.target.value)}
                            className="bg-inset dark:bg-black/30 border border-border-subtle dark:border-white/20 rounded px-1 py-0.5 text-[10px] text-text-primary focus:outline-none">
                            {Object.entries(STATUS_LABELS).filter(([k]) => k !== 'reviewing').map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          <button onClick={async () => { await updateTask(st.id, { command: editSubtaskCommand, status: editSubtaskStatus }); setEditingSubtask(null) }}
                            className="p-0.5 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 rounded"><Check size={10} /></button>
                          <button onClick={() => setEditingSubtask(null)}
                            className="p-0.5 text-text-muted hover:bg-text-primary/10 rounded"><X size={10} /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-[10px] text-text-faint font-mono w-4 text-right shrink-0">#{st.executionOrder || '?'}</span>
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[st.status] || 'bg-slate-400'}`} />
                          <span className="flex-1 text-[11px] text-text-muted truncate">{st.command}</span>
                          <span className={`px-1 py-0.5 rounded text-[9px] shrink-0 ${STATUS_COLORS[st.status]}`}>
                            {STATUS_LABELS[st.status]}
                          </span>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover/st:opacity-100 transition-opacity shrink-0">
                            <button onClick={() => { setEditingSubtask(st.id); setEditSubtaskCommand(st.command); setEditSubtaskStatus(st.status) }}
                              className="p-0.5 hover:bg-text-primary/10 rounded text-text-faint hover:text-cyan-500 dark:hover:text-cyan-400"><Edit2 size={9} /></button>
                            {st.status === 'failed' && (
                              <button onClick={() => updateTask(st.id, { status: 'pending', error: null })}
                                className="p-0.5 hover:bg-text-primary/10 rounded text-text-faint hover:text-amber-500 dark:hover:text-amber-400"><RefreshCw size={9} /></button>
                            )}
                            <button onClick={() => deleteTask(st.id)}
                              className="p-0.5 hover:bg-text-primary/10 rounded text-text-faint hover:text-red-500 dark:hover:text-red-400"><Trash2 size={9} /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* 添加子任务输入 */}
                {addingSubtaskFor === task.id && (
                  <div className="mt-1.5 flex items-center gap-1.5 px-2">
                    <input value={newSubtaskCommand} onChange={(e) => setNewSubtaskCommand(e.target.value)}
                      placeholder="子任务描述..."
                      className="flex-1 bg-inset dark:bg-black/30 border border-dashed border-cyan-500/20 rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-faint focus:outline-none focus:border-cyan-500/40"
                      autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && newSubtaskCommand.trim()) { addSubtask(task.id, newSubtaskCommand.trim()); setNewSubtaskCommand(''); setAddingSubtaskFor(null) } }} />
                    <button onClick={async () => { if (!newSubtaskCommand.trim()) return; await addSubtask(task.id, newSubtaskCommand.trim()); setNewSubtaskCommand(''); setAddingSubtaskFor(null) }}
                      className="p-1 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 rounded"><Check size={10} /></button>
                    <button onClick={() => { setAddingSubtaskFor(null); setNewSubtaskCommand('') }}
                      className="p-1 text-text-muted hover:bg-text-primary/10 rounded"><X size={10} /></button>
                  </div>
                )}
              </div>
            )}

            {/* 无子任务时的添加输入 */}
            {addingSubtaskFor === task.id && subtasks.length === 0 && (
              <div className="border-t border-border-subtle/40 dark:border-white/5 bg-inset/40 dark:bg-black/10 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <input value={newSubtaskCommand} onChange={(e) => setNewSubtaskCommand(e.target.value)}
                    placeholder="子任务描述..."
                    className="flex-1 bg-inset dark:bg-black/30 border border-dashed border-cyan-500/20 rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-faint focus:outline-none focus:border-cyan-500/40"
                    autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && newSubtaskCommand.trim()) { addSubtask(task.id, newSubtaskCommand.trim()); setNewSubtaskCommand(''); setAddingSubtaskFor(null) } }} />
                  <button onClick={async () => { if (!newSubtaskCommand.trim()) return; await addSubtask(task.id, newSubtaskCommand.trim()); setNewSubtaskCommand(''); setAddingSubtaskFor(null) }}
                    className="p-1 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 rounded"><Check size={10} /></button>
                  <button onClick={() => { setAddingSubtaskFor(null); setNewSubtaskCommand('') }}
                    className="p-1 text-text-muted hover:bg-text-primary/10 rounded"><X size={10} /></button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 归档任务 */}
      <div className="mt-3 border-t border-border-subtle/40 dark:border-white/5 pt-3">
        <button onClick={loadArchivedTasks} disabled={loadingArchived}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary hover:bg-text-primary/[0.04] dark:hover:bg-white/5 rounded-lg transition-colors">
          <Archive size={12} />
          <span>{showArchived ? '收起归档' : '归档任务'}</span>
          {loadingArchived ? <RefreshCw size={10} className="animate-spin ml-auto" />
            : <ChevronRight size={10} className={`ml-auto transition-transform ${showArchived ? 'rotate-90' : ''}`} />}
        </button>

        {showArchived && (
          <div className="mt-1.5 space-y-1">
            {archivedTasks.length === 0 ? (
              <p className="text-[11px] text-text-faint italic px-3 py-2">暂无归档任务</p>
            ) : (
              archivedTasks
                .filter(t => !t.parentId)
                .sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime())
                .slice(0, 50)
                .map(task => (
                  <div key={task.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg opacity-60 hover:opacity-90 transition-opacity">
                    <span className={`px-1 py-0.5 text-[9px] rounded-full border ${STATUS_COLORS[task.status]}`}>
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                    <span className="flex-1 text-[11px] text-text-muted truncate">{task.command}</span>
                    <span className="text-[10px] text-text-faint shrink-0">
                      {task.completedAt ? new Date(task.completedAt).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TasksTab

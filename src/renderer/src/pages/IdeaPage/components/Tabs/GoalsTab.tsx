import React, { useState } from 'react'
import {
  Target, Plus, ChevronDown, ChevronRight, CheckCircle2,
  Circle, Trash2, Flag, Lightbulb, Loader2, Send
} from 'lucide-react'

interface Goal {
  id: string
  title: string
  description: string
  direction: string
  status: 'active' | 'paused' | 'completed' | 'abandoned'
  exploreSteps: Array<{
    topic: string
    status: 'pending' | 'completed'
    insightId: string | null
    at: string
    completedAt?: string
  }>
  insights: Array<{
    title: string
    summary: string
    stepIndex: number
    at: string
  }>
  createdAt: string
  updatedAt: string
}

interface GoalsTabProps {
  goals: Goal[]
  onCreateGoal: (title: string, description?: string, direction?: string) => Promise<void>
  onCompleteGoal: (id: string) => Promise<void>
  onDeleteGoal: (id: string) => Promise<void>
  onAddStep: (goalId: string, topic: string) => Promise<void>
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '进行中', color: 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10' },
  paused: { label: '已暂停', color: 'text-amber-500 dark:text-amber-400 bg-amber-500/10' },
  completed: { label: '已完成', color: 'text-cyan-500 dark:text-cyan-400 bg-cyan-500/10' },
  abandoned: { label: '已放弃', color: 'text-rose-500 dark:text-rose-400 bg-rose-500/10' },
}

const GoalsTab: React.FC<GoalsTabProps> = ({ goals, onCreateGoal, onCompleteGoal, onDeleteGoal, onAddStep }) => {
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newGoalTitle, setNewGoalTitle] = useState('')
  const [newGoalDesc, setNewGoalDesc] = useState('')
  const [newGoalDirection, setNewGoalDirection] = useState('')
  const [creating, setCreating] = useState(false)
  const [newStepTopic, setNewStepTopic] = useState('')
  const [addingStepTo, setAddingStepTo] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!newGoalTitle.trim()) return
    setCreating(true)
    try {
      await onCreateGoal(newGoalTitle.trim(), newGoalDesc.trim() || undefined, newGoalDirection.trim() || undefined)
      setNewGoalTitle('')
      setNewGoalDesc('')
      setNewGoalDirection('')
      setShowCreateForm(false)
    } finally {
      setCreating(false)
    }
  }

  const handleAddStep = async (goalId: string) => {
    if (!newStepTopic.trim()) return
    setAddingStepTo(goalId)
    try {
      await onAddStep(goalId, newStepTopic.trim())
      setNewStepTopic('')
    } finally {
      setAddingStepTo(null)
    }
  }

  const activeGoals = goals.filter(g => g.status === 'active')
  const completedGoals = goals.filter(g => g.status === 'completed')

  return (
    <div className="space-y-4">
      {/* 创建目标 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <Target className="text-violet-500 dark:text-violet-400" size={16} />
          探索目标
          <span className="text-xs text-text-faint font-normal">({activeGoals.length} 个活跃)</span>
        </h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-1 rounded-md bg-text-primary px-3 py-1.5 text-xs font-medium text-inset transition-opacity hover:opacity-90"
        >
          {showCreateForm ? <ChevronDown size={12} /> : <Plus size={12} />}
          新目标
        </button>
      </div>

      {/* 创建表单 */}
      {showCreateForm && (
        <div className="space-y-3 rounded-lg border border-border-subtle/60 bg-surface/[0.06] p-4">
          <input
            type="text"
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            placeholder="目标标题（如：研究赚钱方法）"
            className="w-full bg-transparent text-sm text-text-primary placeholder-text-faint focus:outline-none border-b border-border-subtle/50 dark:border-slate-700/50 pb-2"
            autoFocus
          />
          <input
            type="text"
            value={newGoalDirection}
            onChange={(e) => setNewGoalDirection(e.target.value)}
            placeholder="方向标签（如：副业/被动收入）"
            className="w-full bg-transparent text-xs text-text-secondary placeholder-text-faint focus:outline-none"
          />
          <textarea
            value={newGoalDesc}
            onChange={(e) => setNewGoalDesc(e.target.value)}
            placeholder="描述（可选）"
            rows={2}
            className="w-full bg-transparent text-xs text-text-secondary placeholder-text-faint focus:outline-none resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!newGoalTitle.trim() || creating}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              创建
            </button>
          </div>
        </div>
      )}

      {/* 活跃目标列表 */}
      {activeGoals.length === 0 && !showCreateForm && (
        <div className="text-center py-12 text-text-faint">
          <Target size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">还没有探索目标</p>
          <p className="text-xs mt-1">给缪斯设定一个方向，让它开始自主探索</p>
        </div>
      )}

      <div className="space-y-3">
        {activeGoals.map(goal => {
          const isExpanded = expandedGoal === goal.id
          const steps = goal.exploreSteps || []
          const completedSteps = steps.filter(s => s.status === 'completed').length
          const totalSteps = steps.length
          const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
          const statusInfo = STATUS_LABELS[goal.status] || STATUS_LABELS.active

          return (
            <div
              key={goal.id}
              className="rounded-xl border border-border-subtle/40 dark:border-slate-700/40 bg-surface/40 dark:bg-slate-800/30 overflow-hidden"
            >
              {/* 目标头部 */}
              <button
                onClick={() => setExpandedGoal(isExpanded ? null : goal.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-text-primary/[0.03] dark:hover:bg-white/[0.02] transition-colors text-left"
              >
                {isExpanded ? <ChevronDown size={14} className="text-text-faint shrink-0" /> : <ChevronRight size={14} className="text-text-faint shrink-0" />}
                <Target size={15} className="text-violet-500 dark:text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary dark:text-slate-200 truncate">{goal.title}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusInfo.color}`}>{statusInfo.label}</span>
                  </div>
                  {goal.direction && (
                    <span className="text-[11px] text-text-faint">📍 {goal.direction}</span>
                  )}
                </div>
                {/* 进度环 */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-xs font-medium text-text-secondary dark:text-slate-300">{progress}%</div>
                    <div className="text-[10px] text-text-faint">{completedSteps}/{totalSteps} 步</div>
                  </div>
                  <div className="w-12 h-12 relative">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" className="text-border-subtle dark:text-slate-700/50" />
                      <circle
                        cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3"
                        className="text-violet-500 dark:text-violet-400 transition-all"
                        strokeDasharray={`${2 * Math.PI * 20}`}
                        strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    {(goal.insights || []).length > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-text-muted">
                        <Lightbulb size={10} className="text-amber-400" />
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="border-t border-border-subtle/30 dark:border-slate-700/30 px-4 py-3 space-y-3">
                  {/* 描述 */}
                  {goal.description && (
                    <p className="text-xs text-text-muted leading-relaxed">{goal.description}</p>
                  )}

                  {/* 探索步骤 */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Flag size={12} className="text-text-faint" />
                      <span className="text-[11px] font-medium text-text-secondary dark:text-slate-400">探索步骤</span>
                    </div>
                    {steps.length === 0 ? (
                      <p className="text-[11px] text-text-faint italic ml-4">暂无步骤，添加一个探索方向</p>
                    ) : (
                      <div className="space-y-1.5 ml-4">
                        {steps.map((step, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-xs">
                            {step.status === 'completed' ? (
                              <CheckCircle2 size={13} className="text-emerald-500 dark:text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                              <Circle size={13} className="text-text-faint shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <span className={step.status === 'completed' ? 'text-text-muted line-through' : 'text-text-secondary dark:text-slate-300'}>
                                {step.topic}
                              </span>
                              {step.completedAt && (
                                <span className="text-[10px] text-text-faint ml-2">
                                  {new Date(step.completedAt).toISOString().slice(0, 10)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 添加步骤 */}
                    <div className="flex items-center gap-2 ml-4 mt-2">
                      <input
                        type="text"
                        value={addingStepTo === goal.id ? newStepTopic : ''}
                        onChange={(e) => { setAddingStepTo(goal.id); setNewStepTopic(e.target.value) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newStepTopic.trim()) { handleAddStep(goal.id) } }}
                        placeholder="添加探索步骤..."
                        className="flex-1 bg-transparent text-xs text-text-secondary placeholder-text-faint focus:outline-none border-b border-border-subtle/30 dark:border-slate-700/30 pb-1"
                      />
                      {addingStepTo === goal.id && newStepTopic.trim() && (
                        <button
                          onClick={() => handleAddStep(goal.id)}
                          disabled={addingStepTo === goal.id && !newStepTopic.trim()}
                          className="text-violet-500 hover:text-violet-400 transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 洞察 */}
                  {(goal.insights || []).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Lightbulb size={12} className="text-amber-400" />
                        <span className="text-[11px] font-medium text-text-secondary dark:text-slate-400">积累洞察 ({goal.insights.length})</span>
                      </div>
                      <div className="space-y-1.5 ml-4">
                        {goal.insights.map((insight, idx) => (
                          <div key={idx} className="text-xs">
                            <span className="text-text-secondary dark:text-slate-300 font-medium">{insight.title}</span>
                            {insight.summary && (
                              <p className="text-[11px] text-text-faint mt-0.5 line-clamp-2">{insight.summary}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 操作 */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border-subtle/20 dark:border-slate-700/20">
                    <button
                      onClick={() => onCompleteGoal(goal.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all"
                    >
                      <CheckCircle2 size={11} />
                      完成目标
                    </button>
                    <button
                      onClick={() => onDeleteGoal(goal.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-rose-500/10 text-rose-500 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                    >
                      <Trash2 size={11} />
                      删除
                    </button>
                    <span className="ml-auto text-[10px] text-text-faint">
                      创建于 {new Date(goal.createdAt).toISOString().slice(0, 10)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 已完成目标 */}
      {completedGoals.length > 0 && (
        <div className="pt-4">
          <div className="flex items-center gap-1.5 mb-2 text-text-faint">
            <CheckCircle2 size={12} />
            <span className="text-[11px] font-medium">已完成的目标 ({completedGoals.length})</span>
          </div>
          <div className="space-y-1">
            {completedGoals.map(goal => (
              <div key={goal.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/30 dark:bg-slate-800/20 text-xs">
                <CheckCircle2 size={12} className="text-cyan-500 dark:text-cyan-400 shrink-0" />
                <span className="text-text-muted truncate flex-1">{goal.title}</span>
                <span className="text-[10px] text-text-faint">
                  {(goal.exploreSteps || []).length} 步 · {(goal.insights || []).length} 洞察
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default GoalsTab

import React, { useState, useCallback } from 'react'
import {
  TrendingUp, Search, Brain, Target, Award, BookOpen,
  Sparkles, Loader2, ChevronRight, Zap
} from 'lucide-react'

interface AutonomyState {
  level: number
  levelName: string
  levelDesc: string
  confirmThreshold: string
  successRate: number
  metrics: {
    totalTasks: number
    recentResults: Array<{ success: boolean; domain: string; at: string }>
    domainCoverage: string[]
    totalExplores: number
    totalInsights: number
  }
  lastEvaluatedAt: string | null
  levelHistory: Array<{
    from: number
    to: number
    at: string
    metrics: {
      totalTasks: number
      successRate: number
      domainCount: number
      totalExplores: number
      totalInsights: number
    }
  }>
}

interface KnowledgeResults {
  memories: Array<{ id: string; content: string; domain: string; integration: number; created_at: string }>
  insights: Array<{ file: string; title: string; summary: string; matchScore: number }>
  summaries: Array<{ id: string; summary: string; sourceCount: number; created_at: string }>
}

interface GrowthTabProps {
  autonomyState: AutonomyState | null
  knowledgeResults: KnowledgeResults | null
  onSearchKnowledge: (keyword: string, limit?: number) => Promise<void>
  onEvaluateAutonomy: () => Promise<void>
}

const LEVEL_META = [
  { name: '新手', icon: '🌱', color: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-500', desc: '所有任务都需要确认' },
  { name: '成长', icon: '🌿', color: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/30 text-cyan-500', desc: '简单任务直接执行' },
  { name: '成熟', icon: '🌳', color: 'from-violet-500/20 to-violet-600/5 border-violet-500/30 text-violet-500', desc: '仅高风险确认' },
  { name: '自主', icon: '⚡', color: 'from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-500', desc: '几乎不确认，事后汇报' },
]

const LEVEL_CRITERIA = [
  { tasks: 10, domains: 3, successRate: 0.60 },
  { tasks: 30, domains: 5, successRate: 0.75 },
  { tasks: 50, domains: 8, successRate: 0.85 },
]

const GrowthTab: React.FC<GrowthTabProps> = ({ autonomyState, knowledgeResults, onSearchKnowledge, onEvaluateAutonomy }) => {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [evaluating, setEvaluating] = useState(false)

  const handleSearch = async () => {
    if (!searchKeyword.trim()) return
    setSearching(true)
    try {
      await onSearchKnowledge(searchKeyword.trim(), 20)
    } finally {
      setSearching(false)
    }
  }

  const handleEvaluate = async () => {
    setEvaluating(true)
    try {
      await onEvaluateAutonomy()
    } finally {
      setEvaluating(false)
    }
  }

  if (!autonomyState) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-violet-400" size={32} />
      </div>
    )
  }

  const level = autonomyState.level
  const levelMeta = LEVEL_META[level] || LEVEL_META[0]
  const metrics = autonomyState.metrics || { totalTasks: 0, recentResults: [], domainCoverage: [], totalExplores: 0, totalInsights: 0 }
  const successRate = autonomyState.successRate || 0
  const criteria = LEVEL_CRITERIA[level]
  const isMaxLevel = level >= 3

  // 计算进度
  const taskProgress = criteria ? Math.min(100, Math.round((metrics.totalTasks / criteria.tasks) * 100)) : 100
  const domainProgress = criteria ? Math.min(100, Math.round(((metrics.domainCoverage || []).length / criteria.domains) * 100)) : 100
  const successProgress = criteria ? Math.min(100, Math.round((successRate / criteria.successRate) * 100)) : 100

  return (
    <div className="space-y-5">
      {/* 等级徽章 */}
      <div className={`p-5 rounded-2xl bg-gradient-to-br border ${levelMeta.color} backdrop-blur-sm`}>
        <div className="flex items-center gap-4">
          <div className="text-4xl">{levelMeta.icon}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">Lv.{level}</span>
              <span className="text-lg font-medium">{levelMeta.name}</span>
            </div>
            <p className="text-xs opacity-70 mt-0.5">{levelMeta.desc}</p>
            <p className="text-[11px] opacity-50 mt-1">确认阈值: {autonomyState.confirmThreshold}</p>
          </div>
          {!isMaxLevel && (
            <button
              onClick={handleEvaluate}
              disabled={evaluating}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md bg-white/10 hover:bg-white/20 transition-all disabled:opacity-50"
            >
              {evaluating ? <Loader2 size={11} className="animate-spin" /> : <TrendingUp size={11} />}
              评估升级
            </button>
          )}
        </div>
      </div>

      {/* 成长指标 */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard
          icon={Target}
          label="总任务"
          value={metrics.totalTasks || 0}
          subtext={criteria ? `下一级 ${criteria.tasks}` : '已满级'}
          progress={taskProgress}
          color="violet"
        />
        <MetricCard
          icon={Zap}
          label="成功率"
          value={`${Math.round(successRate * 100)}%`}
          subtext={criteria ? `下一级 ${Math.round(criteria.successRate * 100)}%` : '已满级'}
          progress={successProgress}
          color="emerald"
        />
        <MetricCard
          icon={Brain}
          label="领域覆盖"
          value={`${(metrics.domainCoverage || []).length}`}
          subtext={criteria ? `下一级 ${criteria.domains}` : '已满级'}
          progress={domainProgress}
          color="cyan"
        />
        <MetricCard
          icon={Sparkles}
          label="探索/洞察"
          value={`${metrics.totalExplores || 0}/${metrics.totalInsights || 0}`}
          subtext="次探索/条洞察"
          color="amber"
        />
      </div>

      {/* 能力标签 */}
      <div className="p-4 rounded-xl bg-surface/40 dark:bg-slate-800/30 border border-border-subtle/40 dark:border-slate-700/40">
        <div className="flex items-center gap-2 mb-3">
          <Award size={14} className="text-amber-500" />
          <span className="text-sm font-medium text-text-secondary dark:text-slate-300">能力标签</span>
        </div>
        {(metrics.domainCoverage || []).length === 0 ? (
          <p className="text-xs text-text-faint italic">暂无积累的领域，完成任务后自动生成</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {metrics.domainCoverage.map((domain, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 text-xs rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20"
              >
                {domain}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 等级历史 */}
      {(autonomyState.levelHistory || []).length > 0 && (
        <div className="p-4 rounded-xl bg-surface/40 dark:bg-slate-800/30 border border-border-subtle/40 dark:border-slate-700/40">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-cyan-500" />
            <span className="text-sm font-medium text-text-secondary dark:text-slate-300">成长历程</span>
          </div>
          <div className="space-y-2">
            {(autonomyState.levelHistory || []).map((entry, idx) => (
              <div key={idx} className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-text-faint">{LEVEL_META[entry.from]?.icon}</span>
                  <ChevronRight size={10} className="text-text-faint" />
                  <span className="text-text-secondary dark:text-slate-300">{LEVEL_META[entry.to]?.icon}</span>
                </div>
                <span className="text-text-muted">
                  升级为「{LEVEL_META[entry.to]?.name}」
                </span>
                <span className="text-[10px] text-text-faint ml-auto">
                  {new Date(entry.at).toISOString().slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 知识检索 */}
      <div className="p-4 rounded-xl bg-surface/40 dark:bg-slate-800/30 border border-border-subtle/40 dark:border-slate-700/40">
        <div className="flex items-center gap-2 mb-3">
          <Search size={14} className="text-violet-500 dark:text-violet-400" />
          <span className="text-sm font-medium text-text-secondary dark:text-slate-300">知识检索</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && searchKeyword.trim()) handleSearch() }}
            placeholder="搜索缪斯的记忆、洞察、归纳..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-faint focus:outline-none border-b border-border-subtle/30 dark:border-slate-700/30 pb-1"
          />
          <button
            onClick={handleSearch}
            disabled={!searchKeyword.trim() || searching}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            搜索
          </button>
        </div>

        {/* 搜索结果 */}
        {knowledgeResults && (
          <div className="space-y-3">
            {/* 记忆碎片 */}
            {knowledgeResults.memories.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Brain size={11} className="text-violet-400" />
                  <span className="text-[11px] font-medium text-text-muted">记忆碎片 ({knowledgeResults.memories.length})</span>
                </div>
                <div className="space-y-1.5">
                  {knowledgeResults.memories.map((mem, idx) => (
                    <div key={idx} className="px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400">{mem.domain}</span>
                        <span className="text-[10px] text-text-faint">
                          整合度 {Math.round((mem.integration || 0) * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary dark:text-slate-300 line-clamp-2">{mem.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 洞察报告 */}
            {knowledgeResults.insights.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BookOpen size={11} className="text-cyan-400" />
                  <span className="text-[11px] font-medium text-text-muted">洞察报告 ({knowledgeResults.insights.length})</span>
                </div>
                <div className="space-y-1.5">
                  {knowledgeResults.insights.map((ins, idx) => (
                    <div key={idx} className="px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                      <span className="text-xs font-medium text-text-secondary dark:text-slate-300">{ins.title}</span>
                      <p className="text-[11px] text-text-faint mt-0.5 line-clamp-2">{ins.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 归纳摘要 */}
            {knowledgeResults.summaries.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={11} className="text-amber-400" />
                  <span className="text-[11px] font-medium text-text-muted">归纳摘要 ({knowledgeResults.summaries.length})</span>
                </div>
                <div className="space-y-1.5">
                  {knowledgeResults.summaries.map((sum, idx) => (
                    <div key={idx} className="px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                      <p className="text-xs text-text-secondary dark:text-slate-300 line-clamp-2">{sum.summary}</p>
                      <span className="text-[10px] text-text-faint">来源 {sum.sourceCount} 条碎片</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 空结果 */}
            {knowledgeResults.memories.length === 0 &&
             knowledgeResults.insights.length === 0 &&
             knowledgeResults.summaries.length === 0 && (
              <p className="text-xs text-text-faint italic text-center py-4">未找到相关知识</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const MetricCard: React.FC<{
  icon: React.FC<any>
  label: string
  value: string | number
  subtext: string
  progress?: number
  color: string
}> = ({ icon: Icon, label, value, subtext, progress, color }) => {
  const colorMap: Record<string, string> = {
    violet: 'text-violet-500 dark:text-violet-400',
    emerald: 'text-emerald-500 dark:text-emerald-400',
    cyan: 'text-cyan-500 dark:text-cyan-400',
    amber: 'text-amber-500 dark:text-amber-400',
  }

  return (
    <div className="p-3 rounded-xl bg-surface/40 dark:bg-slate-800/30 border border-border-subtle/30 dark:border-slate-700/30">
      <Icon size={13} className={`${colorMap[color]} mb-1.5`} />
      <div className="text-lg font-bold text-text-primary dark:text-slate-200">{value}</div>
      <div className="text-[10px] text-text-faint">{label}</div>
      <div className="text-[9px] text-text-faint mt-0.5 opacity-60">{subtext}</div>
      {progress !== undefined && progress < 100 && (
        <div className="mt-1.5 h-1 rounded-full bg-text-primary/5 dark:bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full ${colorMap[color]} bg-current opacity-50 transition-all`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default GrowthTab

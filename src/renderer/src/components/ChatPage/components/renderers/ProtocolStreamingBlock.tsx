import React, { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, Sparkles, FileCode2, FormInput, Terminal, ListChecks, Bot } from 'lucide-react'

export type ProtocolKind = 'artifact' | 'rich_form' | 'script' | 'command_options' | 'muse_task' | 'search_replace'

interface ProtocolStreamingBlockProps {
  kind: ProtocolKind
  label: string
  draft: string
  /** 仅 muse_task：点击气泡主体时打开右侧任务进展面板 */
  onOpenTaskProgress?: () => void
}

const KIND_ICON: Record<ProtocolKind, React.ComponentType<{ size?: number; className?: string }>> = {
  artifact: Sparkles,
  rich_form: FormInput,
  script: Terminal,
  command_options: ListChecks,
  muse_task: Bot,
  search_replace: FileCode2,
}

/**
 * 流式中识别到协议时的折叠状态条 — 对标深度思考模式。
 * 一行「正在生成 XX…」+ 呼吸点动画，默认收起协议原文，可点击展开查看。
 * 解析完成后由上层替换为最终卡片，本组件仅在流式阶段呈现。
 */
export function ProtocolStreamingBlock({ kind, label, draft, onOpenTaskProgress }: ProtocolStreamingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const reduceMotion = useReducedMotion()
  const Icon = KIND_ICON[kind] || Sparkles
  const lineCount = draft ? draft.split('\n').length : 0

  // muse_task 任务态：点击主体打开右侧任务进展面板；其余协议态点击主体仅展开原文。
  const isTaskBlock = !!onOpenTaskProgress
  const handleMainClick = isTaskBlock ? onOpenTaskProgress : () => setExpanded(!expanded)

  return (
    <div className="my-2 rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/60 to-purple-50/40 overflow-hidden">
      <button
        onClick={handleMainClick}
        title={isTaskBlock ? '查看右侧任务进展' : undefined}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-indigo-100/40 transition-colors"
      >
        <Icon size={14} className="text-indigo-500 flex-shrink-0" />
        <span className="text-xs font-medium text-indigo-600">{label}</span>
        <BreathingDots reduceMotion={reduceMotion} />
        <span className="flex-1" />
        {isTaskBlock && (
          <span className="text-xs text-indigo-400 flex-shrink-0">查看进展</span>
        )}
        {draft && <span className="text-xs text-slate-400 flex-shrink-0">{lineCount} 行</span>}
        {/* 任务态：箭头作为独立的「展开原文」按钮，避免与打开面板冲突 */}
        {isTaskBlock && draft ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-indigo-200/50 cursor-pointer"
            title={expanded ? '收起原文' : '展开原文'}
          >
            {expanded
              ? <ChevronDown size={14} className="text-slate-400" />
              : <ChevronRight size={14} className="text-slate-400" />
            }
          </span>
        ) : (
          (expanded
            ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
            : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
          )
        )}
      </button>
      {expanded && draft && (
        <div className="px-4 pb-3 max-h-[300px] overflow-y-auto text-xs text-slate-500 leading-relaxed font-mono whitespace-pre-wrap border-t border-indigo-100">
          {draft}
        </div>
      )}
    </div>
  )
}

/** 三点呼吸动画 — 与思考态一致的生命感，reduceMotion 时退化为静态点 */
function BreathingDots({ reduceMotion }: { reduceMotion: boolean | null }) {
  if (reduceMotion) {
    return (
      <span className="inline-flex gap-1 items-center">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
        ))}
      </span>
    )
  }

  return (
    <span className="inline-flex gap-1 items-center">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-indigo-400"
          animate={{ scale: [1, 1.5, 1], opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  )
}

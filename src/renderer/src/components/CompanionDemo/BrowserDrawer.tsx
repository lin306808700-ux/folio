import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, RotateCw, ExternalLink, X, Lock, Sparkles, Bot, Brain, Terminal } from 'lucide-react'
import { ReactStepsView } from './ReactStepsView'
import { MiniTerminal } from './MiniTerminal'

export type DrawerTrigger = 'artifact' | 'automation' | 'react' | 'terminal'

export interface DrawerState {
  open: boolean
  trigger: DrawerTrigger
  url: string
  title: string
  /** 是否已弹成独立窗口（弹出后抽屉内显占位态） */
  poppedOut: boolean
}

interface BrowserDrawerProps {
  state: DrawerState
  width: number
  onClose: () => void
  onPopOut: () => void
  onPopBack: () => void
}

/**
 * 按需召唤的浏览器抽屉（伴侣 Demo · 纯前端模拟）
 *
 * 定位：网页默认不常驻，仅在两类场景从右缘滑入——
 * - artifact：Muse 交付了可视产物（HTML/简历等），自动摆出来给你看
 * - automation：agent 正在自动操作页面，让你能盯着过程
 *
 * 形态固定为右缘抽屉（贴合真实 BrowserView 的 setBounds 机制）。
 * 需要边对比边操作时，点「弹出」脱离成独立窗口（此处用占位态模拟）。
 */
export function BrowserDrawer({ state, width, onClose, onPopOut, onPopBack }: BrowserDrawerProps) {
  return (
    <AnimatePresence>
      {state.open && (
        <motion.div
          initial={{ x: '100%', opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.6 }}
          transition={{ type: 'spring', stiffness: 220, damping: 28 }}
          style={{ width }}
          className="absolute right-0 top-0 bottom-0 z-30 flex flex-col bg-slate-900/80 backdrop-blur-2xl border-l border-white/10 shadow-2xl shadow-black/50"
        >
          <DrawerHeader state={state} onClose={onClose} onPopOut={onPopOut} />

          <div className="flex-1 min-h-0 relative">
            {state.poppedOut ? (
              <PoppedOutPlaceholder onPopBack={onPopBack} />
            ) : (
              <DrawerContent trigger={state.trigger} url={state.url} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DrawerHeader({ state, onClose, onPopOut }: { state: DrawerState; onClose: () => void; onPopOut: () => void }) {
  const { icon: TriggerBadge, text: badgeText, color: badgeColor } = TRIGGER_META[state.trigger]

  return (
    <div className="flex-shrink-0 border-b border-white/10">
      {/* 来源标签 */}
      <div className="flex items-center justify-between px-3 pt-3">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${badgeColor}`}>
          <TriggerBadge size={11} />
          {badgeText}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onPopOut}
            disabled={state.poppedOut}
            title="弹出为独立窗口"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <ExternalLink size={14} />
          </button>
          <button
            onClick={onClose}
            title="收起"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/55 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 地址栏（仅浏览器类 trigger 显示） */}
      {(state.trigger === 'artifact' || state.trigger === 'automation') && (
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-white/35">
            <RotateCw size={13} className={state.trigger === 'automation' && !state.poppedOut ? 'animate-spin' : ''} />
          </div>
          <div className="flex-1 flex items-center gap-1.5 min-w-0 px-3 py-1.5 rounded-lg bg-black/30 text-xs text-white/70">
            <Lock size={11} className="text-emerald-400/70 flex-shrink-0" />
            <span className="truncate">{state.url}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** TRIGGER_META — 各触发类型的图标/文案/颜色映射 */
const TRIGGER_META: Record<DrawerTrigger, { icon: any; text: string; color: string }> = {
  artifact: { icon: Sparkles, text: '产物预览', color: 'text-emerald-300 bg-emerald-400/10' },
  automation: { icon: Bot, text: 'Muse 正在操作', color: 'text-cyan-300 bg-cyan-400/10' },
  react: { icon: Brain, text: '思考过程', color: 'text-violet-300 bg-violet-400/10' },
  terminal: { icon: Terminal, text: '执行中', color: 'text-green-300 bg-green-400/10' },
}

/** 根据 trigger 类型渲染不同内容视窗 */
function DrawerContent({ trigger, url }: { trigger: DrawerTrigger; url: string }) {
  switch (trigger) {
    case 'react':
      return <ReactStepsView />
    case 'terminal':
      return <MiniTerminal />
    default:
      return <FakePagePreview trigger={trigger} url={url} />
  }
}

/** 假网页预览 — 用占位骨架模拟一个加载完成的页面，区分两种来源 */
function FakePagePreview({ trigger, url }: { trigger: DrawerTrigger; url: string }) {
  if (trigger === 'artifact') {
    return (
      <div className="absolute inset-0 overflow-y-auto bg-white">
        {/* 模拟一份产物页面（如简历预览） */}
        <div className="max-w-md mx-auto px-8 py-10">
          <div className="h-7 w-40 bg-slate-800 rounded mb-1.5" />
          <div className="h-3 w-56 bg-slate-300 rounded mb-6" />
          <div className="space-y-2.5">
            <div className="h-2.5 w-full bg-slate-200 rounded" />
            <div className="h-2.5 w-11/12 bg-slate-200 rounded" />
            <div className="h-2.5 w-4/5 bg-slate-200 rounded" />
          </div>
          <div className="mt-8 h-4 w-28 bg-indigo-500/80 rounded mb-3" />
          <div className="space-y-2.5">
            <div className="h-2.5 w-full bg-slate-200 rounded" />
            <div className="h-2.5 w-10/12 bg-slate-200 rounded" />
            <div className="h-2.5 w-3/4 bg-slate-200 rounded" />
            <div className="h-2.5 w-5/6 bg-slate-200 rounded" />
          </div>
          <div className="mt-8 h-4 w-24 bg-indigo-500/80 rounded mb-3" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-slate-100 border border-slate-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // automation：模拟 agent 正在操作的网站
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-50">
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5 gap-4">
        <div className="h-3.5 w-20 bg-cyan-500/80 rounded" />
        <div className="flex-1" />
        <div className="h-3 w-12 bg-slate-300 rounded" />
        <div className="h-3 w-12 bg-slate-300 rounded" />
      </div>
      <div className="p-6 space-y-4">
        <div className="h-32 bg-gradient-to-br from-cyan-100 to-indigo-100 rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 bg-white border border-slate-200 rounded-lg" />
          {/* agent 正在「点击」的高亮元素 */}
          <motion.div
            className="h-20 bg-white border-2 border-cyan-400 rounded-lg relative"
            animate={{ boxShadow: ['0 0 0 0 rgba(34,211,238,0.4)', '0 0 0 8px rgba(34,211,238,0)'] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500 text-white">
              点击中
            </div>
          </motion.div>
        </div>
        <div className="h-2.5 w-full bg-slate-200 rounded" />
        <div className="h-2.5 w-2/3 bg-slate-200 rounded" />
      </div>
      {/* 模拟 agent 光标 */}
      <motion.div
        className="absolute w-3 h-3 rounded-full bg-cyan-500/80 ring-2 ring-white pointer-events-none"
        animate={{ left: ['30%', '72%', '72%', '30%'], top: ['55%', '48%', '48%', '55%'] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

/** 已弹出独立窗口 — 抽屉内显占位，引导收回 */
function PoppedOutPlaceholder({ onPopBack }: { onPopBack: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/40">
        <Globe size={26} />
      </div>
      <div>
        <p className="text-sm text-white/70 font-medium">页面已弹出为独立窗口</p>
        <p className="text-xs text-white/40 mt-1.5 leading-relaxed">
          现在你可以把它和其他窗口并排，
          <br />
          边对比边操作。
        </p>
      </div>
      <button
        onClick={onPopBack}
        className="mt-1 px-4 py-1.5 rounded-lg text-xs font-medium text-white/80 bg-white/[0.08] hover:bg-white/[0.14] transition-colors"
      >
        收回到抽屉
      </button>
    </div>
  )
}

export default BrowserDrawer

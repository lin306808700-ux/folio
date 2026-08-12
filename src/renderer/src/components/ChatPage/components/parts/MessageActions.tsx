import React from 'react'
import { Quote, X } from 'lucide-react'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** hover 时浮现的操作按钮 — 意识体风格：毛玻璃 + 紫色光晕，无实色块 */
export function MessageActions() {
  const { msg, onQuote, onDeleteMessage } = useMessageBubbleContext()

  if (!onQuote) return null
  if (['error', 'task_planning', 'task_progress', 'task_confirm'].includes(msg.type || '')) return null

  const isUser = msg.role === 'user'

  return (
    <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 max-md:opacity-100 transition-opacity duration-200 z-20 flex gap-1">
      {/* 引用 — 轻触即引 */}
      <button
        onClick={(e) => { e.stopPropagation(); onQuote(msg); }}
        className={`p-2 rounded-lg transition-all duration-150 ${
          isUser
            ? 'bg-white/20 hover:bg-white/35 text-white/70 hover:text-white border border-white/15 hover:border-white/30'
            : 'bg-white/[0.08] hover:bg-violet-500/20 text-white/50 hover:text-violet-300 border border-white/[0.08] hover:border-violet-400/30'
        }`}
        title="引用此消息"
        aria-label="引用此消息"
      >
        <Quote size={14} strokeWidth={1.8} />
      </button>

      {/* 删除 — 静默消融 */}
      {onDeleteMessage && (
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteMessage(msg.id); }}
          className={`p-2 rounded-lg transition-all duration-150 ${
            isUser
              ? 'bg-white/20 hover:bg-white/35 text-white/70 hover:text-white border border-white/15 hover:border-white/30'
              : 'bg-white/[0.08] hover:bg-white/[0.15] text-white/50 hover:text-white/80 border border-white/[0.08] hover:border-white/15'
          }`}
        title="删除此消息"
        aria-label="删除此消息"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

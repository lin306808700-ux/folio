import React from 'react'
import { Quote, ChevronRight } from 'lucide-react'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** 引用消息缩略 — 半透明浮现，紫色微光边线 */
export function QuotedMessageBar() {
  const { msg, onScrollToMessage } = useMessageBubbleContext()

  if (!msg.quotedMessage || !onScrollToMessage) return null

  const isFromUser = msg.quotedMessage.role === 'user'

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onScrollToMessage(msg.quotedMessage!.messageId); }}
      className="w-full mb-3 flex items-start gap-2 px-3 py-2 rounded-r-lg transition-all duration-200 text-left group/quote
        bg-white/[0.04] hover:bg-white/[0.08] border-l border-violet-400/30 hover:border-violet-400/50"
      title="点击跳转到被引用的消息"
    >
      <div className="flex-shrink-0 mt-0.5">
        <Quote size={12} className="text-violet-400/50" strokeWidth={1.6} />
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
          isFromUser
            ? 'bg-white/[0.08] text-white/40'
            : 'bg-violet-500/10 text-violet-300/60'
        }`}>
          {isFromUser ? '你' : 'Muse'}
        </span>
        <p className="text-[11px] text-white/30 truncate mt-1 leading-relaxed">
          {msg.quotedMessage.summary}
        </p>
      </div>
      <ChevronRight size={12} className="text-white/15 flex-shrink-0 mt-1 opacity-0 group-hover/quote:opacity-100 transition-opacity duration-200" strokeWidth={1.5} />
    </button>
  )
}

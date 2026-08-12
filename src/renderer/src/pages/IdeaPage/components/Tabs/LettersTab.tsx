import React, { useState } from 'react'
import { Mail, MailOpen, Clock, ChevronRight, Send, Loader2, AlertTriangle, CheckCircle, XCircle, MessageSquare, Trash2 } from 'lucide-react'
import { Letter, isDecisionLetter } from '../../types'
import { formatTime } from '../../utils/format'

interface LettersTabProps {
  letters: Letter[]
  expandedLetter: string | null
  onExpand: (id: string) => void
  replyText: string
  onReplyTextChange: (text: string) => void
  onReply: (id: string) => void
  onDelete: (id: string) => void
  replyLoading: boolean
}

/** 决策回复区域：等待确认的来信显示快捷按钮，普通来信显示文本输入 */
const DecisionReplyArea: React.FC<{
  letter: Letter
  replyText: string
  onReplyTextChange: (text: string) => void
  onReply: (id: string) => void
  replyLoading: boolean
}> = ({ letter, replyText, onReplyTextChange, onReply, replyLoading }) => {
  const isDecision = isDecisionLetter(letter)
  const [showCustomInput, setShowCustomInput] = useState(false)

  const handleQuickReply = (text: string) => {
    onReplyTextChange(text)
    setTimeout(() => onReply(letter.id), 50)
  }

  if (!isDecision || showCustomInput) {
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={replyText}
            onChange={e => onReplyTextChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onReply(letter.id) } }}
            placeholder={isDecision ? '输入你的想法...' : '给缪斯留言...'}
            className="flex-1 px-3 py-2 rounded-xl bg-inset dark:bg-slate-800 border border-border-subtle dark:border-slate-700/50 text-sm text-text-primary placeholder-text-faint focus:outline-none focus:border-violet-500/50"
          />
          <button
            onClick={() => onReply(letter.id)}
            disabled={!replyText.trim() || replyLoading}
            className="p-2 rounded-xl bg-violet-500/20 text-violet-600 dark:text-violet-400 hover:bg-violet-500/30 transition-colors disabled:opacity-30"
          >
            {replyLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
          {isDecision && (
            <button
              onClick={() => setShowCustomInput(false)}
              className="text-[10px] text-text-faint hover:text-text-muted transition-colors"
            >
              返回
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400/80 font-medium">
        <AlertTriangle size={10} />
        等待你的确认
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleQuickReply('确认，按这个方案执行')}
          disabled={replyLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors text-sm font-medium disabled:opacity-30"
        >
          {replyLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
          确认执行
        </button>
        <button
          onClick={() => handleQuickReply('不行，取消这个任务')}
          disabled={replyLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors text-sm disabled:opacity-30"
        >
          <XCircle size={13} />
          拒绝
        </button>
        <button
          onClick={() => setShowCustomInput(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-elevated dark:bg-slate-700/50 text-text-secondary dark:text-slate-300 border border-border-subtle dark:border-slate-600/30 hover:bg-surface dark:hover:bg-slate-700/70 transition-colors text-sm"
        >
          <MessageSquare size={13} />
          自定义回复
        </button>
      </div>
    </div>
  )
}

const LettersTab: React.FC<LettersTabProps> = ({
  letters,
  expandedLetter,
  onExpand,
  replyText,
  onReplyTextChange,
  onReply,
  onDelete,
  replyLoading
}) => {
  if (letters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-muted">
        <Mail size={40} className="mb-4 opacity-30" />
        <p className="text-sm">信箱是空的。缪斯正在后台思考，有发现会给你写信。</p>
      </div>
    )
  }

  const priorityConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    high: { color: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20', icon: <AlertTriangle size={10} /> },
    normal: { color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20', icon: null },
    low: { color: 'text-text-muted bg-text-primary/[0.06] border-border-subtle/40', icon: null }
  }

  return (
    <div className="space-y-3">
      {letters.map(letter => {
        const isExpanded = expandedLetter === letter.id
        const pCfg = priorityConfig[letter.priority] || priorityConfig.normal
        const isUnread = letter.status === 'unread'

        return (
          <div
            key={letter.id}
            className={`group rounded-lg border transition-colors ${
              isUnread
                ? 'bg-violet-500/5 border-violet-500/20 shadow-sm shadow-violet-500/10'
                : 'bg-surface/50 dark:bg-slate-800/40 border-border-subtle/50 dark:border-slate-700/50'
            }`}
          >
            <button
              onClick={() => onExpand(letter.id)}
              className="w-full flex items-center gap-3 p-4 text-left"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                isUnread ? 'bg-violet-500/20 text-violet-600 dark:text-violet-400' : 'bg-elevated dark:bg-slate-700/50 text-text-muted dark:text-slate-500'
              }`}>
                {isUnread ? <Mail size={16} /> : <MailOpen size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium truncate ${isUnread ? 'text-text-primary' : 'text-text-secondary dark:text-slate-300'}`}>
                    {letter.title}
                  </span>
                  {letter.priority === 'high' && (
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${pCfg.color}`}>
                      {pCfg.icon} 紧急
                    </span>
                  )}
                  {letter.status === 'replied' && (
                    <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">已回复</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Clock size={10} className="text-text-faint" />
                  <span className="text-[10px] text-text-faint">{formatTime(letter.created_at)}</span>
                  <span className="text-[10px] text-text-faint/60">·</span>
                  <span className="text-[10px] text-text-faint">{letter.source}</span>
                </div>
              </div>
              <ChevronRight size={14} className={`text-text-faint transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(letter.id) }}
                className="p-1.5 rounded-lg text-text-faint hover:text-rose-500 hover:bg-rose-500/10 transition-all shrink-0 opacity-0 group-hover:opacity-100"
                title="删除"
              >
                <Trash2 size={13} />
              </button>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 border-t border-border-subtle/50 dark:border-slate-700/30">
                <pre className="text-sm text-text-secondary dark:text-slate-300 leading-relaxed whitespace-pre-wrap font-sans mt-3">{letter.content}</pre>

                {letter.reply && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-500 font-bold mb-1">你的回复</div>
                    <p className="text-sm text-text-secondary dark:text-slate-300">{letter.reply}</p>
                  </div>
                )}

                {letter.status !== 'replied' && (
                  <DecisionReplyArea
                    letter={letter}
                    replyText={replyText}
                    onReplyTextChange={onReplyTextChange}
                    onReply={onReply}
                    replyLoading={replyLoading}
                  />
                )}

              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default LettersTab

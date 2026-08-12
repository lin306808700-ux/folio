import React, { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, ImageIcon, Quote } from 'lucide-react'
import type { ImageAttachment, ChatRequestEnvelope } from '../types'
import { detectTrigger, TriggerType } from '../hooks/useTriggerSearch'

interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  loading: boolean
  isElectron: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement>
  onClearMessages?: () => void
  onSlashInput?: (value: string | null) => void
  onTriggerInput?: (data: { trigger: TriggerType; filter: string } | null) => void
  attachedImages?: ImageAttachment[]
  onImagesChange?: (images: ImageAttachment[]) => void
  quotePreview?: string
  quoteRole?: 'user' | 'assistant'
  onClearQuote?: () => void
  queuedRequest?: ChatRequestEnvelope | null
  queuedCount?: number
  onCancelQueuedRequest?: () => void
}

export function ChatInput({
  input,
  onInputChange,
  onSend,
  onKeyDown,
  loading,
  isElectron,
  textareaRef,
  onClearMessages,
  onSlashInput,
  onTriggerInput,
  attachedImages = [],
  onImagesChange,
  quotePreview,
  quoteRole,
  onClearQuote,
  queuedRequest,
  queuedCount = 0,
  onCancelQueuedRequest
}: ChatInputProps) {
  // 发送瞬间从按钮迸发的紫色涟漪，呼应海洋场的上行涟漪
  const [sendRipple, setSendRipple] = useState<number | null>(null)

  const readFileAsDataUrl = (file: File): Promise<ImageAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve({
          dataUrl: reader.result as string,
          mimeType: file.type || 'image/png',
          name: file.name
        })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const imageItems = Array.from(e.clipboardData.items).filter(
      item => item.type.startsWith('image/')
    )
    if (imageItems.length === 0) return

    e.preventDefault()
    const newImages: ImageAttachment[] = []
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      const attachment = await readFileAsDataUrl(file)
      newImages.push(attachment)
    }
    if (newImages.length > 0 && onImagesChange) {
      onImagesChange([...attachedImages, ...newImages])
    }
  }, [attachedImages, onImagesChange])

  const removeImage = (index: number) => {
    if (!onImagesChange) return
    const updated = attachedImages.filter((_, i) => i !== index)
    onImagesChange(updated)
  }

  const handleSendDisabled = !input.trim() && attachedImages.length === 0

  return (
    <div className="p-4">
      {/* 快捷操作栏 */}
      <div className="flex items-center justify-end gap-1 px-3 mb-2">
        <span className="text-[10px] text-text-faint/70">⌘+Enter 发送 · @ 引用文件 · / 命令</span>
      </div>

      {/* 图片预览区 */}
      <AnimatePresence initial={false}>
        {queuedRequest && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            className="mx-2 mb-2 flex items-center gap-2 border-l-2 border-emerald-400/45 bg-emerald-500/[0.05] px-3 py-2"
          >
            <span className="text-[10px] font-semibold text-emerald-500">等待发送{queuedCount > 1 ? ` ${queuedCount}` : ''}</span>
            <p className="min-w-0 flex-1 truncate text-[11px] text-text-muted">{queuedRequest.text}</p>
            <button
              type="button"
              onClick={onCancelQueuedRequest}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-text-primary/[0.07] hover:text-text-primary"
              aria-label="取消等待发送的消息"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {quotePreview && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            className="mx-2 mb-2 flex items-start gap-2 border-l-2 border-violet-400/45 bg-text-primary/[0.035] px-3 py-2"
          >
            <Quote size={13} className="mt-0.5 flex-shrink-0 text-violet-400/70" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 text-[10px] font-medium text-violet-400/80">
                引用{quoteRole === 'assistant' ? ' Muse' : ''}
              </div>
              <p className="line-clamp-2 text-[11px] leading-relaxed text-text-muted">{quotePreview}</p>
            </div>
            <button
              type="button"
              onClick={onClearQuote}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-text-primary/[0.07] hover:text-text-primary"
              title="取消引用"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {attachedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-2">
          {attachedImages.map((img, index) => (
            <div key={index} className="relative group/img">
              <img
                src={img.dataUrl}
                alt={img.name || `图片${index + 1}`}
                className="h-20 w-auto max-w-[8rem] rounded-xl object-cover border border-border-subtle/60 shadow-sm"
              />
              <button
                onClick={() => removeImage(index)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-surface text-text-secondary border border-border-subtle/60 rounded-full flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all hover:bg-red-500 hover:text-white hover:border-red-500"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`group/input relative bg-surface/[0.7] dark:bg-text-primary/[0.06] backdrop-blur-xl border rounded-[2rem] flex items-end p-2 pr-4 shadow-sm transition-all duration-300 focus-within:border-brand/40 focus-within:shadow-[0_0_0_3px_rgba(139,92,246,0.12),0_8px_30px_-8px_rgba(139,92,246,0.25)] focus-within:bg-surface/[0.85] dark:focus-within:bg-text-primary/[0.09] ${loading ? 'border-brand/30 chat-input-thinking' : 'border-border-subtle/70'}`}>
        {/* AI 响应中：沿输入框边缘流动的呼吸光带，让等待有整体存在感 */}
        {loading && (
          <span className="pointer-events-none absolute inset-0 rounded-[2rem] overflow-hidden">
            <span className="chat-input-thinking-sheen absolute inset-0" />
          </span>
        )}
        {/* 多行输入框 */}
        <textarea
          ref={textareaRef}
          className="flex-1 px-5 py-3 bg-transparent outline-none font-medium text-text-primary placeholder-text-faint resize-none leading-relaxed"
          placeholder={
            quotePreview
              ? '针对引用内容继续提问...'
              : '⚡ 描述你的需求或问题... (支持 @ # / 快速检索)'
          }
          value={input}
          onChange={e => {
            const value = e.target.value
            onInputChange(value)

            // 新触发器系统：基于光标位置检测 @/#//
            if (onTriggerInput) {
              const cursorPos = e.target.selectionStart ?? value.length
              const detected = detectTrigger(value, cursorPos)
              if (detected && ['@', '#', '/'].includes(detected.trigger)) {
                onTriggerInput({ trigger: detected.trigger as TriggerType, filter: detected.filter })
              } else {
                onTriggerInput(null)
              }
            }

            // 兼容旧的斜杠检测
            if (onSlashInput) {
              if (value.startsWith('/')) {
                onSlashInput(value)
              } else {
                onSlashInput(null)
              }
            }
          }}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          rows={1}
          style={{ minHeight: '44px', maxHeight: '240px' }}
        />

        {/* 图片角标 */}
        {attachedImages.length > 0 && (
          <div className="self-end mb-2 mr-1 flex items-center gap-1 text-xs text-violet-500 dark:text-violet-300 font-medium">
            <ImageIcon size={14} />
            <span>{attachedImages.length}</span>
          </div>
        )}

        {/* 发送按钮 */}
        <div className="relative flex-shrink-0 self-end mb-0.5">
          {/* 发送迸发涟漪 — 从按钮中心扩散的紫色光环 */}
          <AnimatePresence>
            {sendRipple !== null && (
              <motion.span
                key={sendRipple}
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ border: '2px solid rgba(139,92,246,0.5)' }}
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 2.4, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                onAnimationComplete={() => setSendRipple(null)}
              />
            )}
          </AnimatePresence>
          <motion.button
            onClick={() => {
              if (!handleSendDisabled) {
                setSendRipple(Date.now())
              }
              onSend()
            }}
            disabled={handleSendDisabled}
            whileHover={handleSendDisabled ? undefined : { scale: 1.08 }}
            whileTap={handleSendDisabled ? undefined : { scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            className="relative w-11 h-11 bg-gradient-to-br from-violet-500 to-indigo-600 text-white rounded-full flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none shadow-lg shadow-violet-500/30 hover:shadow-xl hover:shadow-violet-500/45 transition-shadow"
            title={loading ? '当前回复结束后发送' : '发送'}
            aria-label={loading ? '加入等待发送队列' : '发送消息'}
          >
            <Send size={18} className="translate-x-[1px]" />
          </motion.button>
        </div>
      </div>
    </div>
  )
}

import React, { useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { CopyButton } from './CopyButton'
import { getBubbleClassName } from './bubble-styles'
import { MessageBubbleProvider } from './MessageBubbleContext'
import { QuotedMessageBar } from './parts/QuotedMessageBar'
import { MessageActions } from './parts/MessageActions'
import { WebSearchBadge } from './renderers/MiscContent'
import { MessageContent } from './renderers/MessageContent'
import { FileOpsSummary } from './FileOpsSummary'
import { MuseAvatar } from '../../MuseAvatar'
import type { Message, ChatRequestEnvelope } from '../types'
import { SelectionFollowUp } from './SelectionFollowUp'

interface MessageBubbleProps {
  msg: Message
  loading: boolean
  isElectron: boolean
  onExecuteCommand: () => void
  onExecuteScript: (runCommand: string) => void
  onExecuteSpecificCommand: (cmd: string, label: string) => void
  onInstallSkill: (skillData: { url: string; skillName?: string }) => void
  onConfirmTask: (taskId: string, confirmed: boolean, modifiedStep?: any) => void
  onRetry: (request: string | ChatRequestEnvelope) => void
  onSkillsSaved: () => void
  onAnalyzeOutput?: () => void
  onQuote?: (msg: Message) => void
  onQuoteSelection?: (msg: Message, text: string) => void
  onEditStep?: (stepId: number, newDescription: string) => void
  onDeleteStep?: (stepId: number) => void
  onPauseTask?: (taskId: string) => void
  onResumeTask?: (taskId: string, modifiedSteps?: any[]) => void
  onCancelTask?: (taskId: string) => void
  onRetryTask?: (taskId: string, modifiedStep?: any) => void
  onSkipStep?: (taskId: string) => void
  onAnalyzeError?: (taskId: string) => void
  onInterveneTask?: (taskId: string, message: string) => Promise<{ success: boolean; error?: string }>
  allMessages?: Message[]
  onScrollToMessage?: (messageId: string) => void
  onDeleteMessage?: (messageId: string) => void
  onRichFormSubmit?: (messageId: string, values: Record<string, any>) => void
  onOpenTaskProgress?: () => void
}

export const MessageBubble = React.memo(function MessageBubble(props: MessageBubbleProps) {
  const { msg } = props
  const reduceMotion = useReducedMotion()
  const bubbleRef = useRef<HTMLDivElement>(null)

  // muse_letter 来信通知由导航栏红点处理，不在对话流展示
  if (msg.type === 'muse_letter') return null

  // 防御性检查：确保 content 始终是字符串
  const content = typeof msg.content === 'string' ? msg.content : ''

  const ctxValue = {
    msg,
    content,
    loading: props.loading,
    isElectron: props.isElectron,
    onExecuteCommand: props.onExecuteCommand,
    onExecuteScript: props.onExecuteScript,
    onExecuteSpecificCommand: props.onExecuteSpecificCommand,
    onInstallSkill: props.onInstallSkill,
    onConfirmTask: props.onConfirmTask,
    onRetry: props.onRetry,
    onSkillsSaved: props.onSkillsSaved,
    onAnalyzeOutput: props.onAnalyzeOutput,
    onQuote: props.onQuote,
    onEditStep: props.onEditStep,
    onDeleteStep: props.onDeleteStep,
    onPauseTask: props.onPauseTask,
    onResumeTask: props.onResumeTask,
    onCancelTask: props.onCancelTask,
    onRetryTask: props.onRetryTask,
    onSkipStep: props.onSkipStep,
    onAnalyzeError: props.onAnalyzeError,
    onInterveneTask: props.onInterveneTask,
    onScrollToMessage: props.onScrollToMessage,
    onDeleteMessage: props.onDeleteMessage,
    onRichFormSubmit: props.onRichFormSubmit,
    onOpenTaskProgress: props.onOpenTaskProgress,
    allMessages: props.allMessages,
  }

  // 入场动画：AI 消息从左侧（头像方向）轻微飘入，用户消息从右侧飘入，
  // spring 弹性落位制造"话从对方那侧说出来"的联想。
  const isUser = msg.role === 'user'

  // 用户消息：从右下角小圆"射出"展开为气泡（模拟从发送按钮飞出的 morphing）
  // AI 消息：从空间浮现（blur 渐显），呼应意识体独白质感
  // 注意：动画应用在气泡 div 上而非外层 flex 容器，否则透明容器动画不可见
  const outerAnimation = reduceMotion
    ? undefined
    : !isUser
      ? {
          initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
          animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
          transition: { duration: 0.5, ease: 'easeOut' as const },
        }
      : undefined

  const bubbleAnimation = reduceMotion
    ? undefined
    : isUser
      ? {
          initial: { opacity: 0, scale: 0.3, y: 40, x: 30, borderRadius: '50%' },
          animate: { opacity: 1, scale: 1, y: 0, x: 0, borderRadius: '2rem' },
          transition: { type: 'spring' as const, stiffness: 400, damping: 28, mass: 0.6 },
        }
      : undefined

  const isAssistant = msg.role === 'assistant'
  const museState = props.loading && msg.isThinking ? 'working' : 'idle'

  return (
    <MessageBubbleProvider value={ctxValue}>
      <motion.div
        data-message-id={msg.id}
        className={`flex ${isUser ? 'flex-row-reverse' : 'gap-2.5'}`}
        {...(outerAnimation || {})}
      >
        {/* 1v1 对话无需头像，Muse 本身即是产品主体 */}

        {/* 消息气泡 */}
        {(() => {
          const isPlainAssistant = isAssistant && (msg.type === 'text' || !msg.type)
          return (
        <div className="min-w-0 flex-1">
          {/* 1v1 对话无需名称行，Muse 即是产品本身 */}
          <motion.div
            ref={bubbleRef}
            className={`group/msg relative text-[15px] ${
              msg.role === 'user'
                ? 'max-w-[80%] overflow-hidden ml-auto'
                : isPlainAssistant
                  ? 'rounded-2xl max-w-full overflow-hidden'
                  : 'rounded-2xl max-w-[95%] overflow-hidden'
            } ${getBubbleClassName(msg)}`}
            style={{
              ...(isPlainAssistant ? { textShadow: '0 0 20px rgba(139,92,246,0.12)' } : {}),
              ...(msg.role !== 'user' ? {} : { transformOrigin: 'bottom right' }),
            }}
            {...(bubbleAnimation || {})}
          >
            <QuotedMessageBar />
            <MessageActions />
            <WebSearchBadge />

            {/* 用户消息图片附件 */}
            {msg.role === 'user' && msg.images && msg.images.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3">
                {msg.images.map((img, index) => (
                  <img
                    key={index}
                    src={img.dataUrl}
                    alt={img.name || `图片${index + 1}`}
                    className="max-h-48 max-w-[16rem] rounded-xl object-cover border border-bubble-user-text/20 shadow-sm"
                  />
                ))}
              </div>
            )}

            {/* 文件操作摘要 */}
            {isAssistant && content && content.length > 50 && (
              <FileOpsSummary content={content} isStreaming={props.loading && msg.isThinking} isElectron={props.isElectron} />
            )}

            {/* 消息内容分发 */}
            <MessageContent />

            {/* 用户消息时间戳 */}
            {msg.role === 'user' && msg.timestamp && (
              <div className="mt-1.5 text-right text-[10px] text-bubble-user-text/50 font-mono">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
              </div>
            )}

            {/* 复制按钮（AI 消息） */}
            {isAssistant && msg.type !== 'error' && (
              <div className="mt-2 flex items-center gap-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <CopyButton text={content} />
              </div>
            )}
            <SelectionFollowUp
              containerRef={bubbleRef}
              enabled={isAssistant && !msg.isThinking && msg.type !== 'error'}
              onFollowUp={(text) => props.onQuoteSelection?.(msg, text)}
            />
          </motion.div>
        </div>
          )
        })()}
      </motion.div>
    </MessageBubbleProvider>
  )
}, (prevProps, nextProps) => {
  return prevProps.msg.id === nextProps.msg.id &&
         prevProps.msg.type === nextProps.msg.type &&
         prevProps.msg.content === nextProps.msg.content &&
         prevProps.msg.scriptData === nextProps.msg.scriptData &&
         prevProps.msg.richFormData === nextProps.msg.richFormData &&
         prevProps.msg.taskProgressData === nextProps.msg.taskProgressData &&
         prevProps.loading === nextProps.loading &&
         prevProps.isElectron === nextProps.isElectron &&
         prevProps.msg.images === nextProps.msg.images
})

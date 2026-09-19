// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { createContext, useContext } from 'react'
import type { Message, ChatRequestEnvelope } from '../types'

export interface MessageBubbleContextValue {
  msg: Message
  /** 防御性处理后的纯字符串 content */
  content: string
  loading: boolean
  isElectron: boolean
  onExecuteCommand: () => void
  onExecuteScript: (runCommand: string) => void
  onExecuteSpecificCommand: (cmd: string, label: string) => void
  onConfirmTask: (taskId: string, confirmed: boolean, modifiedStep?: any) => void
  onRetry: (request: string | ChatRequestEnvelope) => void
  onAnalyzeOutput?: () => void
  onQuote?: (msg: Message) => void
  onEditStep?: (stepId: number, newDescription: string) => void
  onDeleteStep?: (stepId: number) => void
  onPauseTask?: (taskId: string) => void
  onResumeTask?: (taskId: string, modifiedSteps?: any[]) => void
  onCancelTask?: (taskId: string) => void
  onRetryTask?: (taskId: string, modifiedStep?: any) => void
  onSkipStep?: (taskId: string) => void
  onAnalyzeError?: (taskId: string) => void
  onInterveneTask?: (taskId: string, message: string) => Promise<{ success: boolean; error?: string }>
  onScrollToMessage?: (messageId: string) => void
  onDeleteMessage?: (messageId: string) => void
  onRichFormSubmit?: (messageId: string, values: Record<string, any>) => void
  onOpenTaskProgress?: () => void
  allMessages?: Message[]
}

const MessageBubbleContext = createContext<MessageBubbleContextValue | null>(null)

export function MessageBubbleProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: MessageBubbleContextValue
}) {
  return (
    <MessageBubbleContext.Provider value={value}>
      {children}
    </MessageBubbleContext.Provider>
  )
}

export function useMessageBubbleContext(): MessageBubbleContextValue {
  const ctx = useContext(MessageBubbleContext)
  if (!ctx) {
    throw new Error('useMessageBubbleContext must be used within MessageBubbleProvider')
  }
  return ctx
}

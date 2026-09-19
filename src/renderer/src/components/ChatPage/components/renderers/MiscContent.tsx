// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { Play, Activity, Globe } from 'lucide-react'
import { BrowserScreenshot } from '../BrowserScreenshot'
import { looksLikeCommand } from '../message-utils'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** 联网搜索标记 */
export function WebSearchBadge() {
  const { msg } = useMessageBubbleContext()

  if (!msg.webSearched || msg.role !== 'assistant') return null

  return (
    <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-cyan-600">
      <Globe size={12} /> 联网搜索
    </div>
  )
}

/** 截图展示 */
export function BrowserScreenshotContent() {
  const { msg } = useMessageBubbleContext()

  if (msg.type !== 'browser_screenshot' || msg.role !== 'assistant' || !msg.screenshotPath) return null

  return <BrowserScreenshot filename={msg.screenshotPath} />
}

/** 文本消息中看起来像命令的执行按钮 */
export function InlineCommandButton() {
  const { msg, content, isElectron, onExecuteSpecificCommand } = useMessageBubbleContext()

  if (msg.type !== 'text' || msg.role !== 'assistant' || !isElectron || !looksLikeCommand(content)) return null

  return (
    <button
      onClick={() => onExecuteSpecificCommand(content.trim(), '执行命令')}
      className="mt-3 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
    >
      <Play size={14} /> 执行
    </button>
  )
}

/** 分析执行结果按钮 */
export function AnalyzeOutputButton() {
  const { msg, content, loading, isElectron, onAnalyzeOutput } = useMessageBubbleContext()

  if (msg.role !== 'assistant' || msg.type !== 'text' || !isElectron || !content.startsWith('✅') || !onAnalyzeOutput) return null

  return (
    <button
      onClick={onAnalyzeOutput}
      disabled={loading}
      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-lg transition-all active:scale-95 disabled:opacity-50"
    >
      <Activity size={12} />
      分析执行结果
    </button>
  )
}

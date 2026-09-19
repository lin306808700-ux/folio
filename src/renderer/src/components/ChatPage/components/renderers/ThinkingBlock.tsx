// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useRef } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
}

/** AI 思考过程折叠组件 — 对标 Claude Code 的 thinking 展示 */
export function ThinkingBlock({ content, isStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const lines = content.split('\n').filter(l => l.trim())
  const summary = lines[0]?.slice(0, 80) || '思考中...'

  return (
    <div className="my-2 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 to-indigo-50/30 overflow-hidden transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-100/50 transition-colors"
      >
        <Brain size={14} className={`text-indigo-500 flex-shrink-0 ${isStreaming ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-medium text-indigo-600">
          {isStreaming ? '正在思考...' : '思考过程'}
        </span>
        <span className="text-xs text-slate-400 truncate flex-1">{!expanded && summary}</span>
        <span className="text-xs text-slate-400 flex-shrink-0">{lines.length} 行</span>
        {expanded
          ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
        }
      </button>
      {expanded && (
        <div
          ref={contentRef}
          className="px-4 pb-3 max-h-[300px] overflow-y-auto text-xs text-slate-600 leading-relaxed font-mono whitespace-pre-wrap border-t border-slate-100"
        >
          {content}
          {isStreaming && (
            <span className="inline-flex gap-[2px] ml-1 align-middle">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** 从 AI 回复中提取 thinking 和正文 */
export function extractThinking(content: string): { thinking: string | null; body: string } {
  // 支持 <thinking>...</thinking> 和 <think>...</think> 标签
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i
  const match = content.match(thinkRegex)
  if (match) {
    const thinking = match[1].trim()
    const body = content.replace(thinkRegex, '').trim()
    return { thinking, body }
  }

  // 支持 --- thinking --- 分隔符格式
  const separatorRegex = /^---\s*thinking\s*---\n([\s\S]*?)\n---\s*end\s*---/im
  const sepMatch = content.match(separatorRegex)
  if (sepMatch) {
    return { thinking: sepMatch[1].trim(), body: content.replace(separatorRegex, '').trim() }
  }

  return { thinking: null, body: content }
}

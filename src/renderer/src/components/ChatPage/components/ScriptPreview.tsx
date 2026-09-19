// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState } from 'react'
import { CopyButton } from './CopyButton'

export function ScriptPreview({ content, lang, filename, defaultExpanded = true }: { content: string; lang: string; filename: string; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const lines = content.split('\n')

  return (
    <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-800 text-xs hover:bg-slate-700/80 transition-colors"
      >
        <span className="text-slate-400 font-mono">{filename}</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">{lang} · {lines.length} 行</span>
          <CopyButton text={content} />
          <span className="text-slate-500 ml-1">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <pre className="p-3 text-sm text-slate-300 font-mono whitespace-pre-wrap break-all">
          <code>{content}</code>
        </pre>
      )}
    </div>
  )
}

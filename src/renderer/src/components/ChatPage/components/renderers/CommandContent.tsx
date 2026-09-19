// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { Play } from 'lucide-react'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** command 类型：执行命令按钮 */
export function CommandButtonContent() {
  const { msg, isElectron, onExecuteCommand } = useMessageBubbleContext()

  if (msg.type !== 'command' || msg.role !== 'assistant' || !isElectron) return null

  return (
    <button
      onClick={onExecuteCommand}
      className="mt-3 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all shadow-sm active:scale-95"
    >
      <Play size={14} /> 执行命令
    </button>
  )
}

/** command_options 类型：多个命令选项按钮 */
export function CommandOptionsContent() {
  const { msg, isElectron, onExecuteSpecificCommand } = useMessageBubbleContext()

  if (msg.type !== 'command_options' || !msg.commandOptions || !isElectron) return null

  return (
    <div className="mt-3 space-y-2">
      {msg.commandOptions.map((opt, i) => (
        <button
          key={i}
          onClick={() => onExecuteSpecificCommand(opt.cmd, opt.label)}
          className="w-full flex items-start gap-3 px-4 py-3 bg-surface/60 border border-border-subtle/70 rounded-xl hover:border-brand/40 hover:bg-brand/5 transition-all text-left group active:scale-[0.98]"
        >
          <Play size={14} className="text-brand mt-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-primary">{opt.label}</div>
            <div className="text-xs text-text-muted font-mono mt-1 truncate">{opt.cmd}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

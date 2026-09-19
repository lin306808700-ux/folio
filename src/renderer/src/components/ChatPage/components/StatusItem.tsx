// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'

const colorMap = {
  green: 'text-accent-green',
  yellow: 'text-accent-yellow',
  red: 'text-accent-red',
  slate: 'text-slate-400',
}

export function StatusItem({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'green' | 'yellow' | 'red' | 'slate'
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[70px]">
      <div className="flex items-center gap-1 text-slate-500">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <span className={`text-xs font-bold font-mono status-glow ${colorMap[color]}`}>
        {value}
      </span>
    </div>
  )
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState } from 'react'
import { Trash2, Check, X } from 'lucide-react'
import type { TaskStep } from '../types'

interface EditableStepsListProps {
  steps: TaskStep[]
  onConfirm: (steps: TaskStep[]) => void
  onCancel: () => void
}

export function EditableStepsList({ steps, onConfirm, onCancel }: EditableStepsListProps) {
  const [localSteps, setLocalSteps] = useState<TaskStep[]>(steps)

  const updateStepDescription = (stepId: number, newDesc: string) => {
    setLocalSteps(prev => prev.map(s => 
      s.id === stepId ? { ...s, description: newDesc } : s
    ))
  }

  const deleteStep = (stepId: number) => {
    setLocalSteps(prev => prev.filter(s => s.id !== stepId))
  }

  const handleConfirm = () => {
    if (localSteps.length === 0) {
      alert('至少需要保留一个步骤')
      return
    }
    onConfirm(localSteps)
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="text-sm text-slate-600 mb-3">
        请确认或修改任务步骤，您可以编辑步骤描述或删除不需要的步骤：
      </div>

      <div className="space-y-2">
        {localSteps.map((step, index) => (
          <div 
            key={step.id} 
            className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
          >
            <span className="text-xs text-slate-400 font-mono mt-1.5 flex-shrink-0">
              {index + 1}
            </span>
            
            <input
              value={step.description}
              onChange={(e) => updateStepDescription(step.id, e.target.value)}
              className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="步骤描述"
            />
            
            <button
              onClick={() => deleteStep(step.id)}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
              title="删除步骤"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {localSteps.length === 0 && (
        <div className="text-center py-4 text-slate-400 text-sm">
          所有步骤已被删除，请添加步骤或取消任务
        </div>
      )}

      <div className="flex gap-3 mt-4 pt-3 border-t border-slate-200">
        <button
          onClick={handleConfirm}
          disabled={localSteps.length === 0}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          <Check size={16} />
          确认执行 ({localSteps.length} 个步骤)
        </button>
        <button
          onClick={onCancel}
          className="flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium"
        >
          <X size={16} />
          取消任务
        </button>
      </div>
    </div>
  )
}

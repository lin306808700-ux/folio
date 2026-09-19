// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState } from 'react'
import { CheckCircle, Loader2, XCircle, Circle, ListTodo, ChevronRight, ChevronDown } from 'lucide-react'

/** 任务步骤进度组件 */
export function TaskStepsProgress({ steps, currentStep, totalSteps, status }: { steps: any[], currentStep: number, totalSteps: number, status: string }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())

  const toggleStep = (stepId: number) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev)
      if (newSet.has(stepId)) {
        newSet.delete(stepId)
      } else {
        newSet.add(stepId)
      }
      return newSet
    })
  }

  const getStepIcon = (stepStatus: string, stepIndex: number) => {
    if (stepStatus === 'completed') {
      return <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
    } else if (stepStatus === 'running') {
      return <Loader2 size={16} className="text-blue-500 flex-shrink-0 animate-spin" />
    } else if (stepStatus === 'error' || stepStatus === 'failed') {
      return <XCircle size={16} className="text-red-500 flex-shrink-0" />
    } else {
      return <Circle size={16} className="text-slate-300 flex-shrink-0" />
    }
  }

  const getStepStatusText = (stepStatus: string) => {
    switch (stepStatus) {
      case 'completed': return '已完成'
      case 'running': return '执行中'
      case 'error':
      case 'failed': return '失败'
      default: return '等待中'
    }
  }

  const getStepCommand = (step: any): string | null => {
    if (step.params?.command) {
      return step.params.command
    }
    if (step.params?.path) {
      return step.params.path
    }
    if (step.params?.url) {
      return step.params.url
    }
    return null
  }

  const hasDetails = (step: any): boolean => {
    return !!(getStepCommand(step) || step.result?.error || step.result?.reason)
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
        <div className="flex items-center gap-2">
          <ListTodo size={14} />
          <span>任务进度</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{currentStep}/{totalSteps}</span>
          {status === 'completed' && <span className="text-emerald-600">已完成</span>}
          {status === 'error' && <span className="text-red-600">失败</span>}
          {status === 'running' && <span className="text-blue-600">执行中</span>}
        </div>
      </div>

      <div className="space-y-1.5">
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id)
          const command = getStepCommand(step)
          const canExpand = hasDetails(step)

          return (
            <div key={step.id}>
              {/* 步骤头部 - 可点击展开 */}
              <div
                onClick={() => canExpand && toggleStep(step.id)}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-all ${
                  canExpand ? 'cursor-pointer hover:shadow-sm' : ''
                } ${
                  step.status === 'completed'
                    ? 'bg-emerald-50 border-emerald-200'
                    : step.status === 'running'
                      ? 'bg-blue-50 border-blue-200'
                      : step.status === 'error' || step.status === 'failed'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-slate-50 border-slate-200'
                } ${isExpanded ? 'rounded-b-none' : ''}`}
              >
                {/* 展开/折叠指示器 */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {canExpand ? (
                    isExpanded ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={14} className="text-slate-400" />
                    )
                  ) : (
                    <div className="w-3.5" /> /* 占位符保持对齐 */
                  )}
                  {getStepIcon(step.status, index)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-mono">{step.id}</span>
                    <span className="text-sm text-slate-700">{step.description}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{getStepStatusText(step.status)}</div>
                </div>

                {step.type && (
                  <span className="text-[10px] px-2 py-0.5 bg-white/70 rounded-full text-slate-500 border border-slate-200 flex-shrink-0">
                    {step.type}
                  </span>
                )}
              </div>

              {/* 展开的详细内容 */}
              {isExpanded && canExpand && (
                <div className={`px-3 py-2.5 border border-t-0 rounded-b-lg transition-all ${
                  step.status === 'completed'
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : step.status === 'running'
                      ? 'bg-blue-50/50 border-blue-200'
                      : step.status === 'error' || step.status === 'failed'
                        ? 'bg-red-50/50 border-red-200'
                        : 'bg-slate-50/50 border-slate-200'
                }`}>
                  {/* 命令内容 */}
                  {command && (
                    <div className="flex items-start gap-2">
                      <span className="text-slate-400 font-mono text-xs select-none">$</span>
                      <code className="flex-1 text-xs font-mono text-slate-700 break-all select-text">
                        {command}
                      </code>
                    </div>
                  )}

                  {/* 错误信息 */}
                  {step.result?.error && (
                    <div className="mt-2 text-xs text-red-600 font-mono bg-red-100/50 p-2 rounded">
                      {step.result.error}
                    </div>
                  )}

                  {/* 跳过原因 */}
                  {step.result?.skipped && step.result?.reason && (
                    <div className="mt-2 text-xs text-amber-600 font-mono bg-amber-100/50 p-2 rounded">
                      跳过: {step.result.reason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

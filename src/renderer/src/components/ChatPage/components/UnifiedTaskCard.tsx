// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect, useRef } from 'react'
import { Play, Pause, Edit2, Trash2, Check, X, RotateCcw, AlertCircle, SkipForward, Zap, ChevronDown, ChevronRight, MessageSquare, Send } from 'lucide-react'
import type { TaskStep, TaskProgressData } from '../types'

interface UnifiedTaskCardProps {
  taskId: string
  mode: 'planning' | 'executing' | 'completed' | 'error'
  steps: TaskStep[]
  currentStep?: number
  status?: 'running' | 'paused' | 'completed' | 'error'
  pauseReason?: 'manual' | 'error' | 'confirm'
  pauseError?: string
  failedStep?: TaskStep
  retryCount?: number
  maxRetries?: number
  retryStrategy?: string
  onConfirm: (steps: TaskStep[]) => void
  onCancel: () => void
  onEditStep?: (stepId: number, newDescription: string) => void
  onDeleteStep?: (stepId: number) => void
  onPause?: () => void
  onResume?: () => void
  onRetry?: () => void
  onSkipStep?: () => void
  onAnalyzeError?: () => void
  onIntervene?: (message: string) => Promise<{ success: boolean; error?: string }>
}

export function UnifiedTaskCard({
  taskId,
  mode,
  steps,
  currentStep = 0,
  status = 'running',
  pauseReason,
  pauseError,
  failedStep,
  retryCount,
  maxRetries,
  retryStrategy,
  onConfirm,
  onCancel,
  onEditStep,
  onDeleteStep,
  onPause,
  onResume,
  onRetry,
  onSkipStep,
  onAnalyzeError,
  onIntervene
}: UnifiedTaskCardProps) {
  const [editingStepId, setEditingStepId] = useState<number | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [localSteps, setLocalSteps] = useState<TaskStep[]>(steps)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set())
  const [interveneInput, setInterveneInput] = useState('')
  const [showInterveneInput, setShowInterveneInput] = useState(false)
  const [interveneSending, setInterveneSending] = useState(false)
  const [interveneError, setInterveneError] = useState('')
  const interveneInputRef = useRef<HTMLInputElement>(null)

  const submitIntervention = async () => {
    const message = interveneInput.trim()
    if (!message || interveneSending || !onIntervene) return
    setInterveneSending(true)
    setInterveneError('')
    const result = await onIntervene(message)
    setInterveneSending(false)
    if (result.success) {
      setInterveneInput('')
      setShowInterveneInput(false)
    } else {
      setInterveneError(result.error || '干预未送达')
    }
  }

  // 当前执行中的步骤自动展开
  useEffect(() => {
    if (mode === 'executing' && currentStep > 0) {
      setExpandedSteps(prev => {
        const next = new Set(prev)
        next.add(currentStep - 1)
        return next
      })
    }
  }, [mode, currentStep])

  useEffect(() => {
    setLocalSteps(steps)
  }, [steps])

  const toggleStepExpand = (index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const startEdit = (step: TaskStep) => {
    setEditingStepId(step.id)
    setEditDescription(step.description)
  }

  const saveEdit = () => {
    if (editingStepId !== null && onEditStep) {
      onEditStep(editingStepId, editDescription)
      setLocalSteps(prev => prev.map(s => 
        s.id === editingStepId ? { ...s, description: editDescription } : s
      ))
    }
    setEditingStepId(null)
    setEditDescription('')
  }

  const cancelEdit = () => {
    setEditingStepId(null)
    setEditDescription('')
  }

  const deleteStep = (stepId: number) => {
    if (onDeleteStep) {
      onDeleteStep(stepId)
    }
    setLocalSteps(prev => prev.filter(s => s.id !== stepId))
  }

  const handleConfirm = () => {
    if (localSteps.length === 0) {
      alert('至少需要保留一个步骤')
      return
    }
    onConfirm(localSteps)
  }

  const isPaused = status === 'paused' || mode === 'planning' || mode === 'error'
  const isRunning = status === 'running' && mode === 'executing'
  const isCompleted = status === 'completed'

  return (
    <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden bg-white">
      {/* 卡片头部 */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'planning' && (
              <>
                <Edit2 size={16} className="text-blue-600" />
                <span className="text-sm font-medium text-slate-700">任务规划完成</span>
              </>
            )}
            {mode === 'executing' && (
              <>
                <Play size={16} className="text-emerald-600" />
                <span className="text-sm font-medium text-slate-700">任务执行中</span>
              </>
            )}
            {mode === 'completed' && (
              <>
                <Check size={16} className="text-emerald-600" />
                <span className="text-sm font-medium text-slate-700">任务已完成</span>
              </>
            )}
            {mode === 'error' && (
              <>
                <AlertCircle size={16} className="text-red-600" />
                <span className="text-sm font-medium text-slate-700">任务暂停</span>
              </>
            )}
          </div>
          
          <div className="text-xs text-slate-500">
            {mode === 'executing' && `${currentStep}/${steps.length} 步骤`}
            {mode === 'completed' && `${steps.length}/${steps.length} 步骤`}
            {mode === 'planning' && `${steps.length} 个步骤`}
          </div>
        </div>
      </div>

      {/* 错误信息 */}
      {mode === 'error' && pauseError && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <div className="text-xs text-red-600">
            <span className="font-medium">错误：</span>
            {pauseError}
          </div>
          {failedStep && (
            <div className="text-xs text-slate-600 mt-1">
              <span className="font-medium">失败步骤：</span>
              {failedStep.description}
            </div>
          )}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        {localSteps.map((step, index) => {
          const isCurrentStep = mode === 'executing' && index === currentStep - 1
          const isFailedStep = mode === 'error' && failedStep && step.id === failedStep.id
          const stepStatus = mode === 'completed' 
            ? 'completed' 
            : (step.result && 'status' in step.result ? step.result.status : undefined) || 
              (isCurrentStep ? 'running' : (index < currentStep - 1 ? 'completed' : 'pending'))
          
          return (
            <div 
              key={step.id}
              className={`p-3 rounded-lg border transition-all ${
                isFailedStep 
                  ? 'bg-red-50 border-red-300' 
                  : isCurrentStep
                  ? 'bg-blue-50 border-blue-300'
                  : stepStatus === 'completed'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              {/* 步骤头部（可点击展开/收起） */}
              <div 
                className={`flex items-start gap-3 ${
                  (mode === 'executing' || mode === 'completed' || mode === 'error') && stepStatus !== 'pending'
                    ? 'cursor-pointer select-none' 
                    : ''
                }`}
                onClick={() => {
                  if ((mode === 'executing' || mode === 'completed' || mode === 'error') && stepStatus !== 'pending') {
                    toggleStepExpand(index)
                  }
                }}
              >
                {/* 展开/收起图标 或 步骤序号 */}
                {(mode === 'executing' || mode === 'completed' || mode === 'error') && stepStatus !== 'pending' ? (
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-slate-400">
                    {expandedSteps.has(index) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                ) : (
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium bg-white border border-slate-300 text-slate-600">
                    {index + 1}
                  </div>
                )}

                {/* 步骤内容 */}
                <div className="flex-1 min-w-0">
                  {editingStepId === step.id ? (
                    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full px-3 py-1.5 border border-blue-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="步骤描述"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit()
                          if (e.key === 'Escape') cancelEdit()
                        }}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          保存
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm text-slate-700">{step.description}</div>
                        {step.result?.error && !expandedSteps.has(index) && (
                          <div className="text-xs text-red-500 mt-1 truncate">
                            错误：{step.result.error}
                          </div>
                        )}
                      </div>
                      
                      {/* 操作按钮 */}
                      {(mode === 'planning' || isPaused) && (
                        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => startEdit(step)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="编辑步骤"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => deleteStep(step.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="删除步骤"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 状态图标 */}
                <div className="flex-shrink-0">
                  {stepStatus === 'completed' && (
                    <Check size={16} className="text-emerald-600" />
                  )}
                  {stepStatus === 'running' && (
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      {retryCount && maxRetries && (
                        <span className="text-[10px] text-blue-500 font-mono">
                          {retryCount}/{maxRetries}
                        </span>
                      )}
                    </div>
                  )}
                  {stepStatus === 'error' && (
                    <X size={16} className="text-red-600" />
                  )}
                </div>
              </div>

              {/* 展开的详情内容 */}
              {expandedSteps.has(index) && (
                <div className="mt-2 ml-9 text-xs border-t border-slate-200/60 pt-2">
                  {stepStatus === 'running' && (
                    <div className="flex items-center gap-2 text-blue-600">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span>正在执行中...</span>
                    </div>
                  )}
                  {step.result?.error && (
                    <div className="text-red-500 whitespace-pre-wrap break-all">
                      <span className="font-medium">错误：</span>{step.result.error}
                    </div>
                  )}
                  {step.result && 'data' in step.result && step.result.data && (
                    <div className="text-slate-600 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono bg-slate-100/50 rounded p-2">
                      {typeof step.result.data === 'string' 
                        ? step.result.data 
                        : JSON.stringify(step.result.data, null, 2)}
                    </div>
                  )}
                  {step.output && (
                    <div className="text-slate-600 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono bg-slate-100/50 rounded p-2">
                      {step.output}
                    </div>
                  )}
                  {stepStatus === 'completed' && !step.result?.data && !step.result?.error && !step.output && (
                    <div className="text-emerald-600">✓ 执行完成</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部操作按钮 */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
        {mode === 'planning' && (
          <div className="flex gap-3">
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
        )}

        {mode === 'executing' && isRunning && (
          <div className="space-y-2">
            {/* 干预输入框 */}
            {showInterveneInput ? (
              <div className="flex items-center gap-2">
                <input
                  ref={interveneInputRef}
                  value={interveneInput}
                  onChange={(e) => setInterveneInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitIntervention()
                    if (e.key === 'Escape') {
                      setShowInterveneInput(false)
                      setInterveneInput('')
                    }
                  }}
                  placeholder="输入干预指令，如：加一个步骤... / 跳过后面的..."
                  className="flex-1 px-3 py-2 border border-indigo-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  autoFocus
                  disabled={interveneSending}
                />
                <button
                  onClick={() => {
                    submitIntervention()
                  }}
                  disabled={!interveneInput.trim() || interveneSending}
                  className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <Send size={14} />
                </button>
                {interveneError && <span className="text-[11px] text-red-600">{interveneError}</span>}
                <button
                  onClick={() => { setShowInterveneInput(false); setInterveneInput('') }}
                  className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {onIntervene && (
                  <button
                    onClick={() => { setShowInterveneInput(true); setTimeout(() => interveneInputRef.current?.focus(), 50) }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
                  >
                    <MessageSquare size={14} />
                    干预
                  </button>
                )}
                {onPause && (
                  <button
                    onClick={onPause}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium text-sm"
                  >
                    <Pause size={14} />
                    暂停
                  </button>
                )}
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="px-3 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                  title="停止任务"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {mode === 'executing' && isPaused && onPause && onResume && (
          <div className="flex gap-3">
            <button
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              <Play size={16} />
              继续执行
            </button>
            <button
              onClick={onCancel}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium"
            >
              <X size={16} />
              取消任务
            </button>
          </div>
        )}

        {mode === 'error' && isPaused && (
          <>
            {/* 重试策略信息 */}
            {retryStrategy && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-700">
                <div className="flex items-center gap-1.5">
                  <Zap size={12} />
                  <span className="font-medium">自动重试策略：</span>
                  <span>{retryStrategy}</span>
                </div>
                {retryCount && maxRetries && (
                  <div className="mt-1 text-amber-600">
                    已重试 {retryCount}/{maxRetries} 次
                  </div>
                )}
              </div>
            )}

            {/* 重试控制按钮 */}
            <div className="space-y-2">
              <div className="flex gap-2">
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                  >
                    <RotateCcw size={14} />
                    继续重试
                  </button>
                )}
                {onSkipStep && (
                  <button
                    onClick={onSkipStep}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium text-sm"
                  >
                    <SkipForward size={14} />
                    跳过此步
                  </button>
                )}
                {onAnalyzeError && (
                  <button
                    onClick={onAnalyzeError}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors font-medium text-sm"
                  >
                    <Zap size={14} />
                    AI 分析
                  </button>
                )}
              </div>
              <button
                onClick={onCancel}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium text-sm"
              >
                <X size={14} />
                停止任务
              </button>
            </div>
          </>
        )}

        {isCompleted && (
          <div className="text-center text-sm text-emerald-600 font-medium">
            <Check size={16} className="inline mr-1" />
            任务已完成
          </div>
        )}
      </div>

      {/* 停止确认对话框 */}
      {showStopConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowStopConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <X size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">停止任务</h3>
                <p className="text-sm text-slate-500">请选择停止方式</p>
              </div>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (onPause) onPause()
                  setShowStopConfirm(false)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors text-left"
              >
                <Pause size={18} className="text-amber-600 flex-shrink-0" />
                <div>
                  <div className="font-medium text-slate-800">保存进度并暂停</div>
                  <div className="text-xs text-slate-500">稍后可以继续执行</div>
                </div>
              </button>
              <button
                onClick={() => {
                  if (onCancel) onCancel()
                  setShowStopConfirm(false)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-left"
              >
                <X size={18} className="text-red-600 flex-shrink-0" />
                <div>
                  <div className="font-medium text-slate-800">完全停止并清理</div>
                  <div className="text-xs text-slate-500">无法恢复，任务将被删除</div>
                </div>
              </button>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="w-full px-4 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

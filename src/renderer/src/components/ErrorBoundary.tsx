// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { Component, ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw, Copy, Check, ChevronDown } from 'lucide-react'

// ========== 类型定义 ==========

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** 降级 UI 级别：page=整页恢复界面，section=局部折叠提示 */
  level?: 'page' | 'section'
  /** 自定义区域名称，出错时提示 */
  regionName?: string
  /** 出错时的自定义回调 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  copied: boolean
}

// ========== ErrorBoundary 组件 ==========

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false, copied: false }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })

    // 打印到控制台便于调试
    console.error(`[ErrorBoundary:${this.props.regionName || 'unknown'}] 捕获到渲染错误:`, error, errorInfo)

    // 通知 Electron 主进程记录错误（如果可用）
    try {
      const electronAPI = (window as any).electronAPI
      electronAPI?.ai?.call?.({
        type: 'error-report',
        error: { message: error.message, stack: error.stack, componentStack: errorInfo.componentStack },
      }).catch(() => {})
    } catch {
      // 静默失败
    }

    this.props.onError?.(error, errorInfo)
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false })
  }

  handleCopyError = () => {
    const { error, errorInfo } = this.state
    const errorText = [
      `Error: ${error?.message}`,
      `\nStack:\n${error?.stack}`,
      errorInfo?.componentStack ? `\nComponent Stack:\n${errorInfo.componentStack}` : '',
    ].join('\n')

    navigator.clipboard?.writeText(errorText).then(() => {
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    }).catch(() => {})
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { level = 'section', regionName } = this.props
    const { error, errorInfo, showDetails, copied } = this.state

    if (level === 'page') {
      return <PageErrorFallback
        error={error}
        errorInfo={errorInfo}
        regionName={regionName}
        showDetails={showDetails}
        copied={copied}
        onToggleDetails={() => this.setState({ showDetails: !showDetails })}
        onRecover={this.handleRecover}
        onReload={this.handleReload}
        onCopyError={this.handleCopyError}
      />
    }

    return <SectionErrorFallback
      error={error}
      regionName={regionName}
      showDetails={showDetails}
      copied={copied}
      onToggleDetails={() => this.setState({ showDetails: !showDetails })}
      onRecover={this.handleRecover}
      onCopyError={this.handleCopyError}
    />
  }
}

// ========== 整页恢复界面 ==========

interface PageFallbackProps {
  error: Error | null
  errorInfo: ErrorInfo | null
  regionName?: string
  showDetails: boolean
  copied: boolean
  onToggleDetails: () => void
  onRecover: () => void
  onReload: () => void
  onCopyError: () => void
}

function PageErrorFallback({ error, errorInfo, regionName, showDetails, copied, onToggleDetails, onRecover, onReload, onCopyError }: PageFallbackProps) {
  return (
    <div className="h-screen bg-slate-950 flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        {/* 图标 + 标题 */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
            <AlertTriangle size={32} className="text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">
            {regionName ? `${regionName} 遇到了问题` : '应用遇到了问题'}
          </h2>
          <p className="text-sm text-slate-400">
            别担心，你的对话数据已自动保存。可以尝试恢复或重新加载。
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-center mb-6">
          <button
            onClick={onRecover}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-600/20"
          >
            <RotateCcw size={15} />
            尝试恢复
          </button>
          <button
            onClick={onReload}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors"
          >
            重新加载
          </button>
        </div>

        {/* 错误详情（折叠） */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 overflow-hidden">
          <button
            onClick={onToggleDetails}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-slate-500 hover:text-slate-400 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showDetails ? '' : '-rotate-90'}`} />
            错误详情
            <span className="ml-auto flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onCopyError() }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                {copied ? '已复制' : '复制'}
              </button>
            </span>
          </button>

          {showDetails && (
            <div className="px-4 pb-3 border-t border-slate-800">
              <pre className="text-[11px] text-red-400/80 font-mono whitespace-pre-wrap break-all mt-2 max-h-[200px] overflow-auto">
                {error?.message}
              </pre>
              {error?.stack && (
                <pre className="text-[10px] text-slate-600 font-mono whitespace-pre-wrap break-all mt-2 max-h-[160px] overflow-auto">
                  {error.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ========== 局部区域恢复提示 ==========

interface SectionFallbackProps {
  error: Error | null
  regionName?: string
  showDetails: boolean
  copied: boolean
  onToggleDetails: () => void
  onRecover: () => void
  onCopyError: () => void
}

function SectionErrorFallback({ error, regionName, showDetails, copied, onToggleDetails, onRecover, onCopyError }: SectionFallbackProps) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 my-2">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-300">
          {regionName ? `${regionName}渲染出错` : '此区域渲染出错'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onCopyError}
            className="text-[10px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded bg-slate-800/50 hover:bg-slate-700 transition-colors"
          >
            {copied ? '已复制' : '复制错误'}
          </button>
          <button
            onClick={onRecover}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors"
          >
            <RotateCcw size={10} />
            恢复
          </button>
        </div>
      </div>

      {/* 简短错误信息 */}
      <button
        onClick={onToggleDetails}
        className="text-[11px] text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
      >
        {error?.message || '未知错误'}
        {showDetails ? '' : ' ▸ 展开详情'}
      </button>

      {showDetails && error?.stack && (
        <pre className="mt-2 text-[10px] text-slate-600 font-mono whitespace-pre-wrap break-all max-h-[120px] overflow-auto bg-slate-900/40 rounded p-2">
          {error.stack}
        </pre>
      )}
    </div>
  )
}

export default ErrorBoundary

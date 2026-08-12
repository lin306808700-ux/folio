import React, { useState, useEffect, useRef } from 'react'
import { RotateCcw, Layers } from 'lucide-react'
import { WorkspaceBar } from './WorkspaceBar'

interface ContextStatsData {
  baseLength: number
  baseTokens: number
  incrementalLength: number
  incrementalTokens: number
  totalLength: number
  totalTokens: number
  roundCount: number
  breakdown: Record<string, number>
}

interface SessionHeaderProps {
  sessionShort: string
  isElectron: boolean
  latency: number
  messagesCount: number
  onClearChat: () => void
  /** 启动工作区环境：把命令交给终端执行 */
  onStartEnv?: (command: string) => void
  /** Token 统计（可选） */
  tokenStats?: {
    sessionTokens: number
    totalCalls: number
    intentIntercepted: number
  }
  /** 上下文长度统计（可选） */
  contextStats?: ContextStatsData
}

/** 格式化 Token 数字 */
function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** 格式化字符数 */
function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const breakdownLabels: Record<string, string> = {
  systemPrompt: '系统提示词',
  envContext: '项目环境',
  workspaceContext: '工作区',
  memoryContext: '主人画像',
  userInput: '用户输入',
  searchContext: '搜索结果',
  browserContext: '浏览器',
  scriptExecContext: '脚本结果',
  deltaFragments: '增量片段',
}

function ContextTooltip({ stats, children }: { stats: ContextStatsData; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const breakdownEntries = stats.breakdown
    ? Object.entries(stats.breakdown).filter(([, val]) => val > 0)
    : []

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute top-full right-0 mt-1.5 z-50 w-56 bg-slate-800 text-slate-100 rounded-lg shadow-xl border border-slate-700 text-[11px] leading-relaxed overflow-hidden">
          {/* 头部总览 */}
          <div className="px-3 py-2 bg-slate-700/60 border-b border-slate-600/50">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">上下文总长度</span>
              <span className="font-semibold text-blue-300">{formatChars(stats.totalLength)} 字</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-slate-400 text-[10px]">├ 基础上下文</span>
              <span className="text-slate-300 text-[10px]">{formatChars(stats.baseLength)} 字</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-[10px]">└ 对话增量</span>
              <span className="text-slate-300 text-[10px]">{formatChars(stats.incrementalLength)} 字</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-slate-400 text-[10px]">对话轮次</span>
              <span className="text-slate-300 text-[10px]">{stats.roundCount}</span>
            </div>
          </div>
          {/* 明细 */}
          {breakdownEntries.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              {breakdownEntries.map(([key, val]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-slate-400">{breakdownLabels[key] || key}</span>
                  <span className="text-slate-200 font-mono">{formatChars(val)} 字</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionHeader({
  sessionShort,
  isElectron,
  latency,
  messagesCount,
  onClearChat,
  onStartEnv,
  contextStats
}: SessionHeaderProps) {
  // 时钟状态内聚到 SessionHeader，不再冒泡到父组件
  const [timeStr, setTimeStr] = useState(() =>
    new Date().toLocaleTimeString('zh-CN', { hour12: false })
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-b border-border-subtle/60">
      <div className="flex items-center gap-3 min-w-0">
        {/* 当前工作区的终端工具；切换入口位于全局导航 */}
        <WorkspaceBar isElectron={isElectron} onStartEnv={(cmd) => onStartEnv?.(cmd)} />
        {isElectron && <span className="w-px h-4 bg-border-subtle/60 dark:bg-white/10 flex-shrink-0" />}
        <div className="flex items-center gap-2 text-xs font-mono flex-shrink-0">
          <span className="px-2 py-0.5 bg-text-primary/[0.06] border border-border-subtle/60 rounded text-text-muted font-semibold">Session: #{sessionShort}</span>
          <span className="text-text-faint">{timeStr}</span>
        </div>
        {messagesCount > 0 && (
          <button onClick={onClearChat} className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-faint hover:text-text-secondary hover:bg-text-primary/[0.06] rounded transition-all">
            <RotateCcw size={11} /> 新会话
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        {/* 上下文长度指示器 */}
        {isElectron && contextStats && contextStats.totalLength > 0 && (
          <ContextTooltip stats={contextStats}>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded font-mono cursor-default">
              <Layers size={11} className="text-blue-500" />
              <span className="text-blue-700 font-semibold">{formatChars(contextStats.totalLength)}</span>
              <span className="text-blue-400">字</span>
              {contextStats.incrementalLength > 0 && (
                <span className="text-blue-400 text-[10px]">+{formatChars(contextStats.incrementalLength)}</span>
              )}
            </div>
          </ContextTooltip>
        )}
      </div>
    </div>
  )
}

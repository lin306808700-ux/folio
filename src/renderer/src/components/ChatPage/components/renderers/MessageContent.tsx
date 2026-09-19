// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect, useRef } from 'react'
import { Sparkles, FolderOpen } from 'lucide-react'
import { useMessageBubbleContext } from '../MessageBubbleContext'
import { TextMessageContent } from './TextMessageContent'
import { CommandButtonContent, CommandOptionsContent } from './CommandContent'
import { ScriptContent } from './ScriptContent'
import { SearchReplaceContent } from './SearchReplaceContent'
import { ErrorContent } from './ErrorContent'
import { BrowserScreenshotContent, InlineCommandButton, AnalyzeOutputButton } from './MiscContent'
import { RichFormCard } from '../RichFormCard'
import { ArtifactRenderer } from '../ArtifactRenderer'
import { ProtocolStreamingBlock } from './ProtocolStreamingBlock'
import ChartRenderer from '../../../ChartRenderer'
import MarkdownRenderer from '../../../MarkdownRenderer'

/** 消息内容分发 — 根据 msg.type 渲染对应子组件 */
export function MessageContent() {
  const { msg, content, onOpenTaskProgress } = useMessageBubbleContext()

  // 流式中识别到协议时，统一折叠为「正在生成 XX…」状态条（对标深度思考模式）。
  // 解析完成后上层会清除 protocolStreaming 并切换为最终卡片类型。
  if (msg.protocolStreaming) {
    return (
      <>
        {msg.content && <div className="whitespace-pre-wrap mb-1">{msg.content}</div>}
        <ProtocolStreamingBlock
          kind={msg.protocolStreaming.kind}
          label={msg.protocolStreaming.label}
          draft={msg.protocolStreaming.draft}
          onOpenTaskProgress={msg.protocolStreaming.kind === 'muse_task' ? onOpenTaskProgress : undefined}
        />
      </>
    )
  }

  switch (msg.type) {
    case 'text':
      return (
        <>
          <TextMessageContent />
          <InlineCommandButton />
          <AnalyzeOutputButton />
        </>
      )

    case 'command':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <CommandButtonContent />
        </>
      )

    case 'command_options':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <CommandOptionsContent />
        </>
      )

    case 'script':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <ScriptContent />
        </>
      )

    case 'task_planning':
    case 'task_plan_confirm':
    case 'task_progress':
    case 'task_step_error':
    case 'task_confirm':
      // 任务细节交由 Muse 智能体界面展示，AI 终端不展示
      return null

    case 'search_replace':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <SearchReplaceContent />
        </>
      )

    case 'error':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <ErrorContent />
        </>
      )

    case 'browser_screenshot':
      return (
        <>
          <div className="whitespace-pre-wrap">{content}</div>
          <BrowserScreenshotContent />
        </>
      )

    case 'muse_transfer':
      return <MuseTransferContent />

    case 'muse_letter':
      // 来信红点已提示，不在对话流中重复通知
      return null

    case 'rich_form':
      return <RichFormContent />

    case 'artifact':
      return <ArtifactContent />

    default:
      // 用户消息或未知类型 — 走 text 渲染（MarkdownRenderer）
      if (msg.role === 'user' || msg.role === 'assistant') {
        return <TextMessageContent />
      }
      return <div className="whitespace-pre-wrap">{content}</div>
  }
}

/** Rich Form — AI 触发的内嵌表单。历史恢复的表单同样可交互填写。 */
function RichFormContent() {
  const { msg, onRichFormSubmit } = useMessageBubbleContext()
  const [submitted, setSubmitted] = useState(false)
  const [submittedValues, setSubmittedValues] = useState<Record<string, any> | undefined>()

  if (!msg.richFormData) return null

  function handleSubmit(values: Record<string, any>) {
    setSubmitted(true)
    setSubmittedValues(values)
    onRichFormSubmit?.(msg.id, values)
  }

  function handleCancel() {
    onRichFormSubmit?.(msg.id, null as any)
  }

  return (
    <>
      {msg.content && <div className="whitespace-pre-wrap mb-1">{msg.content}</div>}
      <RichFormCard
        formData={msg.richFormData}
        messageId={msg.id}
        submitted={submitted}
        submittedValues={submittedValues}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </>
  )
}

/** Artifact — 统一产物渲染。chart/form/markdown 复用专用组件，其余交给 ArtifactRenderer */
function ArtifactContent() {
  const { msg, onRichFormSubmit } = useMessageBubbleContext()
  const artifact = msg.artifactData
  if (!artifact) return null

  return (
    <>
      {msg.content && <div className="whitespace-pre-wrap mb-1">{msg.content}</div>}
      {renderArtifactBody()}
    </>
  )

  function renderArtifactBody() {
    if (!artifact) return null
    switch (artifact.type) {
      case 'chart':
        // artifact.data 约定为 ParsedTable 结构 { headers, data, chartType }
        return artifact.data ? <ChartRenderer table={artifact.data} /> : null

      case 'markdown':
        return <MarkdownRenderer content={artifact.content || ''} role="assistant" />

      case 'form':
        // artifact.data 约定为 RichFormData，复用 RichFormCard
        return artifact.data ? (
          <RichFormCard
            formData={artifact.data}
            messageId={msg.id}
            submitted={false}
            onSubmit={(values) => onRichFormSubmit?.(msg.id, values)}
            onCancel={() => onRichFormSubmit?.(msg.id, null as any)}
          />
        ) : null

      default:
        return (
          <ArtifactRenderer
            artifact={artifact}
            onFormSubmit={(_, values) => onRichFormSubmit?.(msg.id, values)}
          />
        )
    }
  }
}

/** Muse 执行中 — 极简气泡，动态感知任务进度 + 实时日志 */
function MuseTransferContent() {
  const { msg, allMessages } = useMessageBubbleContext()
  // 只有最新的 muse_transfer 气泡才订阅日志，避免多气泡重叠
  const isLatest = (allMessages?.findLastIndex((m: any) => m.type === 'muse_transfer') ?? -1) === allMessages?.findIndex((m: any) => m.id === msg.id)
  const p = msg.taskProgressData

  // 实时日志条目
  const [logs, setLogs] = useState<Array<{ message: string; level: string; timestamp: number }>>([])
  const logsEndRef = useRef<HTMLDivElement>(null)
  // 任务完成后的产物文件（最多3条）
  const [artifacts, setArtifacts] = useState<Array<{ id: string; filePath: string; type: string; description: string }>>([])

  const phase = !p ? 'idle'
    : p.status === 'completed' ? 'done'
    : p.status === 'error' ? 'error'
    : (p.totalSteps ?? 0) === 0 ? 'planning'
    : 'running'

  const runningStep = p?.steps?.find((s: any) => s.status === 'running')
  const completedCount = p?.steps?.filter((s: any) => s.status === 'completed').length ?? 0
  const totalCount = p?.totalSteps || p?.steps?.length || 0
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const isActive = phase === 'planning' || phase === 'running'

  // 仅最新气泡订阅 muse:log，避免多气泡重叠
  useEffect(() => {
    if (!window.electronAPI?.muse?.onLog || !isLatest) return
    const cleanup = window.electronAPI.muse.onLog((data: { message: string; level: string; taskId?: string; timestamp: number }) => {
      if (!data.message) return
      setLogs(prev => [...prev.slice(-19), { message: data.message, level: data.level, timestamp: data.timestamp }])
    })
    return cleanup
  }, [isLatest])

  // 任务完成后拉取最近产物
  useEffect(() => {
    if (phase !== 'done' || !window.electronAPI?.artifacts?.getRecent) return
    window.electronAPI.artifacts.getRecent(3).then((items: any[]) => {
      if (Array.isArray(items) && items.length > 0) setArtifacts(items)
    }).catch(() => {})
  }, [phase])

  // 新日志到来时滚动到底部
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex flex-col gap-2">
      {/* 标题行 */}
      <div className="flex items-center gap-2">
        <Sparkles size={12} className={`${isActive ? 'text-violet-400 animate-pulse' : 'text-violet-400/50'}`} />
        <span className="text-[13px] text-violet-400/70">Muse 正在执行</span>
      </div>

      {/* 进度区（有任务数据时显示） */}
      {phase !== 'idle' && (
        <div className="pl-5 flex flex-col gap-1.5">
          {/* 状态描述行 */}
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="flex gap-[3px] flex-shrink-0">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-[3px] h-[3px] rounded-full bg-violet-400/50 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms`, animationDuration: '1s' }}
                  />
                ))}
              </span>
            )}

            <span className={`text-[12px] truncate max-w-[200px] leading-none ${
              phase === 'done'  ? 'text-emerald-400/80' :
              phase === 'error' ? 'text-red-400/80' :
                                  'text-slate-500'
            }`}>
              {phase === 'planning' && '规划中…'}
              {phase === 'running'  && (runningStep?.description || '执行中…')}
              {phase === 'done'     && '已完成'}
              {phase === 'error'    && '执行出错'}
            </span>

            {phase === 'running' && totalCount > 0 && (
              <span className="text-[11px] text-slate-600 flex-shrink-0">
                {completedCount}/{totalCount}
              </span>
            )}
          </div>

          {/* 进度条（执行阶段） */}
          {phase === 'running' && totalCount > 0 && (
            <div className="h-[2px] w-32 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-400/60 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 实时日志区 */}
      {logs.length > 0 && (
        <div className="pl-5 mt-1 max-h-[120px] overflow-y-auto flex flex-col gap-[3px]">
          {logs.map((log, index) => (
            <div key={index} className="flex items-start gap-1.5">
              <span className={`text-[10px] leading-[16px] flex-shrink-0 ${
                log.level === 'error'   ? 'text-red-400/70' :
                log.level === 'warn'    ? 'text-amber-400/70' :
                log.level === 'success' ? 'text-emerald-400/70' :
                                          'text-slate-600'
              }`}>
                {log.level === 'error' ? '✕' : log.level === 'success' ? '✓' : '·'}
              </span>
              <span className={`text-[10px] leading-[16px] break-all ${
                log.level === 'error'   ? 'text-red-400/60' :
                log.level === 'warn'    ? 'text-amber-400/60' :
                log.level === 'success' ? 'text-emerald-400/60' :
                                          'text-slate-500'
              }`}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* 产物入口 — 任务完成后显示 */}
      {phase === 'done' && artifacts.length > 0 && (
        <div className="pl-5 mt-2 flex flex-col gap-1.5">
          {artifacts.map(art => {
            const fileName = art.filePath.split('/').pop() || art.filePath
            const dirPath = art.filePath.substring(0, art.filePath.lastIndexOf('/'))
            return (
              <button
                key={art.id}
                onClick={() => {
                  if (window.electronAPI?.shell?.showItemInFolder) {
                    window.electronAPI.shell.showItemInFolder(art.filePath)
                  } else {
                    window.electronAPI?.muse?.openWorkspace?.()
                  }
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors text-left group/art"
              >
                <FolderOpen size={12} className="text-emerald-400/70 flex-shrink-0 group-hover/art:text-emerald-400" />
                <span className="text-[11px] text-emerald-400/70 group-hover/art:text-emerald-400 truncate max-w-[200px]">
                  {fileName}
                </span>
                <span className="text-[10px] text-slate-600 truncate flex-1 hidden group-hover/art:block">
                  {dirPath}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* 无产物但完成 — 显示打开工作区按钮 */}
      {phase === 'done' && artifacts.length === 0 && (
        <button
          onClick={() => window.electronAPI?.muse?.openWorkspace?.()}
          className="pl-5 mt-1 flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-emerald-400/70 transition-colors"
        >
          <FolderOpen size={11} />
          打开产物目录
        </button>
      )}
    </div>
  )
}

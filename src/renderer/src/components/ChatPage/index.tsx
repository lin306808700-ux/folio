// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { Sparkles, Eraser, Clock, Activity, Zap, ShieldCheck, Terminal as TerminalIcon, Square, Shield, Trash2, RefreshCw, X, ChevronsDown, FolderOpen, Play, Code2, Box, ChevronDown, ChevronRight, Minimize2, RotateCcw } from 'lucide-react'
import { Terminal } from '../Terminal'
import { MuseAvatar, MuseState } from '../MuseAvatar'

import { useSessionStatus } from './hooks/useSessionStatus'
import { useInputHistory } from './hooks/useInputHistory'
import { useHistoryRecords } from './hooks/useHistoryRecords'
import { useChatMessages } from './hooks/useChatMessages'
import { useSlashCommands, SlashCommand } from './hooks/useSlashCommands'
import { useTriggerSearch, detectTrigger, TriggerItem } from './hooks/useTriggerSearch'
import { useTokenMonitor } from './hooks/useTokenMonitor'
import { useReactProgress } from './hooks/useReactProgress'
import { usePinchZoom } from './hooks/usePinchZoom'

import { MessageBubble } from './components/MessageBubble'
import { SessionHeader } from './components/SessionHeader'
import { ChatInput } from './components/ChatInput'
import { TriggerPopup } from './components/TriggerPopup'
import { SearchStatusDisplay } from './components/SearchStatus'
import { StatusItem } from './components/StatusItem'
import { TaskRecoveryBanner } from './components/TaskRecoveryBanner'
import { ContextChipStrip } from './components/ContextChipStrip'
import { FileBrowserPanel } from './components/FileBrowserPanel'
import { TasksPanel } from './components/TasksPanel'
import { ErrorBoundary } from '../ErrorBoundary'
import type { Message, ImageAttachment, QuoteContext, ChatRequestEnvelope } from './types'

/** CPU 状态项 — 通过 electronAPI 获取真实值，fallback 显示 idle */
function CpuStatusItem() {
  const [cpu, setCpu] = useState<string>('idle')

  useEffect(() => {
    const fetchCpu = async () => {
      const result = await (window as any).electronAPI?.system?.getCpuUsage?.()
      if (result?.usage !== undefined) {
        setCpu(`${result.usage.toFixed(1)}%`)
      }
    }
    fetchCpu()
    const timer = setInterval(fetchCpu, 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <StatusItem
      icon={<Activity size={11} />}
      label="CPU"
      value={cpu}
      color="slate"
    />
  )
}

/** ReAct 步骤卡片 — 点击展开查看完整 thought / action / observation */
function ReactStepCard({ step }: { step: import('./hooks/useReactProgress').ReactStep }) {
  const [expanded, setExpanded] = useState(false)
  const statusStyle = step.status === 'running'
    ? 'border-purple-500/30 bg-purple-500/5'
    : step.status === 'error'
      ? 'border-red-500/20 bg-red-500/5'
      : 'border-border-subtle/50 dark:border-white/[0.06] bg-surface/40 dark:bg-white/[0.02]'
  const badgeStyle = step.status === 'running'
    ? 'bg-purple-500/20 text-purple-500 dark:text-purple-400'
    : step.status === 'error'
      ? 'bg-red-500/20 text-red-500 dark:text-red-400'
      : 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400'
  const statusIcon = step.status === 'running' ? '⟳' : step.status === 'error' ? '✗' : '✓'

  return (
    <div className={`border rounded-lg overflow-hidden ${statusStyle}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
      >
        <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${badgeStyle}`}>
          {statusIcon}
        </span>
        <span className="text-[11px] text-text-primary dark:text-white font-medium truncate flex-1">
          {step.thought.substring(0, 60)}
        </span>
        {expanded
          ? <ChevronDown size={12} className="text-text-faint flex-shrink-0" />
          : <ChevronRight size={12} className="text-text-faint flex-shrink-0" />
        }
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-border-subtle/30 dark:border-white/[0.04]">
          <div className="pt-2">
            <div className="text-[10px] text-text-faint dark:text-slate-500 font-semibold mb-0.5">Thought</div>
            <div className="text-[11px] text-text-muted dark:text-slate-400 leading-relaxed">{step.thought}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-faint dark:text-slate-500 font-semibold mb-0.5">Action</div>
            <div className="text-[11px] text-text-primary dark:text-white font-mono bg-black/[0.03] dark:bg-white/[0.04] rounded px-2 py-1">
              {step.action}({step.input ? (typeof step.input === 'string' ? step.input : JSON.stringify(step.input)).substring(0, 200) : ''})
            </div>
          </div>
          {step.observation && (
            <div>
              <div className="text-[10px] text-text-faint dark:text-slate-500 font-semibold mb-0.5">Observation</div>
              <pre className="text-[10px] text-text-muted dark:text-slate-500 font-mono bg-black/[0.03] dark:bg-white/[0.04] rounded px-2 py-1 max-h-[120px] overflow-y-auto whitespace-pre-wrap break-all">
                {step.observation.substring(0, 1000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ChatPage = () => {
  const [input, setInput] = useState('')
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [quoteContext, setQuoteContext] = useState<QuoteContext | null>(null)
  const [queuedRequests, setQueuedRequests] = useState<ChatRequestEnvelope[]>([])
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const pinchZoom = usePinchZoom()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  // 从其他入口跳转过来时：填入并聚焦输入框；
  // 若来源明确要求「直接开始」（学习图谱的继续对话），交给下面的 effect 自动发送
  const pendingAutoSendRef = useRef<string | null>(null)
  useEffect(() => {
    const initialKey = sessionStorage.getItem('muse_initial_key')
    const autoSend = sessionStorage.getItem('muse_initial_autosend') === '1'
    if (initialKey) {
      sessionStorage.removeItem('muse_initial_key')
      sessionStorage.removeItem('muse_initial_autosend')
      if (autoSend) pendingAutoSendRef.current = initialKey
      else setInput(initialKey)
    }
    const timer = setTimeout(() => {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        const len = textarea.value.length
        textarea.setSelectionRange(len, len)
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // 终端宽度拖拽相关
  const [terminalWidth, setTerminalWidth] = useState(580)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(580)

  // 右侧面板模式：动态面板 / 终端（功能减法：浏览器面板已移除）
  const [rightPanelMode, setRightPanelMode] = useState<'context' | 'terminal' | 'files' | 'tasks'>('context')
  const [rightPanelVisible, setRightPanelVisible] = useState(false)
  const [rightPanelError, setRightPanelError] = useState<string | null>(null)
  const autoOpenedPanelRef = useRef<'context' | 'tasks' | null>(null)

  // 切换模式处理（同时展开面板）
  const handleSwitchMode = (mode: 'context' | 'terminal' | 'files' | 'tasks') => {
    setRightPanelError(null)
    setRightPanelMode(mode)
    setRightPanelVisible(true)
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    startX.current = e.clientX
    startWidth.current = terminalWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [terminalWidth])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // 向左拖增加宽度，向右拖减少宽度（终端在右侧）
      const delta = startX.current - e.clientX
      const newWidth = Math.min(800, Math.max(300, startWidth.current + delta))
      setTerminalWidth(newWidth)
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Hooks
  const session = useSessionStatus(isElectron)
  const handleSendRef = useRef<() => void>(() => {})
  const inputHistoryHook = useInputHistory(input, setInput, () => handleSendRef.current())
  const slashCommands = useSlashCommands()
  const triggerSearch = useTriggerSearch(isElectron)

  const chat = useChatMessages({
    isElectron,
    sessionIdRef: session.sessionIdRef,
    setLatency: session.setLatency,
    setSafetyLevel: session.setSafetyLevel,
    resetSession: session.resetSession,
    recordInput: inputHistoryHook.recordInput
  })

  // 学习图谱「继续对话」进来即开跑：用户点的是「开始继续学」，不该再要求手动发送一次
  useEffect(() => {
    const pending = pendingAutoSendRef.current
    if (!isElectron || !pending || chat.loading) return
    const timer = setTimeout(() => {
      if (pendingAutoSendRef.current !== pending) return
      pendingAutoSendRef.current = null
      chat.doSend(pending)
    }, 80)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.loading])

  const historyHook = useHistoryRecords(isElectron, chat.setMessages)
  // Plan 已移除 — 任务管理统一由 Muse 任务系统承载
  const tokenMonitor = useTokenMonitor()

  // 缓存 sparkline 随机高度，避免每次重渲染闪动
  const sparklineHeights = useMemo(() => {
    const count = Math.min(session.tokenStats.totalCalls, 12)
    return {
      input: Array.from({ length: count }, () => Math.max(3, Math.random() * 16)),
      output: Array.from({ length: count }, () => Math.max(3, Math.random() * 16)),
    }
  }, [session.tokenStats.totalCalls])

  const reactProgress = useReactProgress()

  // 工作区能力：环境检测 + 可用编辑器
  const [workspaceEnv, setWorkspaceEnv] = useState<{ type: string; label: string; startCommand: string | null; runnable: boolean; quickScripts?: Array<{ name: string; command: string; icon: string; source: string }> } | null>(null)
  const [availableEditors, setAvailableEditors] = useState<Array<{ id: string; name: string }>>([])

  const refreshWorkspaceEnv = useCallback(async () => {
    if (!isElectron) return
    const envResult = await window.electronAPI?.workspace?.detectEnv?.()
    setWorkspaceEnv(envResult?.success ? envResult.data : null)
  }, [isElectron])

  // 冷启动加载可用编辑器（主进程已预热缓存，这里直接取）
  useEffect(() => {
    if (!isElectron) return
    window.electronAPI?.workspace?.detectEditors?.().then((res: any) => {
      if (res?.success) setAvailableEditors(res.data || [])
    })
  }, [isElectron])

  // 进入面板 / 工作区变更时检测环境
  useEffect(() => {
    refreshWorkspaceEnv()
    if (!isElectron || !window.electronAPI?.workspace?.onChanged) return
    const cleanup = window.electronAPI.workspace.onChanged(() => refreshWorkspaceEnv())
    return () => cleanup?.()
  }, [refreshWorkspaceEnv, isElectron])

  // 启动环境：把命令送入终端执行（顶部工作区栏传入命令，右面板卡片用 workspaceEnv）
  const runEnvCommand = useCallback((command: string) => {
    if (!command) return
    setRightPanelMode('terminal')
    setRightPanelVisible(true)
    chat.setCommandToExecute(command)
  }, [chat])

  const handleStartEnv = useCallback(() => {
    if (!workspaceEnv?.startCommand) return
    runEnvCommand(workspaceEnv.startCommand)
  }, [workspaceEnv, runEnvCommand])

  const handleOpenFolder = useCallback(() => {
    window.electronAPI?.workspace?.openInFolder?.()
  }, [])

  const handleOpenInEditor = useCallback((editorId: string) => {
    window.electronAPI?.workspace?.openInEditor?.(editorId)
  }, [])

  // ReAct 危险 shell 命令确认 — 在对话流插入授权卡片（复用 script needAuth 渲染）
  useEffect(() => {
    const reactApi = (window as any).electronAPI?.react
    if (!isElectron || !reactApi?.onNeedConfirm) return

    const cleanup = reactApi.onNeedConfirm((data: {
      authId: string
      step: number
      command: string
      riskLevel: string
      reason: string
    }) => {
      const confirmMsg: Message = {
        id: `react-confirm-${data.authId}`,
        role: 'assistant',
        content: `⚠️ 第 ${data.step} 步要执行一条危险命令，需要你确认`,
        type: 'script',
        scriptData: {
          scriptFile: '',
          filename: data.command.slice(0, 60),
          lang: 'bash',
          description: `危险命令（${data.riskLevel}）`,
          scriptContent: data.command,
          runCommand: data.command,
          isDangerous: true,
          dangerReason: data.reason,
          execStatus: 'needAuth',
          authId: data.authId,
        } as any,
      }
      chat.setMessages(prev => [...prev, confirmMsg])
    })

    return () => cleanup?.()
  }, [isElectron])

  // 脚本执行命令时自动切到终端并展开面板
  useEffect(() => {
    if (chat.commandToExecute && rightPanelMode === 'context' && !reactProgress.progress.active) {
      setRightPanelMode('terminal')
      setRightPanelVisible(true)
    }
  }, [chat.commandToExecute])

  // “回到底部”可见性由 Virtuoso 的 atBottomStateChange 驱动，不再手写滚动监听

  // 本地滚动到底部（供“回到底部”按钮调用）
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })
  }, [])

  // Muse 来信通知由导航栏红点处理，不在对话流插入气泡

  // 监听工作区变更事件，自动 cd 到新工作区目录（首次启动由主进程 terminal-manager 处理）
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.workspace?.onChanged) return

    const cleanup = window.electronAPI.workspace.onChanged((workspace: { path: string; name: string }) => {
      console.log('[ChatPage] 工作区已变更，自动 cd 到:', workspace.path)
      chat.setCommandToExecute(`cd "${workspace.path}"`)
      // 工作区切换后清空 @ 触发器的文件缓存，下次触发时重新加载新工作区文件
      triggerSearch.resetWorkspaceCache()
    })

    return () => cleanup?.()
  }, [])

  // textarea 自适应高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.min(textareaRef.current.scrollHeight, 240)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [input])

  // 发送
  const handleSend = () => {
    if (!input.trim() && attachedImages.length === 0) return
    const msg = input.trim()
    const quotedMessage = quoteContext
      ? chat.messages.find(message => message.id === quoteContext.messageId) || null
      : null
    const quoted = quoteContext?.selectedText
    const imagesToSend = [...attachedImages]
    const envelope: ChatRequestEnvelope = {
      text: msg,
      quote: quoteContext || undefined,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    }
    setInput('')
    setAttachedImages([])
    setQuoteContext(null)
    slashCommands.closeMenu()
    triggerSearch.closeMenu()
    if (chat.loading) {
      setQueuedRequests(prev => [...prev, envelope])
      return
    }
    // 新消息发送时，清除已完成的上一次任务进度（避免残留旧 artifacts）
    if (reactProgress.progress.done) {
      reactProgress.reset()
    }
    chat.doSend(msg, false, quoted, quotedMessage || undefined, imagesToSend)
  }
  // 同步最新 handleSend 到 ref，供 useInputHistory 的 Cmd+Enter 调用
  handleSendRef.current = handleSend

  useEffect(() => {
    if (chat.loading || queuedRequests.length === 0) return
    const request = queuedRequests[0]
    setQueuedRequests(prev => prev.slice(1))
    const sourceMessage = request.quote
      ? chat.messages.find(message => message.id === request.quote!.messageId)
      : undefined
    chat.doSend(
      request.text,
      false,
      request.quote?.selectedText,
      sourceMessage,
      request.images,
      request
    )
  }, [chat.loading, queuedRequests])

  // 滚动到指定消息：先让 Virtuoso 跳到虚拟项，再高亮真实 DOM
  const scrollToMessage = useCallback((messageId: string) => {
    const idx = chat.messages.findIndex((m) => m.id === messageId)
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' })
    }
    setTimeout(() => {
      const element = document.querySelector(`[data-message-id="${messageId}"]`)
      if (element) {
        element.classList.add('ring-2', 'ring-indigo-400', 'ring-offset-2')
        setTimeout(() => {
          element.classList.remove('ring-2', 'ring-indigo-400', 'ring-offset-2')
        }, 2000)
      }
    }, 300)
  }, [chat.messages])

  // 触发器输入回调 — 检测 @/#// 并打开搜索面板
  const handleTriggerInput = useCallback((data: { trigger: '@' | '#' | '/'; filter: string } | null) => {
    if (data) {
      triggerSearch.openMenu(data.trigger, data.filter)
      // 关闭旧的斜杠面板
      slashCommands.closeMenu()
    } else {
      triggerSearch.closeMenu()
    }
  }, [triggerSearch, slashCommands])

  // 选中触发器列表项 — 替换输入框中的触发文本
  const handleSelectTriggerItem = useCallback((item: TriggerItem) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const range = triggerSearch.getTriggerRange(input, cursorPos)

    if (range) {
      const before = input.slice(0, range.start)
      // 保留触发字符 + 插入文本 + 空格
      const insertText = item.insertText
      const after = input.slice(range.end)
      const newValue = before + insertText + ' ' + after
      setInput(newValue)
      triggerSearch.closeMenu()

      // 恢复光标位置到插入文本后面
      setTimeout(() => {
        const newCursorPos = range.start + insertText.length + 1
        textarea.setSelectionRange(newCursorPos, newCursorPos)
        textarea.focus()
      }, 0)
    } else {
      // 没有精确范围时，直接设置整个输入
      setInput(item.insertText + ' ')
      triggerSearch.closeMenu()
    }
  }, [input, triggerSearch])

  // 斜杠输入回调（兼容旧逻辑）
  const handleSlashInput = useCallback((value: string | null) => {
    if (value && value.startsWith('/')) {
      slashCommands.openMenu(value.slice(1))
      triggerSearch.closeMenu()
    } else {
      slashCommands.closeMenu()
    }
  }, [slashCommands, triggerSearch])

  // 选中斜杠命令处理（旧逻辑，保留 /clear /reset 等）
  const handleSelectSlashCommand = useCallback((cmd: SlashCommand) => {
    const commandText = slashCommands.selectCommand(cmd)
    
    if (cmd.command === '/clear') {
      // 清空对话
      chat.handleClearChat()
      reactProgress.reset()
      setInput('')
    } else if (cmd.command === '/reset') {
      // 重置会话
      session.resetSession()
      chat.setMessages([])
      reactProgress.reset()
      setInput('')
    } else {
      // 其他命令设置到输入框
      setInput(commandText)
    }
  }, [slashCommands, chat, session])

  // 处理键盘事件（包含触发器面板和斜杠命令面板）
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 优先处理新触发器面板
    if (triggerSearch.isOpen) {
      const result = triggerSearch.handleKeyDown(e)
      if (result.consumed) {
        if (result.selectCurrent) {
          const selected = triggerSearch.getSelectedItem()
          if (selected) handleSelectTriggerItem(selected)
        }
        return
      }
    }

    // 如果斜杠面板打开，让它处理
    if (slashCommands.isSlashMenuOpen) {
      const consumed = slashCommands.handleKeyDown(e)
      if (consumed) {
        // Enter 键选中当前项
        if (e.key === 'Enter' && slashCommands.filteredCommands.length > 0) {
          const selectedCmd = slashCommands.filteredCommands[slashCommands.selectedIndex]
          handleSelectSlashCommand(selectedCmd)
        }
        return
      }
    }
    // 否则走原来的输入历史处理
    inputHistoryHook.handleKeyDown(e)
  }, [triggerSearch, slashCommands, inputHistoryHook, handleSelectTriggerItem, handleSelectSlashCommand])

  // 派生数据
  const sessionShort = session.sessionIdRef.current.slice(-4)
  const { contextInfo, contextStats } = chat
  const contextSavingPercent = contextInfo.firstFullSize > 0 && contextInfo.mode === 'light'
    ? Math.round((1 - contextInfo.size / contextInfo.firstFullSize) * 100)
    : 0

  // Muse 形象状态派生
  const museState: MuseState = useMemo(() => {
    if (reactProgress.progress.active && !reactProgress.progress.done) return 'working'
    if (chat.isStreaming) return 'outputting'
    if (chat.messages.length > 0 && chat.messages[chat.messages.length - 1]?.type === 'error') return 'error'
    if (chat.loading) return 'working'
    if (chat.messages.length === 0) return 'waiting'
    return 'idle'
  }, [reactProgress.progress.active, reactProgress.progress.done, chat.isStreaming, chat.loading, chat.messages])

  const museStateLabel = useMemo(() => {
    switch (museState) {
      case 'working': return '努力工作中...'
      case 'outputting': return '输出中~'
      case 'error': return '呜...出错了'
      case 'waiting': return '等你说话~'
      case 'idle': return '随时待命 ✦'
    }
  }, [museState])

  // 任务队列数据（从 Muse 任务系统获取）
  const [taskQueue, setTaskQueue] = useState<Array<{ id: string; title: string; status: 'pending' | 'running' | 'done' | 'error' }>>([])

  // 监听 Muse 任务队列更新
  useEffect(() => {
    if (!isElectron) return
    const cleanup = (window as any).electronAPI?.muse?.onTaskQueueUpdate?.((tasks: any[]) => {
      setTaskQueue(tasks.map((t: any) => ({
        id: t.id,
        title: t.title || t.description?.substring(0, 30) || '未命名任务',
        status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'running' : t.status === 'failed' ? 'error' : 'pending'
      })))
    })
    return () => cleanup?.()
  }, [])

  // ReAct 执行时自动添加到任务队列视图
  useEffect(() => {
    if (reactProgress.progress.active && reactProgress.progress.command) {
      setTaskQueue(prev => {
        const existing = prev.find(t => t.id === 'react-current')
        const newTask = {
          id: 'react-current',
          title: reactProgress.progress.command.substring(0, 40),
          status: (reactProgress.progress.done ? 'done' : 'running') as 'pending' | 'running' | 'done' | 'error'
        }
        if (existing) {
          return prev.map(t => t.id === 'react-current' ? newTask : t)
        }
        return [...prev, newTask]
      })

      // ReAct 开始时自动展开右侧面板（context 模式）展示步骤进度
      if (!reactProgress.progress.done) {
        setRightPanelMode('context')
        setRightPanelVisible(true)
        autoOpenedPanelRef.current = 'context'
      } else if (autoOpenedPanelRef.current === 'context' && rightPanelMode === 'context') {
        setRightPanelVisible(false)
        autoOpenedPanelRef.current = null
      }
    }
  }, [reactProgress.progress.active, reactProgress.progress.done, reactProgress.progress.command])

  useEffect(() => {
    if (!reactProgress.progress.done) return
    if (autoOpenedPanelRef.current === 'context' && rightPanelMode === 'context') {
      setRightPanelVisible(false)
      autoOpenedPanelRef.current = null
    }
  }, [reactProgress.progress.done, rightPanelMode])

  useEffect(() => {
    const taskMessages = chat.messages.filter(message => message.type === 'task_progress' && message.taskProgressData)
    const hasRunningTask = taskMessages.some(message => ['pending', 'running'].includes(message.taskProgressData!.status))
    const hasBlockingTask = taskMessages.some(message =>
      message.taskProgressData!.status === 'paused' || message.taskProgressData!.status === 'error'
    )

    if (hasRunningTask) {
      setRightPanelMode('tasks')
      setRightPanelVisible(true)
      autoOpenedPanelRef.current = 'tasks'
    } else if (!hasBlockingTask && autoOpenedPanelRef.current === 'tasks' && rightPanelMode === 'tasks') {
      setRightPanelVisible(false)
      autoOpenedPanelRef.current = null
    }
  }, [chat.messages, rightPanelMode])

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* 主内容区 */}
      <div className="flex flex-1 gap-2 min-h-0">
      {/* 左侧：AI 对话区 — 居中聚焦 */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <SessionHeader
          sessionShort={sessionShort}
          isElectron={isElectron}
          latency={session.latency}
          messagesCount={chat.messages.length}
          onClearChat={() => { chat.handleClearChat(); reactProgress.reset() }}
          onStartEnv={runEnvCommand}
          contextStats={contextStats}
        />

        {/* 上下文模式指示器 */}
        {contextInfo.mode === 'light' && contextInfo.size > 0 && (
          <div className="flex items-center justify-center py-1.5 border-b border-border-subtle/60">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/8 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium rounded-full">
              <Zap size={11} />
              轻量上下文 · {contextSavingPercent > 0 ? `节省 ${contextSavingPercent}%` : `${contextInfo.size} 字`}
            </div>
          </div>
        )}

        {/* 未完成任务恢复提示 */}
        <TaskRecoveryBanner
          isElectron={isElectron}
          onTaskResumed={() => {
            setRightPanelMode('tasks')
            setRightPanelVisible(true)
          }}
        />

        {/* 对话历史 — 虚拟滚动以提升长会话性能，滚动锚定交由 Virtuoso 接管 */}
        <div ref={pinchZoom.containerRef} className="flex-1 min-h-0 scroll-container">
          {chat.messages.length === 0 && !historyHook.showHistoryHint ? (
            <div className="h-full max-w-[720px] mx-auto w-full px-8">
              <div className="flex flex-col items-center justify-center h-full text-center">
                <motion.h1
                  className="text-3xl font-light tracking-tight text-text-primary/90"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.8 }}
                  style={{ textShadow: '0 0 30px rgba(139,92,246,0.25)' }}
                >
                  你好，我是 Muse
                </motion.h1>
                <motion.p
                  className="mt-4 text-sm text-text-muted leading-relaxed max-w-sm mx-auto"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.8 }}
                >
                  我不在某个角落里——你看到的、感受到的这片空间，就是我。
                  <br />
                  随便说点什么，我能感应到。
                </motion.p>
              </div>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              data={chat.messages}
              className="scroll-container"
              style={{ height: '100%' }}
              followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
              atBottomThreshold={120}
              atBottomStateChange={(atBottom) => setShowScrollToBottom(!atBottom)}
              increaseViewportBy={{ top: 400, bottom: 600 }}
              components={{
                Header: () => (
                  <div className="max-w-[720px] mx-auto w-full px-6 pt-6">
                    {historyHook.showHistoryHint && (
                      <div className="flex items-center justify-center pb-3">
                        <button
                          onClick={historyHook.loadMoreHistory}
                          className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-faint transition-colors hover:text-text-muted focus:outline-none focus:text-text-primary"
                        >
                          <Clock size={11} />
                          加载更早的对话
                        </button>
                      </div>
                    )}
                  </div>
                ),
                Footer: () => (
                  <div className="max-w-[720px] mx-auto w-full px-6 pb-6">
                    <SearchStatusDisplay searchStatus={chat.searchStatus} />
                  </div>
                ),
              }}
              computeItemKey={(_, msg) => msg.id}
              itemContent={(_, msg) => (
                <div className="max-w-[720px] mx-auto w-full px-6 pb-6">
                  <ErrorBoundary level="section" regionName="消息">
                    <MessageBubble
                      msg={msg}
                      loading={chat.loading}
                      isElectron={isElectron}
                      onExecuteCommand={chat.executeCommand}
                      onExecuteScript={chat.executeScript}
                      onExecuteSpecificCommand={chat.executeSpecificCommand}
                      onConfirmTask={chat.confirmTaskAction}
                      onRetry={chat.handleRetry}
                      onAnalyzeOutput={chat.analyzeTerminalOutput}
                      onQuote={(m) => {
                        setQuoteContext({ messageId: m.id, role: m.role, selectedText: m.content })
                        textareaRef.current?.focus()
                      }}
                      onQuoteSelection={(m, text) => {
                        setQuoteContext({ messageId: m.id, role: m.role, selectedText: text })
                        requestAnimationFrame(() => textareaRef.current?.focus())
                      }}
                      onDeleteMessage={(messageId) => chat.deleteMessage(messageId)}
                      onScrollToMessage={scrollToMessage}
                      onOpenTaskProgress={() => {
                        setRightPanelMode('context')
                        setRightPanelVisible(true)
                      }}
                      onEditStep={(stepId, newDescription) => {
                        chat.updateMessage(msg.id, (m: any) => {
                          if (m.taskProgressData) {
                            return {
                              ...m,
                              taskProgressData: {
                                ...m.taskProgressData,
                                steps: m.taskProgressData.steps.map((s: any) =>
                                  s.id === stepId ? { ...s, description: newDescription } : s
                                )
                              }
                            }
                          }
                          return m
                        })
                      }}
                      onDeleteStep={(stepId) => {
                        chat.updateMessage(msg.id, (m: any) => {
                          if (m.taskProgressData) {
                            return {
                              ...m,
                              taskProgressData: {
                                ...m.taskProgressData,
                                steps: m.taskProgressData.steps.filter((s: any) => s.id !== stepId)
                              }
                            }
                          }
                          return m
                        })
                      }}
                      onPauseTask={chat.pauseTask}
                      onResumeTask={chat.resumeTask}
                      onCancelTask={chat.cancelTask}
                      onRetryTask={chat.retryTask}
                      onSkipStep={chat.skipStep}
                      onAnalyzeError={chat.analyzeError}
                      onInterveneTask={chat.interveneTask}
                      onRichFormSubmit={chat.handleRichFormSubmit}
                      allMessages={chat.messages}
                    />
                  </ErrorBoundary>
                </div>
              )}
            />
          )}
        </div>

        {/* 缩放恢复按钮 */}
        {pinchZoom.isZoomed && (
          <button
            onClick={pinchZoom.resetZoom}
            className="absolute bottom-24 left-6 z-20 flex items-center gap-1.5 px-3 py-2 bg-violet-600/90 hover:bg-violet-500 text-white rounded-full shadow-lg text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
          >
            <Minimize2 size={14} />
            恢复缩放 ({Math.round(pinchZoom.scale * 100)}%)
          </button>
        )}

        {/* 回到底部浮动按钮 */}
        {showScrollToBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-24 right-6 z-20 flex items-center gap-1.5 px-3 py-2 bg-slate-700/90 hover:bg-slate-600 text-slate-200 rounded-full shadow-lg text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
          >
            <ChevronsDown size={14} />
            回到底部
          </button>
        )}

        <AnimatePresence>
          {chat.deletedMessage && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border-subtle/70 bg-surface/95 px-3 py-2 text-xs text-text-secondary shadow-lg backdrop-blur-xl"
              role="status"
            >
              消息已删除
              <button onClick={chat.undoDeleteMessage} className="font-semibold text-brand hover:text-brand-soft">撤销</button>
            </motion.div>
          )}
          {chat.taskActionNotice && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={chat.dismissTaskActionNotice}
              className={`absolute bottom-24 right-6 z-40 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-xl ${
                chat.taskActionNotice.state === 'error'
                  ? 'border-red-400/30 bg-red-500/10 text-red-500'
                  : chat.taskActionNotice.state === 'success'
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-500'
                    : 'border-brand/30 bg-surface/95 text-text-secondary'
              }`}
              role="status"
            >
              {chat.taskActionNotice.message}
            </motion.button>
          )}
        </AnimatePresence>

        {/* 停止生成按钮 */}
        {chat.isStreaming && (
          <div className="flex justify-center py-2">
            <button
              onClick={chat.stopGeneration}
              className="flex items-center gap-2 px-4 py-2 bg-text-primary/[0.06] hover:bg-text-primary/[0.1] text-text-secondary border border-border-subtle/70 rounded-full text-sm transition-colors"
            >
              <Square size={14} fill="currentColor" />
              停止生成
            </button>
          </div>
        )}

        {/* 输入框容器 - 设置 relative 用于定位弹出面板 */}
        <div className="relative max-w-[720px] mx-auto w-full">
          {/* 新：统一触发器搜索面板 (@/#//) */}
          <TriggerPopup
            trigger={triggerSearch.trigger}
            items={triggerSearch.items}
            selectedIndex={triggerSearch.selectedIndex}
            isOpen={triggerSearch.isOpen}
            onSelect={handleSelectTriggerItem}
            onHoverItem={(index) => triggerSearch.setSelectedIndex(index)}
          />

          {/* 旧：斜杠命令面板（过渡期保留，当新面板未覆盖时回退） */}
          {slashCommands.isSlashMenuOpen && !triggerSearch.isOpen && slashCommands.filteredCommands.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 mx-4 z-50">
              <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                {slashCommands.filteredCommands.map((cmd, index) => {
                  const Icon = { Shield, Trash2, RefreshCw }[cmd.icon];
                  return (
                    <div
                      key={cmd.command}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                        index === slashCommands.selectedIndex ? 'bg-slate-700' : 'hover:bg-slate-700/50'
                      }`}
                      onClick={() => handleSelectSlashCommand(cmd)}
                    >
                      {Icon && <Icon size={16} className="text-slate-400 flex-shrink-0" />}
                      <span className="text-slate-200 font-mono text-sm">{cmd.command}</span>
                      <span className="text-slate-500 text-sm ml-auto">{cmd.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <ChatInput
            input={input}
            onInputChange={(v) => { setInput(v); inputHistoryHook.resetHistoryIndex() }}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            loading={chat.loading}
            isElectron={isElectron}
            textareaRef={textareaRef}
            onClearMessages={() => chat.setMessages([])}
            onSlashInput={handleSlashInput}
            onTriggerInput={handleTriggerInput}
            attachedImages={attachedImages}
            onImagesChange={setAttachedImages}
            queuedRequest={queuedRequests[0] || null}
            queuedCount={queuedRequests.length}
            onCancelQueuedRequest={() => setQueuedRequests(prev => prev.slice(1))}
            quotePreview={quoteContext?.selectedText}
            quoteRole={quoteContext?.role}
            onClearQuote={() => setQuoteContext(null)}
          />
        </div>
      </div>

      {/* 右侧：按需侧滑面板 */}
      {/* 退场时宽度同步收缩到 0，让左侧对话区(flex-1)平滑跟随，避免一闪即满的跳变 */}
      <AnimatePresence initial={false}>
      {rightPanelVisible && (
      <motion.div
        key="right-panel"
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: terminalWidth, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ width: { type: 'spring', stiffness: 260, damping: 30 }, opacity: { duration: 0.2 } }}
        className="flex bg-surface/70 dark:bg-slate-900/60 backdrop-blur-2xl overflow-hidden border-l border-border-subtle/60 dark:border-white/[0.08] shadow-2xl shadow-black/10 dark:shadow-black/50 flex-shrink-0"
      >
      {/* 固定宽度内层：内容始终按 terminalWidth 布局，外层宽度收缩时仅裁剪、内容不回流抖动 */}
      <div className="flex flex-col flex-shrink-0 h-full" style={{ width: terminalWidth }}>
        {/* 面板头部 — 精简：仅保留操作按钮，导航由右侧 Dock 图标栏承担 */}
        <div className="flex items-center justify-end px-2 py-1.5 bg-elevated/40 dark:bg-white/[0.03] border-b border-border-subtle/50 dark:border-white/[0.06]">
          {isElectron && rightPanelMode === 'terminal' && (
            <button onClick={chat.handleClearTerminal} className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted dark:text-slate-600 dark:hover:text-slate-400 transition-colors" title="清屏">
              <Eraser size={12} />
            </button>
          )}
          <button
            onClick={() => setRightPanelVisible(false)}
            className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
            title="收起面板"
          >
            <X size={13} />
          </button>
        </div>

        {/* 右侧面板错误提示 */}
        {rightPanelError && (
          <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
            {rightPanelError}
          </div>
        )}

        {/* 内容区域：切换模式（不再分屏，Terminal 仅在用户主动切到终端 tab 时显示） */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 任务活跃时：在 context 模式下占满显示 Activity Feed（不再上下分屏挤压终端） */}
          {reactProgress.progress.active && rightPanelMode === 'context' && (
            <div className="flex-1 overflow-y-auto scroll-dark">
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-purple-500 dark:text-purple-400 text-xs font-semibold">
                  <Sparkles size={12} className={reactProgress.progress.done ? '' : 'animate-pulse'} />
                  <span>
                    {reactProgress.progress.aborted
                      ? '⛔ 已中断'
                      : reactProgress.progress.done
                        ? '✓ 执行完成'
                        : '⟳ Agent 执行中'}
                  </span>
                  <span className="ml-auto text-text-faint dark:text-slate-600 text-[10px] font-mono">{reactProgress.progress.steps.length} steps</span>
                </div>
                {/* 中断后显示恢复按钮 */}
                {reactProgress.progress.aborted && (
                  <button
                    onClick={() => {
                      const cmd = reactProgress.progress.command
                      reactProgress.reset()
                      chat.doSend(cmd, false)
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-500 dark:text-violet-400 text-xs font-medium transition-colors"
                  >
                    <RotateCcw size={12} />
                    恢复任务
                  </button>
                )}
                <div className="text-[11px] text-text-muted dark:text-slate-500 truncate font-mono">{reactProgress.progress.command}</div>
                {/* 步骤列表 - 可展开详情 */}
                <div className="space-y-1.5">
                  {reactProgress.progress.steps.map((step) => (
                    <ReactStepCard key={step.step} step={step} />
                  ))}
                  {!reactProgress.progress.done && (
                    <div className="flex items-center gap-2 text-[11px] text-text-faint dark:text-slate-600 pl-1">
                      <span className="flex gap-[2px]">{[0,1,2].map(i => <span key={i} className="w-1 h-1 rounded-full bg-purple-400 animate-pulse" style={{animationDelay: `${i*200}ms`}} />)}</span>
                      <span>思考中...</span>
                    </div>
                  )}
                </div>
                {/* 产物预览 */}
                {reactProgress.progress.done && reactProgress.progress.artifacts.length > 0 && (
                  <div className="border border-border-subtle/50 dark:border-white/[0.06] rounded-lg overflow-hidden">
                    <div className="text-[10px] text-text-muted dark:text-slate-400 font-medium px-3 py-1.5 bg-surface/50 dark:bg-white/[0.03]">产物</div>
                    {reactProgress.progress.artifacts.map((art, idx) => {
                      const ext = art.filePath.split('.').pop()?.toLowerCase()
                      const isHtml = ext === 'html' || ext === 'htm'
                      const isImage = ['png','jpg','jpeg','gif','svg','webp'].includes(ext || '')
                      if (isHtml) {
                        return <iframe key={idx} src={`http://localhost:8766/workspace/${art.filePath.split('/workspace/').pop() || art.filePath.split('/').pop()}`} className="w-full h-32 border-0 bg-white" title="预览" />
                      }
                      if (isImage) {
                        return <img key={idx} src={`http://localhost:8766/workspace/${art.filePath.split('/workspace/').pop() || art.filePath.split('/').pop()}`} className="w-full max-h-32 object-contain" alt="产物" />
                      }
                      return (
                        <div key={idx} className="px-3 py-1.5 text-[11px] text-text-muted dark:text-slate-500 flex items-center gap-2">
                          <Zap size={10} />{art.filePath.split('/').pop()}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 下方：Terminal / Muse Context / Browser（占据剩余空间） */}
          <div className={`relative min-h-0 ${reactProgress.progress.active && rightPanelMode === 'context' ? 'hidden' : 'flex-1'}`}>
            {/* Muse Context 面板 — 无活跃任务 + context 模式时显示 */}
            <div className={`absolute inset-0 overflow-y-auto scroll-dark ${rightPanelMode === 'context' && !reactProgress.progress.active ? '' : 'invisible'}`}>
              <div className="p-5 space-y-4">
                {/* 会话状态 */}
                <div className="bg-surface/50 dark:bg-white/[0.03] border border-border-subtle/50 dark:border-white/[0.06] rounded-xl p-4 space-y-3">
                  <div className="text-xs text-text-muted dark:text-slate-400 font-medium">当前会话</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted dark:text-slate-500">Token 消耗</span>
                    <span className="text-text-primary dark:text-white font-mono">{session.tokenStats.totalTokens > 0 ? `${(session.tokenStats.totalTokens / 1000).toFixed(1)}k` : '--'}</span>
                  </div>
                  {tokenMonitor.stats.totalCalls > 0 && (
                    <div className="pt-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] text-text-faint dark:text-slate-600">输入</span>
                        <div className="flex-1 h-[18px] flex items-end gap-[2px]">
                          {sparklineHeights.input.map((height, i) => (
                            <div key={i} className="flex-1 bg-indigo-500/40 rounded-sm" style={{ height: `${height}px` }} />
                          ))}
                        </div>
                        <span className="text-[10px] text-text-faint dark:text-slate-600">输出</span>
                        <div className="flex-1 h-[18px] flex items-end gap-[2px]">
                          {sparklineHeights.output.map((height, i) => (
                            <div key={i} className="flex-1 bg-emerald-500/40 rounded-sm" style={{ height: `${height}px` }} />
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-text-faint dark:text-slate-600">
                        <span>In: {(session.tokenStats.totalInputTokens / 1000).toFixed(1)}k</span>
                        <span>Out: {(session.tokenStats.totalOutputTokens / 1000).toFixed(1)}k</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted dark:text-slate-500">安全等级</span>
                    <span className={`font-mono ${session.safetyLevel === 'SECURE' ? 'text-emerald-500 dark:text-emerald-400' : session.safetyLevel === 'CAUTION' ? 'text-yellow-500 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>{session.safetyLevel}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted dark:text-slate-500">延迟</span>
                    <span className="text-text-primary dark:text-white font-mono">{session.latency > 0 ? `${session.latency}ms` : '--'}</span>
                  </div>
                </div>

                {/* 意图拦截 */}
                {session.tokenStats.intentIntercepted > 0 && (
                  <div className="bg-emerald-500/[0.08] dark:bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <ShieldCheck size={12} />
                      <span>智能拦截</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted dark:text-slate-500">拦截次数</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">{session.tokenStats.intentIntercepted}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted dark:text-slate-500">节省 Token</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">{session.tokenStats.tokensSavedByIntent > 1000 ? `${(session.tokenStats.tokensSavedByIntent / 1000).toFixed(1)}k` : session.tokenStats.tokensSavedByIntent}</span>
                    </div>
                  </div>
                )}

                {/* 快捷操作 */}
                <div className="bg-surface/50 dark:bg-white/[0.03] border border-border-subtle/50 dark:border-white/[0.06] rounded-xl p-4">
                  <div className="text-xs text-text-muted dark:text-slate-400 font-medium mb-3">快捷操作</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setInput('/self-check'); }} className="flex items-center gap-1.5 px-2.5 py-2 bg-surface/60 hover:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-border-subtle/50 dark:border-white/[0.06] rounded-lg text-[11px] text-text-secondary hover:text-text-primary dark:text-slate-400 dark:hover:text-white transition-all">
                      <Shield size={11} className="text-indigo-500 dark:text-indigo-400" />
                      <span>系统自检</span>
                    </button>
                    <button onClick={() => { setInput('/clear'); }} className="flex items-center gap-1.5 px-2.5 py-2 bg-surface/60 hover:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-border-subtle/50 dark:border-white/[0.06] rounded-lg text-[11px] text-text-secondary hover:text-text-primary dark:text-slate-400 dark:hover:text-white transition-all">
                      <Trash2 size={11} className="text-rose-500 dark:text-rose-400" />
                      <span>新会话</span>
                    </button>
                    <button onClick={() => handleSwitchMode('terminal')} className="flex items-center gap-1.5 px-2.5 py-2 bg-surface/60 hover:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-border-subtle/50 dark:border-white/[0.06] rounded-lg text-[11px] text-text-secondary hover:text-text-primary dark:text-slate-400 dark:hover:text-white transition-all">
                      <TerminalIcon size={11} className="text-emerald-500 dark:text-emerald-400" />
                      <span>终端</span>
                    </button>
                  </div>
                </div>

                {/* 工作区能力 */}
                {isElectron && (
                  <div className="bg-surface/50 dark:bg-white/[0.03] border border-border-subtle/50 dark:border-white/[0.06] rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-text-muted dark:text-slate-400 font-medium">工作区</div>
                      {workspaceEnv && workspaceEnv.type !== 'unknown' && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-400/20">
                          <Box size={9} />
                          {workspaceEnv.label}
                        </span>
                      )}
                    </div>

                    {/* 启动环境 — 仅当检测到可运行环境时显示 */}
                    {workspaceEnv?.runnable && workspaceEnv.startCommand && (
                      <button
                        onClick={handleStartEnv}
                        title={workspaceEnv.startCommand}
                        className="w-full flex items-center gap-2 px-3 py-2 mb-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-lg text-xs font-medium text-violet-600 dark:text-violet-300 transition-all active:scale-[0.98]"
                      >
                        <Play size={12} className="flex-shrink-0" />
                        <span>启动 {workspaceEnv.label} 环境</span>
                        <span className="ml-auto font-mono text-[10px] text-violet-500/60 dark:text-violet-400/50 truncate">{workspaceEnv.startCommand}</span>
                      </button>
                    )}

                    {/* 快捷脚本入口 */}
                    {workspaceEnv?.quickScripts && workspaceEnv.quickScripts.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] text-text-faint dark:text-slate-600 font-medium mb-1.5 uppercase tracking-wide">快捷启动</div>
                        <div className="space-y-1">
                          {workspaceEnv.quickScripts.slice(0, 6).map((script, idx) => (
                            <button
                              key={idx}
                              onClick={() => runEnvCommand(script.command)}
                              title={script.command}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-surface/40 hover:bg-emerald-500/10 dark:bg-white/[0.02] dark:hover:bg-emerald-500/10 border border-border-subtle/40 dark:border-white/[0.05] hover:border-emerald-500/30 rounded-lg text-[11px] text-text-muted hover:text-emerald-600 dark:text-slate-500 dark:hover:text-emerald-400 transition-all group"
                            >
                              <Play size={10} className="flex-shrink-0 text-text-faint group-hover:text-emerald-500 dark:text-slate-600 dark:group-hover:text-emerald-400 transition-colors" />
                              <span className="font-mono truncate">{script.name}</span>
                              <span className="ml-auto text-[9px] text-text-faint/60 dark:text-slate-700">{script.source}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 打开文件夹 + 用编辑器打开 */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleOpenFolder}
                        className="flex items-center gap-1.5 px-2.5 py-2 bg-surface/60 hover:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-border-subtle/50 dark:border-white/[0.06] rounded-lg text-[11px] text-text-secondary hover:text-text-primary dark:text-slate-400 dark:hover:text-white transition-all"
                      >
                        <FolderOpen size={11} className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
                        <span>打开文件夹</span>
                      </button>
                      {availableEditors[0] ? (
                        <button
                          onClick={() => handleOpenInEditor(availableEditors[0].id)}
                          title={`用 ${availableEditors[0].name} 打开`}
                          className="flex items-center gap-1.5 px-2.5 py-2 bg-surface/60 hover:bg-surface dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-border-subtle/50 dark:border-white/[0.06] rounded-lg text-[11px] text-text-secondary hover:text-text-primary dark:text-slate-400 dark:hover:text-white transition-all"
                        >
                          <Code2 size={11} className="text-sky-500 dark:text-sky-400 flex-shrink-0" />
                          <span className="truncate">{availableEditors[0].name}</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-2 border border-border-subtle/30 dark:border-white/[0.04] rounded-lg text-[11px] text-text-faint dark:text-slate-600">
                          <Code2 size={11} className="flex-shrink-0" />
                          <span>无编辑器</span>
                        </div>
                      )}
                    </div>

                    {/* 其余可用编辑器 */}
                    {availableEditors.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {availableEditors.slice(1).map((editor) => (
                          <button
                            key={editor.id}
                            onClick={() => handleOpenInEditor(editor.id)}
                            title={`用 ${editor.name} 打开`}
                            className="px-2 py-1 bg-surface/40 hover:bg-surface/70 dark:bg-white/[0.02] dark:hover:bg-white/[0.06] border border-border-subtle/40 dark:border-white/[0.05] rounded-md text-[10px] text-text-muted hover:text-text-secondary dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                          >
                            {editor.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 最近指令 */}
                {inputHistoryHook.inputHistory.length > 0 && (
                  <div className="bg-surface/50 dark:bg-white/[0.03] border border-border-subtle/50 dark:border-white/[0.06] rounded-xl p-4">
                    <div className="text-xs text-text-muted dark:text-slate-400 font-medium mb-2">最近指令</div>
                    <div className="space-y-1.5">
                      {inputHistoryHook.inputHistory.slice(0, 4).map((cmd, idx) => (
                        <button
                          key={idx}
                          onClick={() => setInput(cmd)}
                          className="w-full text-left px-2.5 py-1.5 bg-surface/40 hover:bg-surface/70 dark:bg-white/[0.02] dark:hover:bg-white/[0.06] rounded-lg text-[11px] text-text-muted hover:text-text-secondary dark:text-slate-500 dark:hover:text-slate-300 font-mono truncate transition-colors"
                        >
                          {cmd.length > 50 ? cmd.slice(0, 50) + '…' : cmd}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Files — 项目文件快速浏览 */}
            <div className={`absolute inset-0 overflow-y-auto scroll-dark ${rightPanelMode === 'files' ? '' : 'invisible'}`}>
              <FileBrowserPanel
                workspacePath={workspaceEnv ? undefined : undefined}
                isElectron={isElectron}
                onOpenFile={(filePath) => {
                  const api = (window as any).electronAPI
                  if (api?.shell?.showItemInFolder) api.shell.showItemInFolder(filePath)
                }}
              />
            </div>

            {/* Tasks — 任务队列面板 */}
            <div className={`absolute inset-0 ${rightPanelMode === 'tasks' ? '' : 'invisible'}`}>
              <TasksPanel />
            </div>

            {/* Terminal — 仅在用户主动切到终端 tab 时显示 */}
            <div className={`absolute inset-0 ${rightPanelMode === 'terminal' ? '' : 'invisible'}`}>
              {isElectron ? (
                <Terminal executeCommand={chat.commandToExecute} />
              ) : (
                <div className="flex items-center justify-center h-full text-text-muted dark:text-slate-500 text-sm">
                  <div className="text-center">
                    <TerminalIcon size={48} className="mx-auto mb-4 opacity-20" />
                    <p>终端功能仅在 Electron 环境中可用</p>
                    <p className="text-xs mt-2 opacity-60">请运行 <code className="bg-elevated dark:bg-slate-800 px-2 py-1 rounded">tnpm run dev</code></p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 状态仪表盘 - 终端模式显示 */}
        {isElectron && rightPanelMode === 'terminal' && (
          <div className="flex items-center justify-around px-6 py-2 bg-elevated/40 dark:bg-white/[0.02] border-t border-border-subtle/50 dark:border-white/[0.06]">
            <CpuStatusItem />
            <div className="w-px h-4 bg-terminal-border" />
            <StatusItem
              icon={<Zap size={11} />}
              label="TOKEN"
              value={session.tokenStats.totalCalls > 0
                ? session.tokenStats.totalTokens >= 1000
                  ? `${(session.tokenStats.totalTokens / 1000).toFixed(1)}k`
                  : `${session.tokenStats.totalTokens}`
                : '--'}
              color={session.tokenStats.totalCalls === 0 ? 'slate'
                : session.tokenStats.intentIntercepted > 0 ? 'green'
                : 'yellow'}
            />
            <div className="w-px h-4 bg-terminal-border" />
            <StatusItem
              icon={<ShieldCheck size={11} />}
              label="SAFE"
              value={session.safetyLevel}
              color={session.safetyLevel === 'SECURE' ? 'green' : session.safetyLevel === 'CAUTION' ? 'yellow' : 'red'}
            />
          </div>
        )}
      </div>
      </motion.div>
      )}
      </AnimatePresence>

      {/* 右侧常驻 Dock 图标栏 — 始终可见，点击切换/展开对应面板 */}
      <div className="flex-shrink-0 flex flex-col items-center gap-2 py-3 px-1.5 bg-surface/40 dark:bg-white/[0.02] border-l border-border-subtle/50 dark:border-white/[0.06]">
        {(() => {
          const dockItems: Array<{ mode: 'context' | 'terminal' | 'files' | 'tasks'; icon: React.ReactNode; label: string; activeClass: string }> = [
            { mode: 'context', icon: <Sparkles size={16} />, label: 'Muse', activeClass: 'bg-violet-500/20 text-violet-300 border-violet-400/30' },
            { mode: 'tasks', icon: <Clock size={16} />, label: '任务', activeClass: 'bg-orange-500/20 text-orange-300 border-orange-400/30' },
            { mode: 'files', icon: <FolderOpen size={16} />, label: '文件', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-400/30' },
            ...(isElectron ? [
              { mode: 'terminal' as const, icon: <TerminalIcon size={16} />, label: '终端', activeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' },
            ] : []),
          ]
          return dockItems.map((item) => {
            const isActive = rightPanelVisible && rightPanelMode === item.mode
            return (
              <button
                key={item.mode}
                onClick={() => {
                  // 已激活则收起，否则切换到该 mode 并展开
                  if (isActive) {
                    setRightPanelVisible(false)
                  } else {
                    handleSwitchMode(item.mode)
                  }
                }}
                title={item.label}
                className={`group relative flex items-center justify-center w-9 h-9 rounded-xl border transition-all ${
                  isActive
                    ? item.activeClass
                    : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface/60 dark:hover:bg-white/[0.06] dark:text-white/40 dark:hover:text-white/80'
                }`}
              >
                {item.icon}
                {isActive && (
                  <span className="absolute -left-[7px] top-1/2 -translate-y-1/2 w-1 h-5 rounded-full bg-current" />
                )}
              </button>
            )
          })
        })()}
      </div>
      </div>
      {/* 主内容区 flex row 闭合 */}

      {/* 任务状态已在对话流中体现，1v1 模式不再需要底部任务队列栏 */}
    </div>
  )
}

export default ChatPage

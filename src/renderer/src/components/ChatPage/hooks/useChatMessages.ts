import { useState, useEffect, useRef, useCallback } from 'react'
import type { Message, ImageAttachment, ChatRequestEnvelope } from '../types'
import { callAIStream } from '../utils'
import { useStreamHandler } from './useStreamHandler'
import { useCommandExecutor } from './useCommandExecutor'

interface UseChatMessagesOptions {
  isElectron: boolean
  sessionIdRef: React.MutableRefObject<string>
  setLatency: (v: number) => void
  setSafetyLevel: (v: 'SECURE' | 'CAUTION' | 'DANGER') => void
  resetSession: () => Promise<void>
  recordInput: (text: string) => void
}

export function useChatMessages(options: UseChatMessagesOptions) {
  const {
    isElectron,
    sessionIdRef,
    setLatency,
    setSafetyLevel,
    resetSession,
    recordInput
  } = options

  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingCommand, setPendingCommand] = useState<string>()
  const [commandToExecute, setCommandToExecute] = useState<string>()
  const [searchStatus, setSearchStatus] = useState<{ searching: boolean; keywords?: string; phase?: 'searching' | 'analyzing'; failed?: boolean }>({ searching: false })
  const [contextInfo, setContextInfo] = useState<{ mode: 'full' | 'light'; size: number; firstFullSize: number }>({ mode: 'full', size: 0, firstFullSize: 0 })
  const [contextStats, setContextStats] = useState<{
    baseLength: number
    baseTokens: number
    incrementalLength: number
    incrementalTokens: number
    totalLength: number
    totalTokens: number
    roundCount: number
    breakdown: Record<string, number>
  }>({ baseLength: 0, baseTokens: 0, incrementalLength: 0, incrementalTokens: 0, totalLength: 0, totalTokens: 0, roundCount: 0, breakdown: {} })
  const [deletedMessage, setDeletedMessage] = useState<{ message: Message; index: number } | null>(null)
  const [taskActionNotice, setTaskActionNotice] = useState<{ state: 'pending' | 'success' | 'error'; message: string } | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const commitMessageDeletion = useCallback(async (messageId: string) => {
    if (!isElectron || (!messageId.startsWith('hist-ai-') && !messageId.startsWith('hist-user-'))) return
    try {
      const historyId = messageId.replace(/^hist-(?:ai|user)-/, '')
      await window.electronAPI!.db.history.delete(historyId)
    } catch (error) {
      console.error('[deleteMessage] 删除历史记录失败:', error)
    }
  }, [isElectron])

  const deleteMessage = useCallback((messageId: string) => {
    setMessages(prev => {
      const index = prev.findIndex(message => message.id === messageId)
      if (index < 0) return prev
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      const message = prev[index]
      setDeletedMessage({ message, index })
      deleteTimerRef.current = setTimeout(() => {
        commitMessageDeletion(message.id)
        setDeletedMessage(null)
      }, 5000)
      return prev.filter(item => item.id !== messageId)
    })
  }, [commitMessageDeletion])

  const undoDeleteMessage = useCallback(() => {
    if (!deletedMessage) return
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    setMessages(prev => {
      const next = [...prev]
      next.splice(Math.min(deletedMessage.index, next.length), 0, deletedMessage.message)
      return next
    })
    setDeletedMessage(null)
  }, [deletedMessage])

  useEffect(() => () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
  }, [])

  useEffect(() => {
    if (!taskActionNotice || taskActionNotice.state === 'pending') return
    const timer = setTimeout(() => setTaskActionNotice(null), 3500)
    return () => clearTimeout(timer)
  }, [taskActionNotice])

  // 滚动锚定已迁移至 ChatPage 中的 react-virtuoso（followOutput + atBottomStateChange）
  // 这里不再维护 scrollRef / userScrolledUpRef / 自动 scrollIntoView

  // 流式消息处理
  const {
    isStreaming,
    setIsStreaming,
    streamingMsgIdRef,
    streamCallStartTimeRef,
    lastUserMessageRef,
    flushedContentRef,
    stopGeneration
  } = useStreamHandler({
    setMessages,
    setLoading,
    setLatency,
    setPendingCommand,
    setContextInfo
  })

  // 命令执行
  const {
    executeCommand,
    executeScript,
    executeSpecificCommand,
    confirmTaskAction
  } = useCommandExecutor({
    messages,
    setMessages,
    loading,
    setLoading,
    pendingCommand,
    setPendingCommand,
    commandToExecute,
    setCommandToExecute,
    setSafetyLevel
  })

  // 监听搜索状态事件
  useEffect(() => {
    if (!window.electronAPI) return
    const cleanup = window.electronAPI.ai.onSearchStatus((status) => {
      setSearchStatus(status)
      if (status.failed) {
        setTimeout(() => setSearchStatus({ searching: false }), 3000)
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.task) return
    const cleanups = [
      window.electronAPI.task.onComplete((data: any) => {
        if (!data.taskId) return
        setMessages(prev => prev.map(message =>
          message.taskProgressData?.taskId === data.taskId
            ? { ...message, taskProgressData: { ...message.taskProgressData, status: 'completed', currentStep: message.taskProgressData.totalSteps } }
            : message
        ))
      }),
      window.electronAPI.task.onError((data: any) => {
        if (!data.taskId) return
        setMessages(prev => prev.map(message =>
          message.taskProgressData?.taskId === data.taskId
            ? { ...message, taskProgressData: { ...message.taskProgressData, status: 'error', pauseError: data.error } }
            : message
        ))
      })
    ]
    return () => cleanups.forEach(cleanup => cleanup?.())
  }, [])

  // 监听上下文长度统计
  useEffect(() => {
    if (!window.electronAPI?.context?.onStats) return
    const cleanup = window.electronAPI.context.onStats((stats: any) => {
      setContextStats(stats)
    })
    return cleanup
  }, [])


  // 监听任务暂停事件
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.task) return
    const cleanup = window.electronAPI.task.onPaused((data: any) => {
      console.log('[useChatMessages] 任务已暂停:', data)
      // 更新消息中的任务状态
      setMessages(prev => prev.map(msg => {
        if (msg.type === 'task_progress' && msg.taskProgressData?.taskId === data.taskId) {
          return {
            ...msg,
            taskProgressData: {
              ...msg.taskProgressData,
              status: 'paused',
              pauseReason: 'manual'
            }
          } as Message
        }
        return msg
      }))
    })
    return cleanup
  }, [])


  // ========== 监听脚本子进程执行事件 ==========
  // 按 scriptId 精确更新 script 类型消息的 execStatus
  const updateScriptMessage = useCallback((scriptId: string, updater: (scriptData: NonNullable<Message['scriptData']>) => Partial<NonNullable<Message['scriptData']>>) => {
    setMessages(prev => {
      // 从后往前找 scriptId 匹配的消息
      const lastIndex = [...prev].reverse().findIndex(m => m.type === 'script' && m.scriptData && m.scriptData.filename === scriptId)
      if (lastIndex === -1) return prev
      const targetIndex = prev.length - 1 - lastIndex
      const target = prev[targetIndex]
      if (!target.scriptData) return prev

      const updated = { ...target, scriptData: { ...target.scriptData, ...updater(target.scriptData) } }
      return [...prev.slice(0, targetIndex), updated, ...prev.slice(targetIndex + 1)]
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.script) return
    const cleanups: Array<() => void> = []

    cleanups.push(window.electronAPI.script.onExecuting((data: any) => {
      console.log('[useChatMessages] 脚本开始执行:', data.filename)
      const scriptId = data.scriptId || data.filename
      updateScriptMessage(scriptId, () => ({
        execStatus: 'executing' as const,
        retryCount: data.retryCount
      }))
    }))

    cleanups.push(window.electronAPI.script.onComplete((data: any) => {
      console.log('[useChatMessages] 脚本执行完成:', data.filename)
      const scriptId = data.scriptId || data.filename
      updateScriptMessage(scriptId, () => ({
        execStatus: 'completed' as const,
        execResult: { stdout: data.stdout, exitCode: data.exitCode },
        snapshot: data.snapshot || null
      }))
    }))

    cleanups.push(window.electronAPI.script.onError((data: any) => {
      console.log('[useChatMessages] 脚本执行失败:', data.filename, data.error)
      if (!data.willRetry) {
        const scriptId = data.scriptId || data.filename
        updateScriptMessage(scriptId, () => ({
          execStatus: 'failed' as const,
          execResult: { error: data.error, stderr: data.stderr }
        }))
      }
    }))

    cleanups.push(window.electronAPI.script.onRetrying((data: any) => {
      console.log('[useChatMessages] AI 修复重试:', data.retryCount, '/', data.maxRetries)
      const scriptId = data.scriptId || data.filename
      updateScriptMessage(scriptId, () => ({
        execStatus: 'retrying' as const,
        retryCount: data.retryCount,
        maxRetries: data.maxRetries
      }))
    }))

    cleanups.push(window.electronAPI.script.onNeedAuth((data: any) => {
      console.log('[useChatMessages] 脚本需要授权:', data.filename, data.reason)
      const scriptId = data.scriptId || data.filename
      updateScriptMessage(scriptId, () => ({
        execStatus: 'needAuth' as const,
        dangerReason: data.reason,
        authId: data.authId
      } as any))
    }))

    if (window.electronAPI.script.onFollowUp) {
      cleanups.push(window.electronAPI.script.onFollowUp((data: any) => {
        console.log('[useChatMessages] 脚本后续执行:', data.description, data.message)
        const scriptId = data.scriptId || data.filename
        updateScriptMessage(scriptId, () => ({
          execStatus: 'followUp' as const,
          followUpMessage: data.message
        } as any))
      }))
    }

    return () => cleanups.forEach(fn => fn())
  }, [updateScriptMessage])

  // 核心发送逻辑（支持重试）
  const doSend = useCallback(async (userMessage: string, isRetry = false, quotedContent?: string, quotedMessage?: Message, images?: ImageAttachment[], retryEnvelope?: ChatRequestEnvelope) => {
    if ((!userMessage.trim() && (!images || images.length === 0)) || loading) return

    const envelope: ChatRequestEnvelope = retryEnvelope || {
      text: userMessage,
      quote: quotedContent && quotedMessage ? {
        messageId: quotedMessage.id,
        role: quotedMessage.role,
        selectedText: quotedContent,
      } : undefined,
      images: images && images.length > 0 ? images : undefined,
    }
    userMessage = envelope.text
    quotedContent = envelope.quote?.selectedText
    images = envelope.images

    if (!isRetry) {
      const userMsg: Message = { 
        id: `user-${Date.now()}`, 
        role: 'user', 
        content: userMessage, 
        images: images && images.length > 0 ? images : undefined,
        timestamp: Date.now()
      }
      
      // 如果有引用消息，保存引用信息
      if (envelope.quote) {
        const summary = envelope.quote.selectedText.length > 100 ? envelope.quote.selectedText.slice(0, 100) + '...' : envelope.quote.selectedText
        userMsg.quotedMessage = {
          messageId: envelope.quote.messageId,
          role: envelope.quote.role,
          summary
        }
      }
      
      setMessages(prev => [...prev, userMsg])
      recordInput(userMessage)
    }

    setLoading(true)

    try {
      let question = userMessage
      if (quotedContent) {
        const boundedQuote = quotedContent.slice(0, 8000)
        question = `<quoted_context message_id="${envelope.quote?.messageId || ''}">\n${boundedQuote}\n</quoted_context>\n\n${userMessage}`
      }
      
      const aiMsgId = `ai-stream-${Date.now()}`
      streamingMsgIdRef.current = aiMsgId
      flushedContentRef.current = ''
      streamCallStartTimeRef.current = Date.now()
      lastUserMessageRef.current = userMessage

      const streamingMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: '',
        type: 'text'
      }
      setMessages(prev => [...prev, streamingMsg])
      setIsStreaming(true)

      // 提取当前已有的对话 messages（过滤掉非文本类型）
      const existingMessages = messages
        .filter(m => m.type === 'text' && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      callAIStream(
        question,
        sessionIdRef.current,
        undefined,
        existingMessages,
        images && images.length > 0 ? images : undefined
      )
    } catch (error: any) {
      const errorMsg: Message = {
        id: `error-${Date.now()}`, role: 'assistant',
        content: `❌ 调用失败：${error.message}`,
        type: 'error',
        retryUserInput: userMessage,
        retryRequest: envelope,
      }
      setMessages(prev => [...prev, errorMsg])
      setLoading(false)
    }
  }, [loading])

  const handleRetry = (request: string | ChatRequestEnvelope) => {
    const envelope = typeof request === 'string' ? { text: request } : request
    doSend(envelope.text, true, undefined, undefined, envelope.images, envelope)
  }

  const handleClearChat = async () => {
    if (messages.length === 0) return
    if (confirm('确定要开始新会话吗？当前对话会保留在历史记录中。')) {
      localStorage.setItem('chatClearedAt', String(Date.now()))
      setMessages([])
      window.dispatchEvent(new Event('muse:new-session'))
      setContextStats(prev => ({
        ...prev,
        incrementalLength: 0,
        incrementalTokens: 0,
        totalLength: prev.baseLength,
        totalTokens: prev.baseTokens,
        roundCount: 0,
      }))
      await resetSession()
    }
  }

  const handleClearTerminal = () => {
    setCommandToExecute('clear')
    setTimeout(() => setCommandToExecute(undefined), 100)
  }

  // 分析终端执行结果
  const analyzeTerminalOutput = useCallback(async () => {
    if (loading || !window.electronAPI) return

    try {
      const { output } = await window.electronAPI.terminal.getRecentOutput(5000)
      
      if (!output || !output.trim()) {
        const noOutputMsg: Message = {
          id: `analyze-empty-${Date.now()}`,
          role: 'assistant',
          content: '终端暂无输出内容可供分析。',
          type: 'text'
        }
        setMessages(prev => [...prev, noOutputMsg])
        return
      }

      const userMsg: Message = {
        id: `user-analyze-${Date.now()}`,
        role: 'user',
        content: '📊 分析终端执行结果',
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, userMsg])
      
      setLoading(true)

      const analyzePrompt = `用户刚在终端执行了命令，以下是终端最近的输出内容。请分析执行结果：
- 如果执行成功且输出正常，简要确认即可（一两句话）
- 如果有错误或异常，分析原因并给出修复建议
- 如果输出包含命令提示符等无关内容，忽略它们，只关注有意义的执行结果

终端输出：
\`\`\`
${output.trim()}
\`\`\``

      const aiMsgId = `ai-analyze-${Date.now()}`
      streamingMsgIdRef.current = aiMsgId
      flushedContentRef.current = ''
      streamCallStartTimeRef.current = Date.now()
      lastUserMessageRef.current = '分析终端执行结果'

      const streamingMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: '',
        type: 'text'
      }
      setMessages(prev => [...prev, streamingMsg])
      setIsStreaming(true)

      callAIStream(
        analyzePrompt,
        sessionIdRef.current
      )
    } catch (error: any) {
      console.error('分析终端输出失败:', error)
      const errorMsg: Message = {
        id: `analyze-error-${Date.now()}`,
        role: 'assistant',
        content: `❌ 分析失败：${error.message}`,
        type: 'error'
      }
      setMessages(prev => [...prev, errorMsg])
      setLoading(false)
    }
  }, [loading, sessionIdRef])

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    isStreaming,
    searchStatus,
    contextInfo,
    contextStats,
    commandToExecute,
    setCommandToExecute,
    doSend,
    handleRetry,
    executeCommand,
    executeScript,
    executeSpecificCommand,
    confirmTaskAction,
    deleteMessage,
    deletedMessage,
    undoDeleteMessage,
    handleClearChat,
    handleClearTerminal,
    analyzeTerminalOutput,
    stopGeneration,
    updateMessage: (messageId: string, updater: (msg: Message) => Message) => {
      setMessages(prev => prev.map(msg => msg.id === messageId ? updater(msg) : msg))
    },
    handleRichFormSubmit: (messageId: string, values: Record<string, any> | null) => {
      if (!values) {
        setMessages(prev => prev.map(msg =>
          msg.id === messageId ? { ...msg, type: 'text' as const } : msg
        ))
        return
      }

      // 从当前消息列表里拿 richFormData，构建 prompt
      let prompt = ''
      setMessages(prev => {
        const targetMsg = prev.find(m => m.id === messageId)
        if (!targetMsg?.richFormData) return prev

        const { title, fields, submitPrompt } = targetMsg.richFormData

        const fieldLines = fields.map(f => {
          const raw = values[f.id]
          if (raw === undefined || raw === null || raw === '') return null
          let display: string
          if (f.type === 'multi_select' && Array.isArray(raw)) {
            display = raw.map((v: string) => f.options?.find(o => o.value === v)?.label || v).join('、')
          } else if ((f.type === 'select' || f.type === 'radio') && f.options) {
            display = f.options.find(o => o.value === raw)?.label || raw
          } else if (f.type === 'date_range' && raw?.start && raw?.end) {
            display = `${raw.start} → ${raw.end}`
          } else if (f.type === 'image_upload') {
            display = raw ? '[已上传图片]' : ''
          } else {
            display = String(raw)
          }
          return display ? `- ${f.label}：${display}` : null
        }).filter(Boolean) as string[]

        prompt = `${submitPrompt || '用户填写了表单'}「${title}」：\n${fieldLines.join('\n')}`

        // 把表单卡片消息变回普通文本，同时追加用户提交消息
        const userMsgId = `user-form-${Date.now()}`
        return [
          ...prev.map(m => m.id === messageId ? { ...m, type: 'text' as const } : m),
          { id: userMsgId, role: 'user' as const, content: prompt, timestamp: Date.now() }
        ]
      })

      // 在 setMessages 外部异步发给 AI（避免 updater 内副作用导致死循环）
      if (prompt) {
        setTimeout(() => doSend(prompt, true), 0)
      }
    },
    pauseTask: async (taskId: string) => {
      const currentTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)
      
      if (!currentTaskMsg || !currentTaskMsg.taskProgressData?.taskId) {
        console.log('[pauseTask] 没有找到正在执行的任务')
        return
      }
      
      console.log('[pauseTask] 暂停任务:', taskId)
      
      try {
        setTaskActionNotice({ state: 'pending', message: '正在等待任务到达安全暂停点…' })
        await window.electronAPI!.task.pause({ taskId })
        // 更新 UI 状态
        setMessages(prev => prev.map(msg => {
          if (msg.id === currentTaskMsg.id && msg.taskProgressData) {
            return {
              ...msg,
              taskProgressData: {
                ...msg.taskProgressData,
                status: 'paused',
                pauseReason: 'manual'
              }
            } as Message
          }
          return msg
        }))
        setTaskActionNotice({ state: 'success', message: '任务已暂停' })
      } catch (error) {
        console.error('[pauseTask] 暂停失败:', error)
        setTaskActionNotice({ state: 'error', message: `暂停失败：${error instanceof Error ? error.message : String(error)}` })
      }
    },
    resumeTask: async (taskId: string, modifiedSteps?: any[]) => {
      const pausedTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)
      
      if (!pausedTaskMsg || !pausedTaskMsg.taskProgressData?.taskId) {
        console.log('[resumeTask] 没有找到暂停的任务')
        return
      }
      
      console.log('[resumeTask] 恢复任务:', taskId, modifiedSteps ? '(带修改步骤)' : '')
      
      try {
        setTaskActionNotice({ state: 'pending', message: '正在恢复任务…' })
        setLoading(true)
        await window.electronAPI!.task.resume({ taskId, modifiedSteps })
        // 更新 UI 状态
        setMessages(prev => prev.map(msg => {
          if (msg.id === pausedTaskMsg.id && msg.taskProgressData) {
            return {
              ...msg,
              taskProgressData: {
                ...msg.taskProgressData,
                status: 'running'
              }
            } as Message
          }
          return msg
        }))
        setTaskActionNotice({ state: 'success', message: '任务已恢复执行' })
      } catch (error) {
        console.error('[resumeTask] 恢复失败:', error)
        setTaskActionNotice({ state: 'error', message: `恢复失败：${error instanceof Error ? error.message : String(error)}` })
      } finally {
        setLoading(false)
      }
    },
    retryTask: async (taskId: string, modifiedStep?: any) => {
      const errorTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)

      if (!errorTaskMsg || !errorTaskMsg.taskProgressData?.taskId) {
        console.log('[retryTask] 没有找到错误暂停的任务')
        return
      }

      console.log('[retryTask] 重试任务:', taskId, modifiedStep ? '(带修改步骤)' : '')

      try {
        setTaskActionNotice({ state: 'pending', message: '正在重新执行失败步骤…' })
        setLoading(true)
        // 使用 resume API，传递修改后的步骤
        await window.electronAPI!.task.resume({ taskId, modifiedSteps: modifiedStep ? [modifiedStep] : undefined })
        // 更新 UI 状态
        setMessages(prev => prev.map(msg => {
          if (msg.id === errorTaskMsg.id && msg.taskProgressData) {
            return {
              ...msg,
              taskProgressData: {
                ...msg.taskProgressData,
                status: 'running',
                pauseReason: undefined,
                pauseError: undefined
              }
            } as Message
          }
          return msg
        }))
        setTaskActionNotice({ state: 'success', message: '已开始重试' })
      } catch (error) {
        console.error('[retryTask] 重试失败:', error)
        setTaskActionNotice({ state: 'error', message: `重试失败：${error instanceof Error ? error.message : String(error)}` })
      } finally {
        setLoading(false)
      }
    },
    skipStep: async (taskId: string) => {
      const errorTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)

      if (!errorTaskMsg || !errorTaskMsg.taskProgressData?.taskId) {
        console.log('[skipStep] 没有找到错误暂停的任务')
        return
      }

      const currentStepIndex = errorTaskMsg.taskProgressData.currentStep - 1
      const failedStep = errorTaskMsg.taskProgressData.steps[currentStepIndex]

      if (!failedStep) {
        console.log('[skipStep] 没有找到失败步骤')
        return
      }

      console.log('[skipStep] 跳过步骤:', failedStep.id, failedStep.description)

      try {
        setTaskActionNotice({ state: 'pending', message: '正在跳过失败步骤…' })
        setLoading(true)
        // 修改步骤，添加 onError: 'skip' 标记，然后继续执行
        const modifiedStep = {
          ...failedStep,
          onError: 'skip'
        }
        await window.electronAPI!.task.resume({ taskId, modifiedSteps: [modifiedStep] })
        // 更新 UI 状态
        setMessages(prev => prev.map(msg => {
          if (msg.id === errorTaskMsg.id && msg.taskProgressData) {
            return {
              ...msg,
              taskProgressData: {
                ...msg.taskProgressData,
                status: 'running',
                pauseReason: undefined,
                pauseError: undefined,
                steps: msg.taskProgressData.steps.map((s: any, i: number) =>
                  i === currentStepIndex ? modifiedStep : s
                )
              }
            } as Message
          }
          return msg
        }))
        setTaskActionNotice({ state: 'success', message: '已跳过失败步骤并继续' })
      } catch (error) {
        console.error('[skipStep] 跳过步骤失败:', error)
        setTaskActionNotice({ state: 'error', message: `跳过失败：${error instanceof Error ? error.message : String(error)}` })
      } finally {
        setLoading(false)
      }
    },
    analyzeError: async (taskId: string) => {
      const errorTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)

      if (!errorTaskMsg || !errorTaskMsg.taskProgressData?.taskId) {
        console.log('[analyzeError] 没有找到错误暂停的任务')
        return
      }

      const currentStepIndex = errorTaskMsg.taskProgressData.currentStep - 1
      const failedStep = errorTaskMsg.taskProgressData.steps[currentStepIndex]
      const pauseError = errorTaskMsg.taskProgressData.pauseError

      if (!failedStep) {
        console.log('[analyzeError] 没有找到失败步骤')
        return
      }

      console.log('[analyzeError] 让 AI 分析错误:', pauseError)

      try {
        setTaskActionNotice({ state: 'pending', message: '正在取消任务…' })
        setLoading(true)
        // 向 AI 询问如何修复错误，将结果作为新的步骤描述或参数
        const result = await callAIStream(
          `任务执行失败，请分析错误原因并提供解决方案：\n\n步骤描述：${failedStep.description}\n步骤参数：${JSON.stringify(failedStep.params)}\n错误信息：${pauseError}\n\n请提供修复建议（简洁明了，不超过100字）：`,
          { empId: undefined, sessionId: sessionIdRef.current }
        )

        let analysis = ''
        for await (const { content, streamEnd } of result) {
          analysis = content
          if (streamEnd) break
        }

        console.log('[analyzeError] AI 分析结果:', analysis)

        // 将 AI 的建议添加为新消息
        const analysisMsg: Message = {
          id: `error-analysis-${Date.now()}`,
          role: 'assistant',
          content: `🔍 错误分析：\n${analysis}`,
          type: 'text'
        }
        setMessages(prev => [...prev, analysisMsg])

        // 可选：自动更新步骤描述（这里暂时不做，让用户手动编辑）
      } catch (error) {
        console.error('[analyzeError] AI 分析失败:', error)
        setMessages(prev => [...prev, {
          id: `error-analysis-fail-${Date.now()}`,
          role: 'assistant',
          content: '抱歉，AI 分析失败，请手动检查错误。',
          type: 'text'
        }])
      } finally {
        setLoading(false)
        setTaskActionNotice({ state: 'success', message: '任务已取消' })
      }
    },
    interveneTask: async (taskId: string, message: string) => {
      const currentTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)
      if (!currentTaskMsg?.taskProgressData?.taskId) {
        console.log('[interveneTask] 没有找到正在执行的任务')
        return
      }
      console.log('[interveneTask] 干预任务:', taskId, '指令:', message)

      const interventionId = `intervene-${Date.now()}`
      setMessages(prev => [...prev, {
        id: interventionId,
        role: 'user' as const,
        content: `干预正在送达：${message}`,
        type: 'text' as const
      }])

      try {
        const result = await window.electronAPI!.task.intervene({ taskId, message })
        if (!result?.success) throw new Error(result?.error || '干预未被任务引擎接受')
        setMessages(prev => prev.map(m => m.id === interventionId ? { ...m, content: `干预已应用：${message}` } : m))
        return { success: true }
      } catch (error) {
        console.error('[interveneTask] 干预失败:', error)
        const errorText = error instanceof Error ? error.message : String(error)
        setMessages(prev => prev.map(m => m.id === interventionId ? { ...m, content: `干预未送达：${message}\n\n${errorText}`, type: 'error' as const } : m))
        return { success: false, error: errorText }
      }
    },
    cancelTask: async (taskId: string) => {
      const activeTaskMsg = messages.find(m => m.type === 'task_progress' && m.taskProgressData?.taskId === taskId)

      if (!activeTaskMsg || !activeTaskMsg.taskProgressData?.taskId) {
        console.log('[cancelTask] 没有找到可取消的任务')
        return
      }

      console.log('[cancelTask] 取消任务:', taskId, '当前状态:', activeTaskMsg.taskProgressData.status)

      try {
        await window.electronAPI!.task.cancel({ taskId })
        // 更新 UI 状态为已取消
        setMessages(prev => prev.map(msg => {
          if (msg.id === activeTaskMsg.id && msg.taskProgressData) {
            return {
              ...msg,
              taskProgressData: {
                ...msg.taskProgressData,
                status: 'error',
                pauseReason: undefined,
                pauseError: '任务已取消'
              }
            } as Message
          }
          return msg
        }))
        setLoading(false)
        console.log('[cancelTask] 取消成功')
      } catch (error) {
        console.error('[cancelTask] 取消失败:', error)
        setTaskActionNotice({ state: 'error', message: `取消失败：${error instanceof Error ? error.message : String(error)}` })
      }
    },
    taskActionNotice,
    dismissTaskActionNotice: () => setTaskActionNotice(null)
  }
}

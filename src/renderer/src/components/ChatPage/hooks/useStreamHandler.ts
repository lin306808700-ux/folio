import { useState, useEffect, useRef } from 'react'
import type { Message } from '../types'
import { detectCommand } from '../utils'
import { parseSkillInstall, parseSkillSave, parseSkillUpdate, parseCommandOptions, parseRichForm, parseArtifact } from './response-parser'

// 句末标点（中英）— 刷到这些时给一个呼吸停顿
const SENTENCE_END = /[。！？.!?；;]\s*$/
// 句中停顿标点 — 给一个更短的停顿
const CLAUSE_PAUSE = /[，、,]\s*$/

// 流式中可识别的协议标记 — 一旦命中任意标记，立即切「正在生成 XX…」折叠态。
// kind 与 Message.protocolStreaming.kind 对应，label 为状态条文案。
const PROTOCOL_MARKERS: Array<{
  marker: string
  kind: 'artifact' | 'rich_form' | 'script' | 'command_options' | 'muse_task'
  label: string
}> = [
  { marker: 'ARTIFACT:', kind: 'artifact', label: '正在生成内容…' },
  { marker: 'RICH_FORM:', kind: 'rich_form', label: '正在生成表单…' },
  { marker: 'SCRIPT_BLOCK:', kind: 'script', label: '正在生成脚本…' },
  { marker: 'COMMAND_OPTIONS:', kind: 'command_options', label: '正在生成选项…' },
  { marker: 'MUSE_TASK:', kind: 'muse_task', label: '正在紧张处理中…' },
]

// 协议标记前缀的「半截」匹配 — 用于判断 buffer 末尾是否可能是尚未到齐的协议标记，
// 命中则暂缓打字机消费，避免标记被部分 flush 导致后续整体匹配失败。
const PENDING_PROTOCOL_PREFIX = /(?:A(?:R(?:T(?:I(?:F(?:A(?:C(?:T)?)?)?)?)?)?)?|R(?:I(?:C(?:H(?:_(?:F(?:O(?:R(?:M)?)?)?)?)?)?)?)?|S(?:C(?:R(?:I(?:P(?:T(?:_(?:B(?:L(?:O(?:C(?:K)?)?)?)?)?)?)?)?)?)?)?|C(?:O(?:M(?:M(?:A(?:N(?:D(?:_(?:O(?:P(?:T(?:I(?:O(?:N(?:S)?)?)?)?)?)?)?)?)?)?)?)?)?)?|M(?:U(?:S(?:E(?:_(?:T(?:A(?:S(?:K)?)?)?)?)?)?)?)?)\s*$/

/**
 * 根据刚刷出的片段和剩余 buffer 长度，决定打字节奏停顿时长（ms）。
 * buffer 积压时（在追赶）返回 0 不停顿，保证流畅不卡。
 */
function getRhythmPause(slice: string, remainingBufferLength: number): number {
  if (remainingBufferLength > 200) return 0
  if (SENTENCE_END.test(slice)) return 220
  if (CLAUSE_PAUSE.test(slice)) return 90
  return 0
}

interface UseStreamHandlerOptions {
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  setLatency: (v: number) => void
  setPendingCommand: React.Dispatch<React.SetStateAction<string | undefined>>
  refreshSkills: () => void
  setContextInfo: React.Dispatch<React.SetStateAction<{ mode: 'full' | 'light'; size: number; firstFullSize: number }>>
  skillEditMode?: { id: string; name: string; content: string; description?: string; isNew?: boolean } | null
  setSkillEditMode?: (s: any) => void
}

export function useStreamHandler(options: UseStreamHandlerOptions) {
  const {
    setMessages,
    setLoading,
    setLatency,
    setPendingCommand,
    refreshSkills,
    setContextInfo,
    skillEditMode,
    setSkillEditMode
  } = options

  const [isStreaming, setIsStreaming] = useState(false)

  // 流式消息的引用
  const streamingMsgIdRef = useRef<string | null>(null)
  const streamCallStartTimeRef = useRef<number>(0)
  const lastUserMessageRef = useRef<string>('')

  // 打字机 buffer：收到的文本先入队，定时逐段刷到 UI
  const typewriterBufferRef = useRef<string>('')
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typewriterActiveRef = useRef(false)
  // 累积已刷出到 UI 的全部流式内容（用于 onStreamEnd 时同步读取，避免 React 批量更新竞争）
  const flushedContentRef = useRef<string>('')
  // 是否已检测到协议指令（用于抑制打字机渲染，避免原文显示在气泡里）
  const isMuseTaskDetectedRef = useRef(false)
  // 协议折叠态下持续累积的原文 draft（供状态条展开查看）
  const protocolDraftRef = useRef('')

  const startTypewriter = () => {
    if (typewriterTimerRef.current) return
    typewriterActiveRef.current = true

    const tick = () => {
      if (!typewriterActiveRef.current && !typewriterBufferRef.current) {
        typewriterTimerRef.current = null
        return
      }

      const buf = typewriterBufferRef.current
      if (!buf) {
        if (!typewriterActiveRef.current) {
          typewriterTimerRef.current = null
          return
        }
        typewriterTimerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>
        return
      }

      const bufLen = buf.length
      let charsPerTick: number
      if (bufLen > 1000) {
        charsPerTick = 100
      } else if (bufLen > 500) {
        charsPerTick = 50
      } else if (bufLen > 200) {
        charsPerTick = 25
      } else if (bufLen > 50) {
        charsPerTick = 12
      } else {
        charsPerTick = 6
      }
      const slice = buf.slice(0, charsPerTick)
      typewriterBufferRef.current = buf.slice(charsPerTick)
      flushedContentRef.current += slice

      const msgId = streamingMsgIdRef.current
      if (msgId) {
        setMessages(prev => prev.map(msg => {
          if (msg.id !== msgId) return msg
          const prevContent = msg.isThinking ? '' : (msg.content || '')
          return { ...msg, content: prevContent + slice, isThinking: false }
        }))
      }

      // 节奏停顿：刚刷出的片段以句末标点结尾、且 buffer 未积压（<200，没在追赶）时，
      // 短暂停顿一下再继续，模拟真人说完一句话的呼吸感。buffer 积压时不停顿，保证不卡。
      const pauseMs = getRhythmPause(slice, typewriterBufferRef.current.length)
      if (pauseMs > 0) {
        typewriterTimerRef.current = setTimeout(() => {
          typewriterTimerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>
        }, pauseMs)
        return
      }

      typewriterTimerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>
    }

    typewriterTimerRef.current = requestAnimationFrame(tick) as unknown as ReturnType<typeof setInterval>
  }

  const stopTypewriter = () => {
    typewriterActiveRef.current = false
    // 将剩余 buffer 累积到 flushedContentRef（同步可读）并 flush 到 UI
    const remaining = typewriterBufferRef.current
    if (remaining) {
      flushedContentRef.current += remaining
      typewriterBufferRef.current = ''
      const msgId = streamingMsgIdRef.current
      if (msgId) {
        setMessages(prev => prev.map(msg => {
          if (msg.id !== msgId) return msg
          const prevContent = msg.isThinking ? '' : (msg.content || '')
          return { ...msg, content: prevContent + remaining, isThinking: false }
        }))
      }
    }
    if (typewriterTimerRef.current) {
      cancelAnimationFrame(typewriterTimerRef.current as unknown as number)
      typewriterTimerRef.current = null
    }
  }

  // 协议折叠态下：把后续 chunk 累积进 draft，并实时刷新状态条可展开的原文
  const appendProtocolDraft = (chunk: string) => {
    protocolDraftRef.current += chunk
    const msgId = streamingMsgIdRef.current
    if (!msgId) return
    const draft = protocolDraftRef.current
    setMessages(prev => prev.map(msg =>
      msg.id === msgId && msg.protocolStreaming
        ? { ...msg, protocolStreaming: { ...msg.protocolStreaming, draft } }
        : msg
    ))
  }

  // 监听流式 chunk 和 end 事件
  useEffect(() => {
    if (!window.electronAPI) return

    const cleanupChunk = window.electronAPI.ai.onStreamChunk(({ chunk, sessionId, thinking }) => {
      const msgId = streamingMsgIdRef.current
      if (!msgId) return

      console.log(`[Stream] 📥 chunk: len=${chunk?.length || 0}, thinking=${!!thinking}, bufLen=${typewriterBufferRef.current.length}`)

      if (thinking) {
        // 不写入死板文本：保持 content 为空并标记 isThinking，
        // 让渲染层回退到富有灵性的 ThinkingAnimation（阶段轮播 + 呼吸光带），
        // 一旦正文 chunk 到达就会自然覆盖。
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: msg.content && !msg.isThinking ? msg.content : '', isThinking: true }
            : msg
        ))
        return
      }

      // 如果已检测到协议指令，停止原文渲染，但继续累积原文 draft 供折叠态展开
      if (isMuseTaskDetectedRef.current) {
        appendProtocolDraft(chunk)
        return
      }

      // 将 chunk 追加到打字机 buffer
      typewriterBufferRef.current += chunk

      // 用已 flush + 未 flush 的完整累积内容检测指令（防止指令跨 chunk 被打字机部分消费）
      const fullAccumulated = flushedContentRef.current + typewriterBufferRef.current

      // 统一检测所有协议标记 — 命中即切「正在生成 XX…」折叠态
      const hit = PROTOCOL_MARKERS.find(p => fullAccumulated.includes(p.marker))
      if (hit) {
        isMuseTaskDetectedRef.current = true
        const splitIndex = fullAccumulated.indexOf(hit.marker)
        const textBefore = fullAccumulated.slice(0, splitIndex).trim()
        // draft 从标记处开始，作为折叠态可展开的协议原文
        const draftSoFar = fullAccumulated.slice(splitIndex)
        protocolDraftRef.current = draftSoFar
        typewriterBufferRef.current = ''
        flushedContentRef.current = ''
        const protocolMsgId = streamingMsgIdRef.current
        if (protocolMsgId) {
          // 强制截断 content 为 textBefore，修复竞态：
          // 打字机可能在句中停顿 (setTimeout) 期间已将包含标记前文本的内容 flush 到消息，
          // 此处用 textBefore 覆盖确保消息不会包含协议标记及其后续内容
          setMessages(prev => prev.map(msg =>
            msg.id === protocolMsgId
              ? {
                  ...msg,
                  content: textBefore,
                  isThinking: false,
                  protocolStreaming: { kind: hit.kind, label: hit.label, draft: draftSoFar }
                }
              : msg
          ))
        }
        // stopTypewriter 在清除 refs 之后调用，remaining 为空，不会向消息追加多余内容
        stopTypewriter()
        return
      }

      // 如果 buffer 末尾可能是尚未到齐的协议标记前缀，暂缓打字机消费，
      // 避免标记被部分 flush 导致后续整体匹配失败
      if (PENDING_PROTOCOL_PREFIX.test(typewriterBufferRef.current)) {
        return
      }

      startTypewriter()
    })

    // 监听 followUp 进度事件
    const cleanupProgress = window.electronAPI.ai.onFollowUpProgress(({ type, message, depth, sessionId, isStep, isStepStatus, stepIndex, isSummary }) => {
      console.log('[FollowUp Progress]', type, message, { isStep, isStepStatus, stepIndex, isSummary })

      // isSummary: AI 最终总结文本，创建独立的 text 消息
      if (isSummary && message) {
        // 移除进度消息，替换为最终总结
        setMessages(prev => {
          const filtered = prev.filter(msg => !msg.id.startsWith('followup-progress-'))
          return [...filtered, {
            id: `followup-summary-${Date.now()}`,
            role: 'assistant' as const,
            content: message,
            type: 'text' as const
          }]
        })
        setLoading(false)
        return
      }

      // 非 summary 的进度事件：只维护一条简洁的进度指示消息，显示最新状态
      const progressMsgId = `followup-progress-${depth}`
      setMessages(prev => {
        const existingIndex = prev.findIndex(msg => msg.id === progressMsgId)
        const progressMsg = {
          id: progressMsgId,
          role: 'assistant' as const,
          content: '',
          type: 'text' as const,
          isThinking: true,
          isProgress: true
        }
        if (existingIndex >= 0) {
          // 已有进度消息，保持 thinking 状态即可
          return prev
        }
        return [...prev, progressMsg]
      })
    })

    const cleanupEnd = window.electronAPI.ai.onStreamEnd((result) => {
      console.log(`[Stream] 🏁 onStreamEnd: flushedLen=${flushedContentRef.current.length}, bufLen=${typewriterBufferRef.current.length}`)
      // 流结束：flush 打字机 buffer 中剩余内容到 flushedContentRef（同步）
      stopTypewriter()

      // 清理 followUp 进度占位消息
      setMessages(prev => prev.filter(msg => !msg.id.startsWith('followup-progress-')))

      // 获取流式累积的完整内容（同步可读，不依赖 React state）
      const streamedContent = flushedContentRef.current
      // 重置，为下次流做准备
      flushedContentRef.current = ''
      isMuseTaskDetectedRef.current = false
      protocolDraftRef.current = ''

      const msgId = streamingMsgIdRef.current
      if (!msgId) return

      // 流结束：无论后续解析成何种类型，先统一清除流式折叠态标记，
      // 避免 protocolStreaming 残留覆盖最终卡片渲染
      setMessages(prev => prev.map(msg =>
        msg.id === msgId && msg.protocolStreaming
          ? { ...msg, protocolStreaming: undefined }
          : msg
      ))

      // 计算延迟
      if (streamCallStartTimeRef.current) {
        setLatency(Date.now() - streamCallStartTimeRef.current)
      }

      // 更新上下文模式信息
      if (result.contextMode && result.contextSize) {
        setContextInfo(prev => ({
          mode: result.contextMode,
          size: result.contextSize,
          firstFullSize: result.contextMode === 'full' ? result.contextSize : prev.firstFullSize
        }))
      }

      streamingMsgIdRef.current = null
      setIsStreaming(false)

      // 如果是被中断的响应，用 streamedContent 保留已接收内容
      if (result.aborted) {
        let abortContent = streamedContent || ''
        // 同样剥除泄漏的协议标记
        for (const p of PROTOCOL_MARKERS) {
          const idx = abortContent.indexOf(p.marker)
          if (idx !== -1) abortContent = abortContent.slice(0, idx).trim()
        }
        // ReAct 协议 JSON 泄漏清洗
        const reactAbortMatch = abortContent.match(/\{\s*"type"\s*:\s*"(final|action)"/)
        if (reactAbortMatch && reactAbortMatch.index !== undefined) {
          const braceStart = reactAbortMatch.index
          const braceEnd = abortContent.lastIndexOf('}')
          if (braceEnd > braceStart) {
            const before = abortContent.slice(0, braceStart).trim()
            const after = abortContent.slice(braceEnd + 1).trim()
            if (reactAbortMatch[1] === 'final') {
              try {
                const parsed = JSON.parse(abortContent.slice(braceStart, braceEnd + 1))
                const answer = parsed.answer || parsed.final_answer || parsed.thought || ''
                abortContent = [before, answer, after].filter(Boolean).join('\n\n')
              } catch {
                abortContent = [before, after].filter(Boolean).join('\n\n')
              }
            } else {
              abortContent = [before, after].filter(Boolean).join('\n\n')
            }
          }
        }
        setMessages(prev => prev.map(m =>
          m.id === msgId
            ? { ...m, content: abortContent || m.content || '', type: 'text' as const }
            : m
        ))
        setLoading(false)
        return
      }

      if (!result.success) {
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: `❌ 调用失败：${result.error || 'AI 服务调用失败'}`, type: 'error' as const }
            : msg
        ))
        setLoading(false)
        return
      }

      // Muse Router ReAct 任务结果：用干净的 final answer 替换流式中间步骤
      if (result.routedBy === 'muse-router' && result.content) {
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? {
                ...msg,
                content: result.content,
                type: 'text' as const,
                webSearched: false,
                artifacts: result.artifacts || [],
                totalSteps: result.totalSteps || 0,
                isMuseTask: true
              }
            : msg
        ))
        setLoading(false)
        return
      }

      // 任务执行结果兜底：优先使用 taskSummary（当 content 为空时）
      if (result.isTask && result.taskSummary && !result.content) {
        const taskResponse = result.taskSummary
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: taskResponse, type: 'text' as const, webSearched: result.webSearched || false }
            : msg
        ))
        setLoading(false)
        streamingMsgIdRef.current = null
        return
      }

      const response = result.content || ''
      const webSearched = result.webSearched || false

      // 代码变更检测（Search & Replace）
      if (result.isSearchReplace) {
        try {
          const searchReplaceData = JSON.parse(response)
          setMessages(prev => prev.map(msg =>
            msg.id === msgId
              ? {
                  ...msg,
                  content: searchReplaceData.summary || '📝 代码变更已应用',
                  type: 'search_replace' as const,
                  searchReplaceData,
                  webSearched
                }
              : msg
          ))
          // 历史由后端唯一存储，前端不再写库
          setLoading(false)
          return
        } catch (e) { console.error('解析代码变更数据失败:', e) }
      }

      // 脚本检测
      if (result.isScript) {

        try {
          const scriptData = JSON.parse(response)
          setMessages(prev => prev.map(msg =>
            msg.id === msgId
              ? {
                  ...msg,
                  content: `📜 已生成脚本：${scriptData.description}`,
                  type: 'script' as const,
                  scriptData,
                  webSearched
                }
              : msg
          ))
          // 历史由后端唯一存储，前端不再写库
          setLoading(false)
          return
        } catch (e) { console.error('解析脚本数据失败:', e) }
      }

      // 检测技能安装
      const installSkillData = parseSkillInstall(response)
      if (installSkillData) {
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? {
                ...msg,
                content: `🎯 检测到技能安装请求\n仓库：${installSkillData.url}\n技能：${installSkillData.skillName || '默认'}`,
                type: 'skill_install' as const,
                skillData: installSkillData
              }
            : msg
        ))
        setLoading(false)
        return
      }

      // 检测技能保存
      const hasSaveSkillKeyword = response.includes('SAVE_SKILL:')
      const saveSkillData = parseSkillSave(response)

      if (hasSaveSkillKeyword && !saveSkillData) {
        // AI 输出了 SAVE_SKILL 指令但 JSON 解析失败，自动请求重试
        console.error('[SAVE_SKILL] JSON 解析失败，原始响应片段:', response.substring(response.indexOf('SAVE_SKILL:'), response.indexOf('SAVE_SKILL:') + 200))
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: `⚠️ 技能 JSON 解析失败，正在请求 AI 重新生成...`, type: 'text' as const }
            : msg
        ))
        setLoading(false)
        // 自动触发重试：让 AI 修复 JSON
        setTimeout(() => {
          if (window.electronAPI) {
            const retryMsgId = `msg-retry-skill-${Date.now()}`
            setMessages(prev => [...prev, {
              id: retryMsgId,
              role: 'assistant' as const,
              content: '🔄 正在重新生成技能...',
              type: 'text' as const
            }])
            window.electronAPI.ai.sendMessage(
              '上一次输出的 SAVE_SKILL JSON 格式有误导致解析失败。请重新输出技能，注意：content 字段内的所有换行必须用 \\n 转义，双引号必须用 \\" 转义，确保整个 SAVE_SKILL: {...} 是合法的单行 JSON。',
              { retryMsgId }
            ).catch((e: Error) => {
              setMessages(prev => prev.map(msg =>
                msg.id === retryMsgId ? { ...msg, content: `❌ 重试失败：${e.message}`, type: 'error' as const } : msg
              ))
            })
          }
        }, 500)
        return
      }

      if (saveSkillData && window.electronAPI) {
        window.electronAPI.db.skills.saveLocal({
          name: saveSkillData.name,
          description: saveSkillData.description || '',
          content: saveSkillData.content
        }).then(result => {
          if (result.success) {
            setMessages(prev => prev.map(msg =>
              msg.id === msgId
                ? { ...msg, content: `✅ 技能「${saveSkillData.name}」已保存成功！\n\n描述：${saveSkillData.description || '无'}\n\n已添加到技能矩阵，可在输入框左侧选择使用。`, type: 'text' as const }
                : msg
            ))
            refreshSkills()
          } else {
            // saveLocal 返回 success: false，显示错误
            setMessages(prev => prev.map(msg =>
              msg.id === msgId
                ? { ...msg, content: `❌ 技能保存失败：${result.error || '未知错误'}`, type: 'error' as const }
                : msg
            ))
          }
        }).catch(e => {
          setMessages(prev => prev.map(msg =>
            msg.id === msgId ? { ...msg, content: `❌ 技能保存失败：${e.message}`, type: 'error' as const } : msg
          ))
        })
        setLoading(false)
        return
      }

      // 检测技能更新
      const skillUpdateResult = parseSkillUpdate(response)
      if (skillUpdateResult && window.electronAPI) {
        const { data: skillUpdateData, textBefore } = skillUpdateResult
        if (textBefore) {
          setMessages(prev => prev.map(msg =>
            msg.id === msgId ? { ...msg, content: textBefore, type: 'text' as const, webSearched } : msg
          ))
        }

        // 优先用 id 精确匹配（编辑模式下 skillEditMode.id 最可靠），fallback 到 name 匹配
        const resolveTargetSkill = async () => {
          const allSkills = await window.electronAPI!.db.skills.getAll()

          // 1. 优先用 SKILL_UPDATE 中的 id
          if (skillUpdateData.id) {
            const byId = allSkills.find((s: any) => s.id === skillUpdateData.id)
            if (byId) return byId
          }

          // 2. 编辑模式下用 skillEditMode.id
          if (skillEditMode?.id) {
            const byEditId = allSkills.find((s: any) => s.id === skillEditMode.id)
            if (byEditId) return byEditId
          }

          // 3. fallback: name 匹配
          return allSkills.find((s: any) => s.name === skillUpdateData.name) || null
        }

        resolveTargetSkill().then(async (targetSkill) => {
          if (targetSkill) {
            // 构建更新数据（支持 description 更新）
            const updatePayload: Record<string, string> = { content: skillUpdateData.content }
            if (skillUpdateData.description) {
              updatePayload.description = skillUpdateData.description
            }

            await window.electronAPI!.db.skills.update(targetSkill.id, updatePayload)
            const successMsg: Message = {
              id: `skill-update-${Date.now()}`, role: 'assistant',
              content: `✅ 技能「${skillUpdateData.name}」已更新成功！`, type: 'text'
            }
            setMessages(prev => [...prev, successMsg])
            refreshSkills()

            // 同步编辑模式状态（用 id 匹配，更可靠）
            if (skillEditMode && setSkillEditMode && (skillEditMode.id === targetSkill.id || skillEditMode.name === skillUpdateData.name)) {
              setSkillEditMode({
                ...skillEditMode,
                content: skillUpdateData.content,
                ...(skillUpdateData.description ? { description: skillUpdateData.description } : {})
              })
            }
          } else {
            console.error('[SKILL_UPDATE] 未找到匹配的技能:', skillUpdateData.name, skillUpdateData.id)
            const errorMsg: Message = {
              id: `skill-update-error-${Date.now()}`, role: 'assistant',
              content: `❌ 未找到技能「${skillUpdateData.name}」，更新失败`, type: 'text'
            }
            setMessages(prev => [...prev, errorMsg])
          }
        }).catch(e => console.error('[SKILL_UPDATE] 更新失败:', e))
        setLoading(false)
        return
      }

      // 检测统一产物指令（ARTIFACT）
      const artifactData = parseArtifact(response)
      if (artifactData) {
        const artifactTextBefore = response.split('ARTIFACT:')[0].trim()
        const artifactContent = artifactTextBefore || artifactData.title || ''
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? {
                ...msg,
                content: artifactContent,
                type: 'artifact' as const,
                artifactData,
                webSearched
              }
            : msg
        ))
        // 历史由后端唯一存储，前端不再写库
        setLoading(false)
        return
      }

      // 检测 Rich Form 表单指令
      const richFormData = parseRichForm(response)
      if (richFormData) {
        const textBefore = response.split('RICH_FORM:')[0].trim()
        const richFormContent = textBefore || richFormData.description || richFormData.title
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? {
                ...msg,
                content: richFormContent,
                type: 'rich_form' as const,
                richFormData,
                webSearched
              }
            : msg
        ))
        // 历史由后端唯一存储，前端不再写库
        setLoading(false)
        return
      }

      // 检测多选命令
      const cmdOptions = parseCommandOptions(response)
      if (cmdOptions) {
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: '我理解你可能想执行以下操作，请选择：', type: 'command_options' as const, commandOptions: cmdOptions, webSearched }
            : msg
        ))
        setLoading(false)
        return
      }

      // 普通文本/命令
      // 优先使用流式累积的内容（通过 ref 同步读取，不依赖 React state 批量更新）
      let finalContent = streamedContent || response

      // 安全清洗：剥除泄漏的协议标记文本（MUSE_TASK/SCRIPT_BLOCK/ARTIFACT 等）
      // 后端返回的 result.content 可能包含原始协议全文，此处作为最后防线截断
      for (const p of PROTOCOL_MARKERS) {
        const idx = finalContent.indexOf(p.marker)
        if (idx !== -1) {
          finalContent = finalContent.slice(0, idx).trim()
        }
      }
      // ReAct 协议 JSON 泄漏清洗：{"type":"final",...} / {"type":"action",...}
      const reactJsonHeaderMatch = finalContent.match(/\{\s*"type"\s*:\s*"(final|action)"/)
      if (reactJsonHeaderMatch && reactJsonHeaderMatch.index !== undefined) {
        const braceStart = reactJsonHeaderMatch.index
        const braceEnd = finalContent.lastIndexOf('}')
        if (braceEnd > braceStart) {
          const before = finalContent.slice(0, braceStart).trim()
          const after = finalContent.slice(braceEnd + 1).trim()
          if (reactJsonHeaderMatch[1] === 'final') {
            // 用 JSON.parse 还原转义（\n → 真换行），regex 无法做到
            try {
              const parsed = JSON.parse(finalContent.slice(braceStart, braceEnd + 1))
              const answer = parsed.answer || parsed.final_answer || parsed.thought || ''
              finalContent = [before, answer, after].filter(Boolean).join('\n\n') || answer
            } catch {
              finalContent = [before, after].filter(Boolean).join('\n\n')
            }
          } else {
            finalContent = [before, after].filter(Boolean).join('\n\n')
          }
        }
      }
      // 空响应兑底：后端返回 0 字节时给出明确提示，避免气泡后续被 TextMessageContent 渲染为思考动画
      if (!finalContent.trim()) {
        setMessages(prev => prev.map(msg =>
          msg.id === msgId
            ? { ...msg, content: '⚠️ AI 未返回任何内容，请重试。可能原因：上下文超限、路由判定异常、后端返回空。', type: 'text' as const, isThinking: false, webSearched }
            : msg
        ))
        setLoading(false)
        return
      }
      const isCommand = detectCommand(finalContent)
      setMessages(prev => prev.map(msg => {
        if (msg.id !== msgId) return msg
        return {
          ...msg,
          content: finalContent,
          type: isCommand ? 'command' as const : 'text' as const,
          webSearched,
          isComplex: result.isComplex || false,
          userInput: result.userInput || '',
          isThinking: false,
          contextChips: result.contextChips || undefined,
          craftReview: result.craftReview ? {
            available: result.craftReview.available,
            ruleCount: result.craftReview.ruleCount,
            ruleNames: result.craftReview.ruleNames
          } : undefined
        }
      }))
      if (isCommand) setPendingCommand(response)

      // 历史已由后端 chat-handler 保存，前端不再重复写入

      setLoading(false)
    })

    return () => {
      cleanupChunk()
      cleanupProgress()
      cleanupEnd()
      // 清理打字机定时器
      if (typewriterTimerRef.current) {
        clearInterval(typewriterTimerRef.current)
        typewriterTimerRef.current = null
      }
      typewriterBufferRef.current = ''
    }
  }, [skillEditMode, setSkillEditMode])

  // 停止生成
  const stopGeneration = async () => {
    if (!window.electronAPI) return

    const msgId = streamingMsgIdRef.current

    // 先同步冻结前端，避免等待 IPC 期间继续消费 chunk 或展示协议草稿。
    typewriterActiveRef.current = false
    typewriterBufferRef.current = ''
    if (typewriterTimerRef.current) {
      clearTimeout(typewriterTimerRef.current)
      cancelAnimationFrame(typewriterTimerRef.current as unknown as number)
      typewriterTimerRef.current = null
    }
    flushedContentRef.current = ''
    isMuseTaskDetectedRef.current = false
    protocolDraftRef.current = ''
    streamingMsgIdRef.current = null
    setIsStreaming(false)
    setLoading(false)

    if (msgId) {
      setMessages(prev => prev.map(msg => {
        if (msg.id !== msgId) return msg
        let content = msg.content || ''
        for (const protocol of PROTOCOL_MARKERS) {
          const markerIndex = content.indexOf(protocol.marker)
          if (markerIndex >= 0) content = content.slice(0, markerIndex).trim()
        }
        return {
          ...msg,
          content,
          type: 'text' as const,
          isThinking: false,
          protocolStreaming: undefined,
        }
      }))
    }

    try {
      await window.electronAPI.ai.abortStream()
    } catch (error) {
      console.error('停止生成失败:', error)
    }
  }

  return {
    isStreaming,
    setIsStreaming,
    streamingMsgIdRef,
    streamCallStartTimeRef,
    lastUserMessageRef,
    flushedContentRef,
    stopGeneration
  }
}

import { useState, useEffect } from 'react'
import type { Message } from '../types'
import { parseArtifact, parseRichForm, parseCommandOptions } from './response-parser'

const AUTO_LOAD_SIZE = 5 // 首次只展示最近 5 个消息气泡
const PAGE_SIZE = 5 // 每次向前加载 5 个消息气泡

/**
 * 历史 AI 消息构建 — 后端唯一存储原始 content（含协议原文），
 * 这里在渲染前动态解析协议标记并还原为对应类型，与流式渲染共用同一套 parser。
 * 不再依赖已废弃的 record.msgType 兼容字段。
 */
function buildHistoryAiMessage(record: any): Message {
  const id = `hist-ai-${record.id}`
  const rawContent: string = record.result?.content || record.content || ''
  const base: Message = {
    id,
    role: 'assistant',
    content: rawContent,
    type: 'text',
    webSearched: record.webSearched
  }

  // ARTIFACT 协议 → 产物卡片
  const artifactData = parseArtifact(rawContent)
  if (artifactData) {
    return {
      ...base,
      type: 'artifact',
      artifactData,
      content: rawContent.split('ARTIFACT:')[0].trim()
    }
  }

  // RICH_FORM 协议 → 表单卡片（历史以只读摘要渲染，由 MessageContent 处理）
  const richFormData = parseRichForm(rawContent)
  if (richFormData) {
    return {
      ...base,
      type: 'rich_form',
      richFormData,
      content: rawContent.split('RICH_FORM:')[0].trim()
    }
  }

  // COMMAND_OPTIONS 协议 → 命令选项按钮（二次访问也需还原为可点击选项）
  const cmdOptions = parseCommandOptions(rawContent)
  if (cmdOptions) {
    const textBefore = rawContent.split('COMMAND_OPTIONS:')[0].trim()
    return {
      ...base,
      type: 'command_options',
      commandOptions: cmdOptions,
      content: textBefore || '我理解你可能想执行以下操作，请选择：'
    }
  }

  // 其余（含所有协议标记）以纯文本呈现，剥除协议原文避免泄漏源码
  // 包含 ARTIFACT/RICH_FORM/COMMAND_OPTIONS 的兜底：当上方专属解析器因 JSON 修复失败而返回 null 时，
  // 此处截断标记之后的全部内容，防止原始 JSON+HTML 源码泄漏到气泡
  const protocolSplit = rawContent.search(/MUSE_TASK:|SCRIPT_BLOCK:|SEARCH_REPLACE:|ARTIFACT:|RICH_FORM:|COMMAND_OPTIONS:/)
  if (protocolSplit >= 0) {
    const textBefore = rawContent.slice(0, protocolSplit).trim()
    return { ...base, content: textBefore || rawContent }
  }

  // ReAct 协议 JSON 泄漏清洗：{"type":"final",...} 或 {"type":"action",...}
  const reactJsonMatch = rawContent.match(/\{\s*"type"\s*:\s*"(final|action)"/)
  if (reactJsonMatch && reactJsonMatch.index !== undefined) {
    const braceStart = reactJsonMatch.index
    const braceEnd = rawContent.lastIndexOf('}')
    if (braceEnd > braceStart) {
      const textBefore = rawContent.slice(0, braceStart).trim()
      const textAfter = rawContent.slice(braceEnd + 1).trim()
      if (reactJsonMatch[1] === 'final') {
        // 用 JSON.parse 还原转义（\n → 真换行）
        try {
          const parsed = JSON.parse(rawContent.slice(braceStart, braceEnd + 1))
          const answer = parsed.answer || parsed.final_answer || parsed.thought || ''
          const cleanText = [textBefore, answer, textAfter].filter(Boolean).join('\n\n')
          return { ...base, content: cleanText || answer || rawContent }
        } catch {
          return { ...base, content: [textBefore, textAfter].filter(Boolean).join('\n\n') || rawContent }
        }
      }
      // action 类型直接剥除
      const cleanText = [textBefore, textAfter].filter(Boolean).join('\n\n')
      return { ...base, content: cleanText || rawContent }
    }
  }

  return base
}

function recordsToMessages(records: any[]): Message[] {
  const messages: Message[] = []
  // 数据库存储为最新记录在前，气泡列表需要按时间正序排列。
  ;[...records].reverse().forEach(record => {
    messages.push({
      id: `hist-user-${record.id}`,
      role: 'user',
      content: record.query,
      type: 'text'
    })
    messages.push(buildHistoryAiMessage(record))
  })
  return messages
}

export function useHistoryRecords(
  isElectron: boolean,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  const [historyMessages, setHistoryMessages] = useState<Message[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(0)
  const [showHistoryHint, setShowHistoryHint] = useState(false)

  useEffect(() => {
    const handleNewSession = () => {
      setHistoryMessages([])
      setHistoryLoaded(0)
      setShowHistoryHint(false)
    }
    window.addEventListener('muse:new-session', handleNewSession)
    return () => window.removeEventListener('muse:new-session', handleNewSession)
  }, [])

  // 加载历史记录并自动恢复最近的会话消息（仅首次挂载）
  useEffect(() => {
    if (!isElectron) return

    const clearedAt = localStorage.getItem('chatClearedAt') || '0'
    
    window.electronAPI!.db.history.getAll().then(records => {
      if (records && records.length > 0) {
        // 只加载清空时间之后的记录（id 是 Date.now() 字符串）
        const filteredRecords = clearedAt !== '0'
          ? records.filter((r: any) => Number(r.id) > Number(clearedAt))
          : records
        
        if (filteredRecords.length === 0) return
        
        const allMessages = recordsToMessages(filteredRecords)
        const initialMessages = allMessages.slice(-AUTO_LOAD_SIZE)
        setHistoryMessages(allMessages)
        
        setMessages(initialMessages)
        setHistoryLoaded(initialMessages.length)
        
        setShowHistoryHint(allMessages.length > initialMessages.length)
      }
    }).catch(() => {})
  }, [])

  // 从当前最早气泡继续向前加载。
  const loadMoreHistory = () => {
    const end = historyMessages.length - historyLoaded
    const start = Math.max(0, end - PAGE_SIZE)
    const nextBatch = historyMessages.slice(start, end)
    if (nextBatch.length === 0) return

    setMessages(prev => [...nextBatch, ...prev])
    const newLoaded = historyLoaded + nextBatch.length
    setHistoryLoaded(newLoaded)
    if (newLoaded >= historyMessages.length) {
      setShowHistoryHint(false)
    }
  }

  return {
    showHistoryHint,
    loadMoreHistory
  }
}

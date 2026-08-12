import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Tag } from 'antd'
import {
  ForkOutlined, HighlightOutlined, LoadingOutlined, ReadOutlined, StopOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'
import type { LearningNode, LearningQA } from '../types/electron'

interface LearningBookReaderProps {
  node: LearningNode
  mapId: string
  mapTitle: string
  nodePath: string
  // 后台预生成当前正在撰写的章节（用于展示「后台撰写中」与插队）
  prefetchCurrent: { mapId: string; nodeId: string; title: string } | null
  onChanged: () => Promise<void>
  notify: (type: 'success' | 'error' | 'info', text: string) => void
}

type RequestKind = 'content' | 'ask' | 'drill'

interface ActiveRequest {
  id: string
  kind: RequestKind
  question?: string
  selection?: string
}

interface QaDraft {
  selection: string
  question: string
  answer: string
  streaming: boolean
}

interface SelectionToolbar {
  x: number
  y: number
  text: string
}

const makeRequestId = () => `lrn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

// 宽容解析 drill 返回的子知识点 JSON（容忍 ```json 围栏与多余文字）
function parseDrillItems(raw: string): { title: string; summary: string }[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item.title === 'string' && item.title.trim())
      .slice(0, 5)
      .map(item => ({ title: item.title.trim().slice(0, 120), summary: String(item.summary || '').trim().slice(0, 500) }))
  } catch {
    return []
  }
}

/**
 * 学习图谱「活的书」阅读器：
 * - 章节正文（技术要点/讲解/代码实例）由 AI 按需撰写并持久化
 * - 圈选任意文字可提问或下钻衍生子知识点
 */
const LearningBookReader: React.FC<LearningBookReaderProps> = ({ node, mapId, mapTitle, nodePath, prefetchCurrent, onChanged, notify }) => {
  const [contentDraft, setContentDraft] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [drilling, setDrilling] = useState(false)
  const [qaDraft, setQaDraft] = useState<QaDraft | null>(null)
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const qaPanelRef = useRef<HTMLDivElement | null>(null)
  const reqRef = useRef<ActiveRequest | null>(null)
  // 事件回调里读取最新上下文，避免闭包过期
  const ctxRef = useRef({ node, mapId, mapTitle, nodePath, onChanged, notify })
  ctxRef.current = { node, mapId, mapTitle, nodePath, onChanged, notify }

  // 全局流式事件订阅：按 requestId 过滤
  useEffect(() => {
    const offChunk = window.electronAPI.muse.learning.onAiChunk(data => {
      const req = reqRef.current
      if (!req || data.requestId !== req.id) return
      if (req.kind === 'content') setContentDraft(data.content)
      else if (req.kind === 'ask') setQaDraft(prev => (prev ? { ...prev, answer: data.content } : prev))
    })
    const offEnd = window.electronAPI.muse.learning.onAiEnd(async data => {
      const req = reqRef.current
      if (!req || data.requestId !== req.id) return
      reqRef.current = null
      const ctx = ctxRef.current

      if (req.kind === 'content') {
        setGenerating(false)
        if (data.content && data.content.trim()) {
          const result = await window.electronAPI.muse.learning.updateNode({
            mapId: ctx.mapId, nodeId: ctx.node.id, updates: { content: data.content },
          })
          if (result.success) {
            setContentDraft(null)
            await ctx.onChanged()
            ctx.notify('success', data.success ? '本章已写入书页' : '已停止，保留已生成部分')
          } else {
            ctx.notify('error', result.error || '章节保存失败')
          }
        } else {
          setContentDraft(null)
          ctx.notify(data.success ? 'info' : 'error', data.error || '未生成内容')
        }
        return
      }

      if (req.kind === 'ask') {
        setQaDraft(prev => (prev ? { ...prev, streaming: false } : prev))
        if (data.success && data.content.trim()) {
          const qa: LearningQA[] = [...(ctx.node.qa || []), {
            question: req.question || '解释这段内容',
            selection: req.selection || '',
            answer: data.content,
            createdAt: new Date().toISOString(),
          }]
          const result = await window.electronAPI.muse.learning.updateNode({
            mapId: ctx.mapId, nodeId: ctx.node.id, updates: { qa },
          })
          if (result.success) {
            setQaDraft(null)
            await ctx.onChanged()
          } else {
            ctx.notify('error', result.error || '问答保存失败')
          }
        } else if (!data.success) {
          ctx.notify('error', data.error || '提问失败')
        }
        return
      }

      // drill：解析子知识点并批量挂到当前节点下
      setDrilling(false)
      if (!data.success) {
        ctx.notify('error', data.error || '下钻失败')
        return
      }
      const items = parseDrillItems(data.content)
      if (items.length === 0) {
        ctx.notify('error', 'AI 未返回有效的子知识点')
        return
      }
      let created = 0
      for (const item of items) {
        const result = await window.electronAPI.muse.learning.addNode({
          mapId: ctx.mapId, parentId: ctx.node.id, title: item.title, summary: item.summary,
        })
        if (result.success) created += 1
      }
      await ctx.onChanged()
      ctx.notify('success', `已下钻添加 ${created} 个子知识点`)
    })
    return () => { offChunk(); offEnd() }
  }, [])

  // 切换节点/卸载：中断进行中的生成
  useEffect(() => {
    return () => {
      const req = reqRef.current
      if (req) window.electronAPI.muse.learning.aiAbort(req.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const startRequest = async (kind: RequestKind, extra: { selection?: string; question?: string } = {}) => {
    const id = makeRequestId()
    reqRef.current = { id, kind, ...extra }
    const result = await window.electronAPI.muse.learning.aiAsk({
      requestId: id,
      kind,
      mapTitle,
      nodePath,
      nodeTitle: node.title,
      selection: extra.selection,
      question: extra.question,
    })
    if (!result.success) {
      reqRef.current = null
      notify('error', result.error || 'AI 通道不可用')
      return false
    }
    return true
  }

  const generateContent = async () => {
    // 插队：若后台正在预生成其他章节，优先排入本章；若正在写本章则让位给手动请求
    window.electronAPI.muse.learning.prefetchBump(mapId, node.id).catch(() => {})
    setContentDraft('')
    setGenerating(true)
    const ok = await startRequest('content')
    if (!ok) {
      setContentDraft(null)
      setGenerating(false)
    }
  }

  const stopCurrent = () => {
    const req = reqRef.current
    if (req) window.electronAPI.muse.learning.aiAbort(req.id)
  }

  const startDrill = async (selection?: string) => {
    // 清除选区：避免后续 mouseup 回调把浮动工具条重新浮出
    window.getSelection()?.removeAllRanges()
    setToolbar(null)
    setDrilling(true)
    const ok = await startRequest('drill', selection ? { selection } : {})
    if (!ok) setDrilling(false)
  }

  // 圈选后浮出「提问 / 下钻」工具条
  const handleMouseUp = () => {
    setTimeout(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !contentRef.current) {
        setToolbar(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setToolbar(null)
        return
      }
      const text = selection.toString().trim()
      if (!text || text.length > 2000) {
        setToolbar(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setToolbar({
        x: Math.max(8, rect.left + rect.width / 2 - 96),
        y: Math.max(8, rect.top - 42),
        text,
      })
    }, 0)
  }

  const openAskPanel = (selectionText: string) => {
    // 清除选区：避免后续 mouseup 回调把浮动工具条重新浮出
    window.getSelection()?.removeAllRanges()
    setToolbar(null)
    setQaDraft({ selection: selectionText, question: '', answer: '', streaming: false })
    // 面板挂在正文下方，自动滚入视线并聚焦输入框
    setTimeout(() => qaPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
  }

  const submitAsk = async () => {
    if (!qaDraft || qaDraft.streaming) return
    const question = qaDraft.question.trim() || '解释这段内容'
    setQaDraft(prev => (prev ? { ...prev, streaming: true, answer: '' } : prev))
    const ok = await startRequest('ask', { selection: qaDraft.selection, question })
    if (!ok) setQaDraft(prev => (prev ? { ...prev, streaming: false } : prev))
  }

  const displayedContent = contentDraft !== null ? contentDraft : node.content || ''
  const busy = generating || drilling
  const qaList = node.qa || []
  const backgroundWriting = !displayedContent && !generating && prefetchCurrent?.nodeId === node.id

  return (
    <div onMouseUp={handleMouseUp}>
      {/* 工具行 */}
      <div className="flex flex-wrap items-center gap-2">
        {!displayedContent && !generating ? (
          <Button type="primary" size="small" icon={<ThunderboltOutlined />} onClick={generateContent}>
            {backgroundWriting ? '立即撰写（插队）' : 'AI 撰写本章'}
          </Button>
        ) : (
          <Button size="small" icon={<ThunderboltOutlined />} disabled={busy} onClick={generateContent}>
            {node.content ? '重新撰写本章' : 'AI 撰写本章'}
          </Button>
        )}
        <Button size="small" icon={<ForkOutlined />} loading={drilling} disabled={busy} onClick={() => startDrill()}>
          下钻子主题
        </Button>
        {busy && <Button size="small" danger icon={<StopOutlined />} onClick={stopCurrent}>停止</Button>}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-text-faint">
          <HighlightOutlined />圈选任意文字即可提问或下钻
        </span>
      </div>

      {/* 导读：无正文时展示种子摘要 */}
      {!displayedContent && !generating && node.summary && (
        <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><ReadOutlined className="text-sky-500" />本节导读</span>}>
          <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{node.summary}</p>
        </Card>
      )}

      {/* 后台预生成中 */}
      {backgroundWriting && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-xs text-text-muted">
          <LoadingOutlined className="text-sky-500" />
          AI 正在后台撰写本章，完成后自动呈现；等不及可点「立即撰写（插队）」。
        </div>
      )}

      {/* 章节正文 */}
      {(displayedContent || generating) && (
        <div ref={contentRef} className="learning-book mt-3 rounded-lg border border-border-subtle/60 px-4 py-3">
          {generating && !displayedContent && (
            <div className="py-4 text-center text-xs text-text-muted">AI 正在撰写本章，约需 10-30 秒…</div>
          )}
          {displayedContent && <MarkdownRenderer content={displayedContent} role="assistant" />}
        </div>
      )}

      {/* 圈选提问面板 */}
      {qaDraft && (
        <div ref={qaPanelRef}>
        <Card
          size="small"
          className="mt-3 bg-transparent"
          title={<span className="flex items-center gap-2 text-xs"><HighlightOutlined className="text-amber-500" />圈选提问</span>}
          extra={<Button type="text" size="small" onClick={() => { if (!qaDraft.streaming) setQaDraft(null) }}>收起</Button>}
        >
          <blockquote className="max-h-20 overflow-y-auto whitespace-pre-wrap rounded bg-fill-secondary px-2.5 py-1.5 text-[11px] leading-5 text-text-muted scroll-container">
            {qaDraft.selection}
          </blockquote>
          <Input.TextArea
            autoFocus
            className="mt-2"
            rows={2}
            value={qaDraft.question}
            disabled={qaDraft.streaming}
            placeholder="想问什么？不填则默认「解释这段内容」"
            onChange={event => setQaDraft(prev => (prev ? { ...prev, question: event.target.value } : prev))}
            onPressEnter={submitAsk}
          />
          <div className="mt-2 flex justify-end gap-2">
            {qaDraft.streaming ? (
              <Button size="small" danger icon={<StopOutlined />} onClick={stopCurrent}>停止</Button>
            ) : (
              <Button size="small" type="primary" onClick={submitAsk}>提问</Button>
            )}
          </div>
          {(qaDraft.answer || qaDraft.streaming) && (
            <div className="mt-2 border-t border-border-subtle/50 pt-2">
              {qaDraft.answer
                ? <MarkdownRenderer content={qaDraft.answer} role="assistant" />
                : <div className="text-xs text-text-muted">AI 正在回答…</div>}
            </div>
          )}
        </Card>
        </div>
      )}

      {/* 历史问答沉淀 */}
      {qaList.length > 0 && (
        <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><HighlightOutlined className="text-emerald-500" />我的问答（{qaList.length}）</span>}>
          <div className="flex flex-col gap-3">
            {qaList.map((item, index) => (
              <div key={item.createdAt + index} className="border-b border-border-subtle/40 pb-3 last:border-0 last:pb-0">
                <div className="text-xs font-medium text-text-primary">问：{item.question}</div>
                {item.selection && (
                  <div className="mt-1 truncate text-[10px] text-text-faint" title={item.selection}>圈选：{item.selection}</div>
                )}
                <div className="mt-1.5"><MarkdownRenderer content={item.answer} role="assistant" /></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 圈选浮动工具条 */}
      {toolbar && !busy && (
        <div
          className="fixed z-50 flex gap-1 rounded-lg border border-border-subtle bg-fill-primary p-1 shadow-lg"
          style={{ left: toolbar.x, top: toolbar.y }}
        >
          <Button
            size="small"
            type="primary"
            icon={<HighlightOutlined />}
            onMouseDown={event => event.preventDefault()}
            onClick={() => openAskPanel(toolbar.text)}
          >圈选提问</Button>
          <Button
            size="small"
            icon={<ForkOutlined />}
            onMouseDown={event => event.preventDefault()}
            onClick={() => startDrill(toolbar.text)}
          >下钻</Button>
        </div>
      )}

      {/* 占位：无正文且无导读时 */}
      {!displayedContent && !generating && !node.summary && !backgroundWriting && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border-subtle px-4 py-5 text-xs text-text-muted">
          <Tag>空章节</Tag>点「AI 撰写本章」生成技术要点、讲解与代码实例。
        </div>
      )}
    </div>
  )
}

export default LearningBookReader

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, Input, Modal, Tag } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, CompassOutlined, ForkOutlined, HighlightOutlined,
  LoadingOutlined, ReadOutlined, StopOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'
import type { LearningStatus } from './learningStatus'
import type { LearningNode, LearningQA, LearningQuiz } from '../types/electron'

interface LearningBookReaderProps {
  node: LearningNode
  mapId: string
  mapTitle: string
  nodePath: string
  // 后台预生成当前正在撰写的章节（用于展示「后台撰写中」与插队）
  prefetchCurrent: { mapId: string; nodeId: string; title: string } | null
  // 全书目录（验收批改时供 AI 从中推荐阅读引导）
  nodeDirectory: string
  onChanged: () => Promise<void>
  notify: (type: 'success' | 'error' | 'info', text: string) => void
  // 跳转到引导推荐章节（优先用 nodeId 定位，标题会变、也可能重名）
  onNavigate?: (guide: { nodeId?: string; nodeTitle: string }) => void
}

type RequestKind = 'content' | 'ask' | 'drill' | 'quiz' | 'grade'

// 请求必须自带目标节点身份：落盘时一律用发起请求时的 mapId/nodeId，
// 而不是「流结束时抽屉里正好打开的那个节点」
interface ActiveRequest {
  id: string
  kind: RequestKind
  mapId: string
  nodeId: string
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

interface QuizQuestion {
  question: string
  keyPoint: string
}

// 章节验收会话：出题 → 作答 → 批改 → 结果与引导
interface QuizSession {
  phase: 'answering' | 'grading' | 'result'
  questions: QuizQuestion[]
  answers: string[]
  items?: { question: string; answer: string; pass: boolean; comment: string }[]
  guidance?: { nodeId?: string; nodeTitle: string; reason: string }[]
}

const makeRequestId = () => `lrn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

const STATUS_RANK: Record<LearningStatus, number> = { unexplored: 0, learning: 1, understood: 2, verified: 3 }

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

// 宽容解析验收出题 JSON
function parseQuizItems(raw: string): QuizQuestion[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(item => item && typeof item.question === 'string' && item.question.trim())
      .slice(0, 5)
      .map(item => ({ question: item.question.trim().slice(0, 500), keyPoint: String(item.keyPoint || '').trim().slice(0, 30) }))
  } catch {
    return []
  }
}

// 宽容解析批改结果 JSON
function parseGradeResult(raw: string): { results: { pass: boolean; comment: string }[]; guidance: { nodeId?: string; nodeTitle: string; reason: string }[] } | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    if (!parsed || !Array.isArray(parsed.results)) return null
    return {
      results: parsed.results.slice(0, 10).map((r: { pass?: boolean; comment?: string }) => ({
        pass: Boolean(r?.pass),
        comment: String(r?.comment || '').slice(0, 500),
      })),
      guidance: (Array.isArray(parsed.guidance) ? parsed.guidance : [])
        .filter((g: { nodeTitle?: string }) => g && typeof g.nodeTitle === 'string' && g.nodeTitle.trim())
        .slice(0, 5)
        .map((g: { nodeId?: string; nodeTitle: string; reason?: string }) => ({
          nodeId: typeof g.nodeId === 'string' ? g.nodeId.trim().slice(0, 120) : '',
          nodeTitle: g.nodeTitle.trim().slice(0, 120),
          reason: String(g.reason || '').slice(0, 300),
        })),
    }
  } catch {
    return null
  }
}

/**
 * 学习图谱「活的书」阅读器：
 * - 章节正文（技术要点/讲解/代码实例）由 AI 按需撰写并持久化
 * - 圈选任意文字可提问或下钻衍生子知识点
 */
const LearningBookReader: React.FC<LearningBookReaderProps> = ({ node, mapId, mapTitle, nodePath, prefetchCurrent, nodeDirectory, onChanged, notify, onNavigate }) => {
  const [contentDraft, setContentDraft] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [drilling, setDrilling] = useState(false)
  const [quizing, setQuizing] = useState(false)
  const [qaDraft, setQaDraft] = useState<QaDraft | null>(null)
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null)
  const [quiz, setQuizState] = useState<QuizSession | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const qaPanelRef = useRef<HTMLDivElement | null>(null)
  const quizPanelRef = useRef<HTMLDivElement | null>(null)
  const reqRef = useRef<ActiveRequest | null>(null)
  // 验收会话的最新镜像：onAiEnd 回调里读取，避免闭包过期。
  // 必须同时支持直接赋值和函数式更新——原实现把更新函数原样存进了 ref，
  // 导致作答后 quizRef.current 变成一个函数，「提交批改」会静默失效。
  const quizRef = useRef<QuizSession | null>(null)
  const setQuiz = (next: QuizSession | null | ((prev: QuizSession | null) => QuizSession | null)) => {
    const resolved = typeof next === 'function' ? next(quizRef.current) : next
    quizRef.current = resolved
    setQuizState(resolved)
  }
  // 事件回调里读取最新上下文（提示、刷新用；写入目标一律取自 reqRef）
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
      const api = window.electronAPI.muse.learning

      if (req.kind === 'content') {
        setGenerating(false)
        // 主动停止：丢弃流式草稿，恢复原文，避免误点重生覆盖既有正文
        if (!data.success) {
          setContentDraft(null)
          ctx.notify('info', data.error || '已停止撰写')
          return
        }
        if (data.content && data.content.trim()) {
          const result = await api.updateNode({
            mapId: req.mapId, nodeId: req.nodeId, updates: { content: data.content },
          })
          if (result.success) {
            setContentDraft(null)
            await ctx.onChanged()
            ctx.notify('success', '本章已写入书页')
          } else {
            ctx.notify('error', result.error || '章节保存失败')
          }
        } else {
          setContentDraft(null)
          ctx.notify('error', data.error || '未生成内容')
        }
        return
      }

      if (req.kind === 'ask') {
        setQaDraft(prev => (prev ? { ...prev, streaming: false } : prev))
        if (data.success && data.content.trim()) {
          // 以磁盘上的最新问答为基准合并，避免连续提问时后一次把前一次覆盖掉
          const fresh = await api.getNode(req.mapId, req.nodeId)
          const base: LearningQA[] = (fresh.success && fresh.data?.qa) || []
          const qa: LearningQA[] = [...base, {
            question: req.question || '解释这段内容',
            selection: req.selection || '',
            answer: data.content,
            createdAt: new Date().toISOString(),
          }]
          const result = await api.updateNode({
            mapId: req.mapId, nodeId: req.nodeId, updates: { qa },
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

      // quiz：验收出题完成，进入作答阶段
      if (req.kind === 'quiz') {
        setQuizing(false)
        const questions = parseQuizItems(data.content)
        if (!data.success || questions.length === 0) {
          ctx.notify('error', data.error || '出题失败')
          return
        }
        setQuiz({ phase: 'answering', questions, answers: questions.map(() => '') })
        setTimeout(() => quizPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
        return
      }

      // grade：批改完成，持久化记录并按通过率流转状态
      if (req.kind === 'grade') {
        const session = quizRef.current
        const graded = parseGradeResult(data.content)
        if (!data.success || !graded || !session) {
          ctx.notify('error', data.error || '批改失败')
          if (session) setQuiz({ ...session, phase: 'answering' })
          return
        }
        const items = session.questions.map((q, i) => ({
          question: q.question,
          answer: session.answers[i]?.trim() || '',
          pass: Boolean(graded.results[i]?.pass),
          comment: graded.results[i]?.comment || '',
        }))
        const passCount = items.filter(item => item.pass).length
        const allPassed = passCount === items.length
        // 状态只升不降：已「已验证」的节点重做验收没全过，不该被打回「学习中」。
        // 未全过时最多推进到「学习中」，已理解及以上的保持原状。
        const fresh = await api.getNode(req.mapId, req.nodeId)
        const currentStatus: LearningStatus = (fresh.success && fresh.data?.status) || 'learning'
        const nextStatus: LearningStatus = allPassed
          ? 'verified'
          : (STATUS_RANK[currentStatus] > STATUS_RANK.learning ? currentStatus : 'learning')
        const record: LearningQuiz = { items, guidance: graded.guidance, createdAt: new Date().toISOString() }
        const baseQuiz: LearningQuiz[] = (fresh.success && fresh.data?.quiz) || []
        const result = await api.updateNode({
          mapId: req.mapId, nodeId: req.nodeId,
          updates: {
            quiz: [record, ...baseQuiz],
            status: nextStatus,
            ...(nextStatus === 'verified' ? { verifiedBy: 'quiz' as const } : {}),
          },
        })
        if (result.success) {
          setQuiz({ ...session, phase: 'result', items, guidance: graded.guidance })
          await ctx.onChanged()
          ctx.notify(
            allPassed ? 'success' : 'info',
            allPassed
              ? '全部通过，本章已标记为已验证'
              : `通过 ${passCount}/${items.length}，学习状态保持不变，建议按引导补读相关章节`,
          )
        } else {
          ctx.notify('error', result.error || '批改结果保存失败')
          setQuiz({ ...session, phase: 'answering' })
        }
        return
      }

      // drill：解析子知识点并挂到发起请求的那个节点下
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
        const result = await api.addNode({
          mapId: req.mapId, parentId: req.nodeId, title: item.title, summary: item.summary,
        })
        if (result.success) created += 1
      }
      await ctx.onChanged()
      ctx.notify('success', `已下钻添加 ${created} 个子知识点`)
    })
    return () => { offChunk(); offEnd() }
  }, [])

  // 切换节点：中断进行中的请求，并把局部状态彻底清干净。
  // 只 abort 不清状态，会让新节点短暂显示上一章的流式正文；
  // 万一 aiEnd 丢失还会永久卡在「撰写中」。
  useEffect(() => {
    return () => {
      const req = reqRef.current
      if (req) window.electronAPI.muse.learning.aiAbort(req.id)
      reqRef.current = null
      setContentDraft(null)
      setGenerating(false)
      setDrilling(false)
      setQuizing(false)
      setQaDraft(null)
      setToolbar(null)
      setQuiz(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const startRequest = async (kind: RequestKind, extra: { selection?: string; question?: string; content?: string; answers?: string; nodeDirectory?: string } = {}) => {
    const id = makeRequestId()
    const ctx = ctxRef.current
    // 目标节点身份在发起请求时就固定下来，之后切节点也不会写错地方
    reqRef.current = { id, kind, mapId: ctx.mapId, nodeId: ctx.node.id, ...extra }
    const result = await window.electronAPI.muse.learning.aiAsk({
      requestId: id,
      kind,
      mapTitle: ctx.mapTitle,
      nodePath: ctx.nodePath,
      nodeTitle: ctx.node.title,
      selection: extra.selection,
      question: extra.question,
      content: extra.content,
      answers: extra.answers,
      nodeDirectory: extra.nodeDirectory,
    })
    if (!result.success) {
      reqRef.current = null
      notify('error', result.error || 'AI 通道不可用')
      return false
    }
    return true
  }

  const doGenerate = async () => {
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

  const generateContent = () => {
    if (generating) return
    // 已有正文时二次确认，避免误点重新撰写覆盖既有章节
    if (node.content && node.content.trim()) {
      Modal.confirm({
        title: '重新撰写本章？',
        content: '本章已有正文，重新撰写完成后将覆盖现有内容，且不可恢复。',
        okText: '重新撰写',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: doGenerate,
      })
      return
    }
    doGenerate()
  }

  const busy = generating || drilling || quizing || quiz?.phase === 'grading'

  const stopCurrent = () => {
    const req = reqRef.current
    if (!req) return
    reqRef.current = null
    window.electronAPI.muse.learning.aiAbort(req.id)
    // 立即复位 UI：不等 aiEnd 事件（中断产物直接丢弃）
    if (req.kind === 'content') {
      setGenerating(false)
      setContentDraft(null)
    } else if (req.kind === 'ask') {
      setQaDraft(prev => (prev ? { ...prev, streaming: false } : prev))
    } else if (req.kind === 'drill') {
      setDrilling(false)
    } else if (req.kind === 'quiz') {
      setQuizing(false)
    } else if (req.kind === 'grade') {
      const session = quizRef.current
      if (session) setQuiz({ ...session, phase: 'answering' })
    }
  }

  const startDrill = async (selection?: string) => {
    // 清除选区：避免后续 mouseup 回调把浮动工具条重新浮出
    window.getSelection()?.removeAllRanges()
    setToolbar(null)
    setDrilling(true)
    const ok = await startRequest('drill', selection ? { selection } : {})
    if (!ok) setDrilling(false)
  }

  // 章节验收：读完本章后出 3 道题检验是否真正理解
  const startQuiz = async () => {
    if (!displayedContent || quiz) return
    setQuizing(true)
    const ok = await startRequest('quiz', { content: displayedContent })
    if (!ok) setQuizing(false)
  }

  const submitQuiz = async () => {
    const session = quizRef.current
    if (!session || session.phase !== 'answering') return
    if (!session.answers.some(answer => answer.trim())) {
      notify('info', '至少作答一道题再提交')
      return
    }
    const answersText = session.questions
      .map((q, i) => `${i + 1}. 题目：${q.question}\n   作答：${session.answers[i]?.trim() || '（未作答）'}`)
      .join('\n')
    setQuiz({ ...session, phase: 'grading' })
    const ok = await startRequest('grade', { content: displayedContent, answers: answersText, nodeDirectory })
    if (!ok) setQuiz({ ...session, phase: 'answering' })
  }

  // 圈选后浮出「提问 / 下钻」工具条。
  // 坐标相对阅读器根节点计算（不再用 fixed）：抽屉存在 transform 祖先时
  // fixed 会相对该祖先定位而错位，而且滚动时不跟随正文。
  const handleMouseUp = () => {
    setTimeout(() => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !contentRef.current || !root) {
        setToolbar(null)
        return
      }
      const range = selection.getRangeAt(0)
      if (!contentRef.current.contains(range.commonAncestorContainer)) {
        setToolbar(null)
        return
      }
      const text = selection.toString().trim()
      if (!text) {
        setToolbar(null)
        return
      }
      if (text.length > 2000) {
        setToolbar(null)
        notify('info', '圈选内容过长，请缩短范围后再提问')
        return
      }
      const rect = range.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      setToolbar({
        x: Math.max(8, Math.min(rect.left - rootRect.left + rect.width / 2 - 96, rootRect.width - 208)),
        y: Math.max(4, rect.top - rootRect.top - 42),
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
  const qaList = node.qa || []
  const backgroundWriting = !displayedContent && !generating && prefetchCurrent?.nodeId === node.id
  const showToolbar = Boolean(toolbar && !busy && displayedContent)

  return (
    <div ref={rootRef} className="relative" onMouseUp={handleMouseUp}>
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
        {displayedContent && (
          <Button size="small" icon={<CheckCircleOutlined />} loading={quizing} disabled={busy || quiz !== null} onClick={startQuiz}>
            验收本章
          </Button>
        )}
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
          {generating && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-text-muted">
                <LoadingOutlined className="text-sky-500" />AI 正在撰写本章，约需 10-30 秒…
              </span>
              <Button size="small" danger icon={<StopOutlined />} onClick={stopCurrent}>停止撰写</Button>
            </div>
          )}
          {displayedContent && <MarkdownRenderer content={displayedContent} role="assistant" />}
        </div>
      )}

      {/* 章节验收面板：出题 → 作答 → 批改 → 引导 */}
      {(quizing || quiz) && (
        <div ref={quizPanelRef}>
        <Card
          size="small"
          className="mt-3 bg-transparent"
          title={<span className="flex items-center gap-2 text-xs"><CheckCircleOutlined className="text-emerald-500" />章节验收{quiz?.phase === 'result' ? ` · 通过 ${quiz.items!.filter(i => i.pass).length}/${quiz.items!.length}` : ''}</span>}
          extra={quiz?.phase === 'answering' && <Button type="text" size="small" onClick={() => setQuiz(null)}>放弃</Button>}
        >
          {quizing && !quiz && (
            <div className="py-3 text-center text-xs text-text-muted">考官正在根据本章内容出验收题…</div>
          )}
          {quiz && quiz.phase !== 'result' && quiz.questions.map((question, index) => (
            <div key={index} className="mb-3 border-b border-border-subtle/40 pb-3 last:mb-0 last:border-0 last:pb-0">
              <div className="text-xs font-medium leading-5 text-text-primary">
                {index + 1}. {question.question}
                {question.keyPoint && <Tag className="ml-1.5 align-middle text-[10px]">{question.keyPoint}</Tag>}
              </div>
              <Input.TextArea
                className="mt-2"
                rows={2}
                autoFocus={index === 0}
                disabled={quiz.phase === 'grading'}
                value={quiz.answers[index] || ''}
                placeholder="你的回答（1-3 句话）"
                onChange={event => {
                  const value = event.target.value
                  setQuiz(prev => prev ? { ...prev, answers: prev.answers.map((a, i) => (i === index ? value : a)) } : prev)
                }}
              />
            </div>
          ))}
          {quiz?.phase === 'answering' && (
            <div className="mt-2 flex justify-end">
              <Button size="small" type="primary" onClick={submitQuiz}>提交批改</Button>
            </div>
          )}
          {quiz?.phase === 'grading' && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-text-muted">
              <LoadingOutlined />考官正在逐题批改…
              <Button size="small" danger icon={<StopOutlined />} onClick={stopCurrent}>停止</Button>
            </div>
          )}
          {quiz?.phase === 'result' && quiz.items && (
            <>
              {quiz.items.map((item, index) => (
                <div key={index} className="mb-3 flex items-start gap-1.5 last:mb-0">
                  {item.pass
                    ? <CheckCircleOutlined className="mt-0.5 flex-shrink-0 text-emerald-500" />
                    : <CloseCircleOutlined className="mt-0.5 flex-shrink-0 text-rose-500" />}
                  <div className="min-w-0">
                    <div className="text-xs font-medium leading-5 text-text-primary">{index + 1}. {item.question}</div>
                    {item.comment && <div className="mt-0.5 text-[11px] leading-5 text-text-muted">{item.comment}</div>}
                  </div>
                </div>
              ))}
              {quiz.guidance && quiz.guidance.length > 0 && (
                <div className="mt-2 border-t border-border-subtle/50 pt-2">
                  <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold text-text-faint">
                    <CompassOutlined className="text-amber-500" />推荐阅读路径（点击跳转）
                  </div>
                  {quiz.guidance.map((guide, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => onNavigate?.(guide)}
                      className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-border-subtle/60 bg-fill-secondary/40 px-2.5 py-1.5 text-left transition-colors last:mb-0 hover:border-emerald-400/60"
                    >
                      <span className="flex-shrink-0 text-xs font-medium text-text-primary">{guide.nodeTitle}</span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-text-faint">{guide.reason}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <Button size="small" onClick={() => setQuiz(null)}>结束验收</Button>
              </div>
            </>
          )}
        </Card>
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

      {/* 圈选浮动工具条：相对阅读器定位，随正文一起滚动 */}
      {showToolbar && toolbar && (
        <div
          className="absolute z-30 flex gap-1 rounded-lg border border-border-subtle bg-fill-primary p-1 shadow-lg"
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

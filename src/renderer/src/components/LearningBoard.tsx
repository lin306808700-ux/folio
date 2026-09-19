// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useMemo, useState } from 'react'
import { AimOutlined, FileTextOutlined } from '@ant-design/icons'
import {
  CURRENT_MARKER_COLOR, LEARNING_STATUS_META, LEARNING_STATUS_ORDER,
  type LearningStatus,
} from './learningStatus'

interface BoardNode {
  id: string
  parentId: string | null
  title: string
  status: LearningStatus
  hasContent?: boolean
}

interface Props {
  nodes: BoardNode[]
  currentNodeId?: string
  onNodeClick?: (nodeId: string) => void
  // 拖到另一列即改学习状态：看板的心智模型就是可以直接拖动
  onStatusChange?: (nodeId: string, status: LearningStatus) => void
}

function getPathTitle(nodes: BoardNode[], nodeId: string): string {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const path: string[] = []
  let cursor = byId.get(nodeId)
  const visited = new Set<string>()
  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor.title)
    visited.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  // 去掉根节点（与图谱标题重复），最多保留两级上级路径
  const trimmed = path.slice(1)
  return trimmed.length > 2 ? `… / ${trimmed.slice(-2).join(' / ')}` : trimmed.join(' / ')
}

export default function LearningBoard({ nodes, currentNodeId, onNodeClick, onStatusChange }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<LearningStatus | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<LearningStatus, BoardNode[]>()
    LEARNING_STATUS_ORDER.forEach(status => map.set(status, []))
    nodes.forEach(node => map.get(node.status)?.push(node))
    return map
  }, [nodes])

  const total = nodes.length || 1

  const dropTo = (status: LearningStatus, fallbackId?: string) => {
    const id = draggingId || fallbackId
    setDraggingId(null)
    setDragOverStatus(null)
    if (!id) return
    const node = nodes.find(item => item.id === id)
    if (!node || node.status === status) return
    onStatusChange?.(id, status)
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-4">
      {/* 掌握度总览 */}
      <div className="mb-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-border-subtle/40">
          {LEARNING_STATUS_ORDER.map(status => {
            const count = grouped.get(status)?.length || 0
            if (count === 0) return null
            return (
              <div
                key={status}
                style={{ width: `${(count / total) * 100}%`, backgroundColor: LEARNING_STATUS_META[status].color }}
                title={`${LEARNING_STATUS_META[status].label} ${count} 个`}
              />
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {LEARNING_STATUS_ORDER.map(status => (
            <span key={status} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEARNING_STATUS_META[status].color }} />
              {LEARNING_STATUS_META[status].label} {grouped.get(status)?.length || 0}
            </span>
          ))}
          <span className="text-[10px] text-text-faint">拖动卡片即可改学习状态</span>
        </div>
      </div>

      {/* 四列看板 */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3">
        {LEARNING_STATUS_ORDER.map(status => {
          const meta = LEARNING_STATUS_META[status]
          const columnNodes = grouped.get(status) || []
          const isDropTarget = Boolean(draggingId) && dragOverStatus === status
          return (
            <div
              key={status}
              className="flex min-h-0 flex-col rounded-xl border border-border-subtle/50 bg-bg-secondary/40 transition-colors"
              style={isDropTarget ? { borderColor: meta.color, background: `${meta.color}12` } : undefined}
              onDragOver={event => {
                // 必须 preventDefault 才允许落点；拖拽态还没同步时也可能先到
                event.preventDefault()
                setDragOverStatus(current => (current === status ? current : status))
              }}
              onDragLeave={event => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return
                setDragOverStatus(current => (current === status ? null : current))
              }}
              onDrop={event => {
                event.preventDefault()
                dropTo(status, event.dataTransfer.getData('text/plain'))
              }}
            >
              <div className="flex items-center gap-2 border-b border-border-subtle/40 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-xs font-semibold text-text-primary">{meta.label}</span>
                <span className="text-[10px] text-text-faint">{columnNodes.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 scroll-container">
                {columnNodes.length === 0 ? (
                  <div className="px-2 py-6 text-center text-[11px] text-text-faint">{meta.hint}</div>
                ) : columnNodes.map(node => {
                  const pathText = getPathTitle(nodes, node.id)
                  const isCurrent = node.id === currentNodeId
                  const draggable = Boolean(node.parentId)
                  return (
                    <button
                      key={node.id}
                      draggable={draggable}
                      onDragStart={event => {
                        if (!draggable) { event.preventDefault(); return }
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', node.id)
                        setDraggingId(node.id)
                      }}
                      onDragEnd={() => { setDraggingId(null); setDragOverStatus(null) }}
                      className="block w-full rounded-lg border border-border-subtle/60 bg-bg-primary px-3 py-2.5 text-left transition-all hover:border-border-primary hover:shadow-sm"
                      style={{
                        cursor: draggable ? 'grab' : 'pointer',
                        opacity: draggingId === node.id ? 0.4 : 1,
                        ...(isCurrent ? { borderColor: CURRENT_MARKER_COLOR, boxShadow: `inset 3px 0 0 ${CURRENT_MARKER_COLOR}` } : null),
                      }}
                      onClick={() => onNodeClick?.(node.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{node.title}</span>
                        {!node.hasContent && <FileTextOutlined className="shrink-0 text-[10px] text-text-faint" title="尚未撰写章节" />}
                        {isCurrent && <AimOutlined className="shrink-0 text-[11px]" style={{ color: CURRENT_MARKER_COLOR }} />}
                      </div>
                      {pathText && <div className="mt-1 truncate text-[10px] text-text-faint">{pathText}</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

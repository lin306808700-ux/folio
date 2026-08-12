import React, { useMemo } from 'react'
import { AimOutlined } from '@ant-design/icons'

type LearningStatus = 'unexplored' | 'learning' | 'understood' | 'verified'

interface BoardNode {
  id: string
  parentId: string | null
  title: string
  status: LearningStatus
}

interface Props {
  nodes: BoardNode[]
  currentNodeId?: string
  onNodeClick?: (nodeId: string) => void
}

const COLUMNS: { status: LearningStatus; label: string; color: string; hint: string }[] = [
  { status: 'unexplored', label: '未开始', color: '#94a3b8', hint: '待探索的知识领域' },
  { status: 'learning', label: '学习中', color: '#0ea5e9', hint: '正在啃的硬骨头' },
  { status: 'understood', label: '已理解', color: '#f59e0b', hint: '懂了，还差实践验证' },
  { status: 'verified', label: '已验证', color: '#10b981', hint: '有掌握证据的资产' },
]

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

export default function LearningBoard({ nodes, currentNodeId, onNodeClick }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<LearningStatus, BoardNode[]>()
    COLUMNS.forEach(col => map.set(col.status, []))
    nodes.forEach(node => map.get(node.status)?.push(node))
    return map
  }, [nodes])

  const total = nodes.length || 1

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-4">
      {/* 掌握度总览 */}
      <div className="mb-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-border-subtle/40">
          {COLUMNS.map(col => {
            const count = grouped.get(col.status)?.length || 0
            if (count === 0) return null
            return (
              <div
                key={col.status}
                style={{ width: `${(count / total) * 100}%`, backgroundColor: col.color }}
                title={`${col.label} ${count} 个`}
              />
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {COLUMNS.map(col => {
            const count = grouped.get(col.status)?.length || 0
            return (
              <span key={col.status} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} />
                {col.label} {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* 四列看板 */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3">
        {COLUMNS.map(col => {
          const columnNodes = grouped.get(col.status) || []
          return (
            <div key={col.status} className="flex min-h-0 flex-col rounded-xl border border-border-subtle/50 bg-bg-secondary/40">
              <div className="flex items-center gap-2 border-b border-border-subtle/40 px-3 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.color }} />
                <span className="text-xs font-semibold text-text-primary">{col.label}</span>
                <span className="text-[10px] text-text-faint">{columnNodes.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5 scroll-container">
                {columnNodes.length === 0 ? (
                  <div className="px-2 py-6 text-center text-[11px] text-text-faint">{col.hint}</div>
                ) : columnNodes.map(node => {
                  const pathText = getPathTitle(nodes, node.id)
                  const isCurrent = node.id === currentNodeId
                  return (
                    <button
                      key={node.id}
                      className="block w-full rounded-lg border border-border-subtle/60 bg-bg-primary px-3 py-2.5 text-left transition-all hover:border-border-primary hover:shadow-sm"
                      style={isCurrent ? { borderColor: col.color, boxShadow: `inset 3px 0 0 ${col.color}` } : undefined}
                      onClick={() => onNodeClick?.(node.id)}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{node.title}</span>
                        {isCurrent && <AimOutlined className="shrink-0 text-[11px] text-sky-500" />}
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

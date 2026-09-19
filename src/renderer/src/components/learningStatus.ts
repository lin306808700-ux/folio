// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

// 学习状态的唯一定义源：知识树、知识结构导图、进度看板、状态图例、抽屉共用。
// 以前三处各写一份，语义和颜色很容易漂移。

export type LearningStatus = 'unexplored' | 'learning' | 'understood' | 'verified'

export interface LearningStatusMeta {
  label: string
  // 状态色：图谱圆点 / 看板列头 / 图例
  color: string
  // antd Tag 语义色（状态图例）
  tag: string
  hint: string
  rank: number
}

// 「当前位置」是位置标记而非学习状态，必须和使用状态色区分开，
// 否则导图里一个「学习中」节点和当前位置节点在视觉上分不开。
export const CURRENT_MARKER_COLOR = '#7c3aed'

export const LEARNING_STATUS_META: Record<LearningStatus, LearningStatusMeta> = {
  unexplored: { label: '未开始', color: '#94a3b8', tag: 'default', hint: '待探索的知识领域', rank: 0 },
  learning: { label: '学习中', color: '#2563eb', tag: 'processing', hint: '正在啃的硬骨头', rank: 1 },
  understood: { label: '已理解', color: '#f59e0b', tag: 'warning', hint: '懂了，还差实践验证', rank: 2 },
  verified: { label: '已验证', color: '#10b981', tag: 'success', hint: '有掌握证据的资产', rank: 3 },
}

export const LEARNING_STATUS_ORDER: LearningStatus[] = ['unexplored', 'learning', 'understood', 'verified']

export function statusMeta(status: LearningStatus | undefined): LearningStatusMeta {
  return (status && LEARNING_STATUS_META[status]) || LEARNING_STATUS_META.unexplored
}

export function statusLabel(status: LearningStatus | undefined): string {
  return statusMeta(status).label
}

// 已理解口径：单独算，不把「已验证」并进来，否则和状态图例自相矛盾
export function countByStatus(nodes: { status: LearningStatus }[]) {
  const counts: Record<LearningStatus, number> = { unexplored: 0, learning: 0, understood: 0, verified: 0 }
  nodes.forEach(node => { counts[node.status] = (counts[node.status] || 0) + 1 })
  return counts
}

// 「已验证」的来源标签，让这个状态的含金量可见
export function verifiedSourceLabel(verifiedBy?: string): string {
  if (verifiedBy === 'quiz') return '章节验收通过'
  if (verifiedBy === 'manual') return '手动标记'
  return '未记录依据'
}

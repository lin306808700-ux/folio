// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React from 'react'
import { SearchReplaceCard } from '../parts/SearchReplaceCard'
import { InlineDiffView, searchReplaceToFileDiffs } from './InlineDiffView'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** search_replace 类型消息渲染 — 使用 InlineDiffView 替代旧的纯文本对比 */
export function SearchReplaceContent() {
  const { msg } = useMessageBubbleContext()

  if (msg.type !== 'search_replace' || !msg.searchReplaceData) return null

  const diffs = searchReplaceToFileDiffs(msg.searchReplaceData)

  // 有结构化变更数据时用 InlineDiffView，否则降级到旧卡片
  if (diffs.length > 0 && diffs.some(d => d.hunks.length > 0)) {
    return <InlineDiffView diffs={diffs} />
  }

  return <SearchReplaceCard data={msg.searchReplaceData} />
}

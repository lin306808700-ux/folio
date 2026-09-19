// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useMemo } from 'react'
import { Check, X, FileCode, ChevronDown, ChevronRight, Copy } from 'lucide-react'

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

interface FileDiff {
  filename: string
  filepath: string
  hunks: DiffLine[]
  applied?: boolean
  rejected?: boolean
}

interface InlineDiffViewProps {
  diffs: FileDiff[]
  onAccept?: (filepath: string) => void
  onReject?: (filepath: string) => void
  onAcceptAll?: () => void
}

/** 计算简单的行级 diff */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: DiffLine[] = []

  // 简单 LCS diff（O(n*m) — 对小文件足够）
  const lcs = computeLCS(oldLines, newLines)
  let oi = 0, ni = 0, li = 0
  let oldLineNo = 1, newLineNo = 1

  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      result.push({ type: 'unchanged', content: oldLines[oi], oldLineNo: oldLineNo++, newLineNo: newLineNo++ })
      oi++; ni++; li++
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      result.push({ type: 'removed', content: oldLines[oi], oldLineNo: oldLineNo++ })
      oi++
    } else if (ni < newLines.length) {
      result.push({ type: 'added', content: newLines[ni], newLineNo: newLineNo++ })
      ni++
    }
  }
  return result
}

/** 最长公共子序列 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length
  // 优化：对大文件只做头尾匹配
  if (m > 500 || n > 500) {
    const result: string[] = []
    let ai = 0, bi = 0
    while (ai < m && bi < n && a[ai] === b[bi]) { result.push(a[ai]); ai++; bi++ }
    let ae = m - 1, be = n - 1
    const tail: string[] = []
    while (ae > ai && be > bi && a[ae] === b[be]) { tail.unshift(a[ae]); ae--; be-- }
    return [...result, ...tail]
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const result: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { result.unshift(a[i - 1]); i--; j-- }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--
    else j--
  }
  return result
}

/** Inline Diff 预览 — 对标 Claude Code 的 diff 高亮体验 */
export function InlineDiffView({ diffs, onAccept, onReject, onAcceptAll }: InlineDiffViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set(diffs.map(d => d.filepath)))

  const toggleFile = (filepath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      next.has(filepath) ? next.delete(filepath) : next.add(filepath)
      return next
    })
  }

  const stats = useMemo(() => {
    let added = 0, removed = 0
    diffs.forEach(d => d.hunks.forEach(h => {
      if (h.type === 'added') added++
      if (h.type === 'removed') removed++
    }))
    return { added, removed, files: diffs.length }
  }, [diffs])

  return (
    <div className="my-3 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
      {/* 头部统计 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-slate-700">{stats.files} 个文件变更</span>
          <span className="text-emerald-600 font-mono">+{stats.added}</span>
          <span className="text-red-500 font-mono">-{stats.removed}</span>
        </div>
        {onAcceptAll && (
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors active:scale-95"
          >
            <Check size={12} /> 全部接受
          </button>
        )}
      </div>

      {/* 文件列表 */}
      <div className="divide-y divide-slate-100">
        {diffs.map(diff => {
          const isExpanded = expandedFiles.has(diff.filepath)
          const fileAdded = diff.hunks.filter(h => h.type === 'added').length
          const fileRemoved = diff.hunks.filter(h => h.type === 'removed').length

          return (
            <div key={diff.filepath} className={diff.applied ? 'opacity-60' : ''}>
              {/* 文件头 */}
              <div
                onClick={() => toggleFile(diff.filepath)}
                className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <FileCode size={14} className="text-slate-500" />
                <span className="text-sm font-mono text-slate-700 truncate flex-1">{diff.filename}</span>
                <span className="text-xs text-emerald-600 font-mono">+{fileAdded}</span>
                <span className="text-xs text-red-500 font-mono ml-1">-{fileRemoved}</span>
                {/* 操作按钮 */}
                {!diff.applied && !diff.rejected && onAccept && (
                  <div className="flex items-center gap-1 ml-3" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => onAccept(diff.filepath)}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                      title="接受变更"
                    >
                      <Check size={14} />
                    </button>
                    {onReject && (
                      <button
                        onClick={() => onReject(diff.filepath)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="拒绝变更"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}
                {diff.applied && <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">已接受</span>}
                {diff.rejected && <span className="text-xs text-red-500 bg-red-50 px-2 py-0.5 rounded-full">已拒绝</span>}
              </div>

              {/* Diff 内容 */}
              {isExpanded && (
                <div className="bg-slate-900 overflow-x-auto text-xs font-mono leading-5">
                  {diff.hunks.map((line, idx) => (
                    <div
                      key={idx}
                      className={`flex ${
                        line.type === 'added' ? 'bg-emerald-950/40' :
                        line.type === 'removed' ? 'bg-red-950/40' : ''
                      }`}
                    >
                      {/* 行号 */}
                      <div className="flex-shrink-0 w-[72px] flex text-slate-600 select-none border-r border-slate-800">
                        <span className="w-9 text-right pr-1">{line.oldLineNo || ''}</span>
                        <span className="w-9 text-right pr-1">{line.newLineNo || ''}</span>
                      </div>
                      {/* 标记 */}
                      <span className={`flex-shrink-0 w-5 text-center select-none ${
                        line.type === 'added' ? 'text-emerald-400' :
                        line.type === 'removed' ? 'text-red-400' : 'text-slate-700'
                      }`}>
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      {/* 代码 */}
                      <span className={`flex-1 whitespace-pre-wrap break-all pr-4 ${
                        line.type === 'added' ? 'text-emerald-300' :
                        line.type === 'removed' ? 'text-red-300' : 'text-slate-300'
                      }`}>
                        {line.content}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 从 SearchReplaceData 转为 FileDiff 格式 */
export function searchReplaceToFileDiffs(data: { fileChanges: Array<{ file: string; filename: string; changes?: Array<{ search: string; replace: string }> }> }): FileDiff[] {
  return data.fileChanges.map(fc => {
    const hunks: DiffLine[] = []
    if (fc.changes) {
      fc.changes.forEach(change => {
        computeLineDiff(change.search, change.replace).forEach(line => hunks.push(line))
        // 分隔不同 hunk
        hunks.push({ type: 'unchanged', content: '···' })
      })
    }
    return {
      filename: fc.filename,
      filepath: fc.file,
      hunks: hunks.slice(0, -1), // 去掉最后的分隔
    }
  })
}

export { computeLineDiff }
export type { FileDiff, DiffLine }

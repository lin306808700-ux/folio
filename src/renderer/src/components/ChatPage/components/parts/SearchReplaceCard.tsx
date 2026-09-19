import React, { useState } from 'react'
import { CheckCircle, AlertCircle, ChevronDown, ChevronRight, FileCode } from 'lucide-react'
import type { SearchReplaceData } from '../../types'

/** 截断过长的代码预览，保留前后各若干行 */
function truncateCodePreview(code: string, maxLines = 15): string {
  const lines = code.split('\n')
  if (lines.length <= maxLines) return code
  const headCount = Math.ceil(maxLines / 2)
  const tailCount = Math.floor(maxLines / 2)
  const omitted = lines.length - headCount - tailCount
  return [
    ...lines.slice(0, headCount),
    `... 省略 ${omitted} 行 ...`,
    ...lines.slice(-tailCount)
  ].join('\n')
}

/** 代码变更结果卡片 — 展示 Search & Replace 的文件变更详情 */
export function SearchReplaceCard({ data }: {
  data: SearchReplaceData
}) {
  const [expandedFiles, setExpandedFiles] = useState<Record<number, boolean>>({})

  const toggleFile = (index: number) => {
    setExpandedFiles(prev => ({ ...prev, [index]: !prev[index] }))
  }

  return (
    <div className="mt-3 p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <CheckCircle size={16} className={data.allSuccess ? 'text-emerald-400' : 'text-amber-400'} />
        代码变更 {data.allSuccess ? '已全部应用' : '部分应用'}
      </div>

      {/* 文件列表 */}
      <div className="space-y-2">
        {data.fileChanges.map((fileChange, fileIndex) => {
          const isExpanded = expandedFiles[fileIndex] ?? false
          const hasChanges = fileChange.changes && fileChange.changes.length > 0

          return (
            <div key={fileIndex} className="rounded-lg overflow-hidden border border-slate-600/50">
              {/* 文件头 — 可点击展开/收起 */}
              <button
                onClick={() => hasChanges && toggleFile(fileIndex)}
                className={`w-full flex items-center gap-2 px-3 py-2 bg-slate-700/50 text-left transition-colors ${hasChanges ? 'hover:bg-slate-700 cursor-pointer' : 'cursor-default'}`}
              >
                {hasChanges ? (
                  isExpanded
                    ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                    : <ChevronRight size={14} className="text-slate-400 shrink-0" />
                ) : (
                  <span className={`w-2 h-2 rounded-full shrink-0 ${fileChange.changesApplied === fileChange.changesTotal ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                )}
                <FileCode size={14} className="text-slate-400 shrink-0" />
                <span className="text-sm font-mono text-slate-300 truncate" title={fileChange.file}>
                  {fileChange.filename}
                </span>
                <span className="ml-auto text-xs text-slate-400 shrink-0">
                  {fileChange.changesApplied}/{fileChange.changesTotal} 处变更
                </span>
              </button>

              {/* 展开的变更详情 */}
              {isExpanded && hasChanges && (
                <div className="border-t border-slate-600/50">
                  {fileChange.changes!.map((change, changeIndex) => (
                    <div key={changeIndex} className="border-b border-slate-700/50 last:border-b-0">
                      {/* 删除的内容（search） */}
                      <div className="relative">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500/60" />
                        <pre className="pl-4 pr-3 py-2 text-xs font-mono text-red-300/90 bg-red-950/30 overflow-x-auto whitespace-pre-wrap break-all">
                          <code>{truncateCodePreview(change.search)}</code>
                        </pre>
                      </div>
                      {/* 新增的内容（replace） */}
                      <div className="relative">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500/60" />
                        <pre className="pl-4 pr-3 py-2 text-xs font-mono text-emerald-300/90 bg-emerald-950/30 overflow-x-auto whitespace-pre-wrap break-all">
                          <code>{truncateCodePreview(change.replace)}</code>
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 错误信息 */}
      {data.errors.length > 0 && (
        <div className="space-y-1">
          {data.errors.map((err, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs text-red-400">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

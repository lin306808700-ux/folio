import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileEdit, FilePlus, FileSearch, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'

interface FileOperation {
  path: string
  filename: string
  operation: 'write' | 'edit' | 'read' | 'delete'
}

interface FileOpsSummaryProps {
  content: string
  isStreaming?: boolean
  isElectron?: boolean
}

/**
 * 从 AI 响应内容中解析文件操作
 */
function parseFileOperations(content: string): FileOperation[] {
  const operations: FileOperation[] = []
  const seenPaths = new Set<string>()

  // SEARCH_REPLACE 格式: {"file":"path","changes":[...]}
  const searchReplacePattern = /SEARCH_REPLACE:\s*\n?\s*\{[^}]*"file"\s*:\s*"([^"]+)"/g
  let match: RegExpExecArray | null
  while ((match = searchReplacePattern.exec(content)) !== null) {
    const filePath = match[1]
    if (!seenPaths.has(filePath)) {
      seenPaths.add(filePath)
      operations.push({ path: filePath, filename: extractFilename(filePath), operation: 'edit' })
    }
  }

  // SCRIPT_BLOCK 格式: {"lang":"...","description":"...","content":"..."}
  const scriptPattern = /SCRIPT_BLOCK:\s*\n?\s*\{[^}]*"description"\s*:\s*"([^"]+)"/g
  while ((match = scriptPattern.exec(content)) !== null) {
    const description = match[1]
    if (!seenPaths.has(`script:${description}`)) {
      seenPaths.add(`script:${description}`)
      operations.push({ path: description, filename: description, operation: 'write' })
    }
  }

  // MUSE_TASK 中的文件操作提示
  const museFilePattern = /(?:创建|生成|写入|修改|编辑|更新)\s*(?:文件)?\s*[`"]?([^\s`"]+\.\w{1,6})[`"]?/g
  while ((match = museFilePattern.exec(content)) !== null) {
    const filePath = match[1]
    if (!seenPaths.has(filePath) && filePath.includes('.')) {
      seenPaths.add(filePath)
      const isEdit = /修改|编辑|更新/.test(match[0])
      operations.push({ path: filePath, filename: extractFilename(filePath), operation: isEdit ? 'edit' : 'write' })
    }
  }

  // 代码块中的文件路径注释 (// filepath: xxx 或 /* filepath: xxx */)
  const codeFilePattern = /```\w*\s*\n\s*(?:\/\/|#|\/\*)\s*(?:file(?:path)?|File)\s*:\s*([^\n*]+)/g
  while ((match = codeFilePattern.exec(content)) !== null) {
    const filePath = match[1].trim()
    if (!seenPaths.has(filePath)) {
      seenPaths.add(filePath)
      operations.push({ path: filePath, filename: extractFilename(filePath), operation: 'write' })
    }
  }

  return operations
}

function extractFilename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || filePath
}

const operationConfig = {
  write: { icon: FilePlus, label: 'Write', color: 'text-emerald-600 dark:text-emerald-400', badgeBg: 'bg-emerald-500/10 dark:bg-emerald-500/20' },
  edit: { icon: FileEdit, label: 'Edit', color: 'text-blue-600 dark:text-blue-400', badgeBg: 'bg-blue-500/10 dark:bg-blue-500/20' },
  read: { icon: FileSearch, label: 'Read', color: 'text-slate-500 dark:text-slate-400', badgeBg: 'bg-slate-500/10 dark:bg-slate-500/20' },
  delete: { icon: FileEdit, label: 'Delete', color: 'text-red-600 dark:text-red-400', badgeBg: 'bg-red-500/10 dark:bg-red-500/20' },
}

export function FileOpsSummary({ content, isStreaming, isElectron }: FileOpsSummaryProps) {
  const [expanded, setExpanded] = useState(false)
  const [userToggled, setUserToggled] = useState(false)

  const operations = useMemo(() => parseFileOperations(content), [content])

  // 统计各类操作数（必须在 early return 之前调用，保证 hooks 顺序稳定）
  const counts = useMemo(() => {
    const result: Record<string, number> = {}
    for (const op of operations) {
      result[op.operation] = (result[op.operation] || 0) + 1
    }
    return result
  }, [operations])

  // 无文件操作时不渲染
  if (operations.length === 0) return null

  // 流式结束后自动展开（如果用户没有手动折叠）
  const shouldExpand = expanded || (!isStreaming && !userToggled && operations.length <= 5)

  const handleToggle = () => {
    setExpanded(!shouldExpand)
    setUserToggled(true)
  }

  const handleOpenInFinder = (filePath: string) => {
    if (!isElectron) return
    const windowApi = window as any
    windowApi.electronAPI?.shell?.showItemInFolder?.(filePath)
  }

  return (
    <div className="mb-2 rounded-lg border border-border-subtle/50 dark:border-slate-700/50 bg-surface/50 dark:bg-slate-800/30 overflow-hidden">
      {/* 紧凑摘要栏 */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted dark:text-slate-400 hover:text-text-primary dark:hover:text-slate-300 transition-colors"
      >
        {shouldExpand ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">文件操作</span>
        <div className="flex items-center gap-1.5 ml-1">
          {Object.entries(counts).map(([operation, count]) => {
            const config = operationConfig[operation as keyof typeof operationConfig]
            if (!config) return null
            return (
              <span key={operation} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${config.badgeBg} ${config.color}`}>
                {config.label} {count}
              </span>
            )
          })}
        </div>
        {isStreaming && (
          <span className="ml-auto text-text-faint dark:text-slate-500 animate-pulse">扫描中…</span>
        )}
      </button>

      {/* 展开的文件列表 */}
      <AnimatePresence>
        {shouldExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-subtle/50 dark:border-slate-700/50 px-3 py-1">
              {operations.map((op, index) => {
                const config = operationConfig[op.operation]
                const OperationIcon = config.icon
                return (
                  <div key={`${op.path}-${index}`} className="flex items-center gap-2 py-1 group">
                    <span className={`flex-shrink-0 ${config.color}`}>
                      <OperationIcon size={12} />
                    </span>
                    <span className={`text-xs px-1 py-0 rounded ${config.badgeBg} ${config.color} font-mono`}>
                      {config.label[0]}
                    </span>
                    <span className="text-xs text-text-primary dark:text-slate-300 truncate flex-1 font-mono" title={op.path}>
                      {op.filename}
                    </span>
                    {isElectron && op.path.startsWith('/') && (
                      <button
                        onClick={() => handleOpenInFinder(op.path)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-faint dark:text-slate-500 hover:text-text-primary dark:hover:text-slate-300"
                        title="在 Finder 中打开"
                      >
                        <FolderOpen size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

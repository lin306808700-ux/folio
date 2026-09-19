import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { FolderOpen, File, FileCode, FileText, Image, ChevronRight, ChevronDown, RefreshCw, Search, ArrowLeft } from 'lucide-react'

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  extension?: string
}

interface FileBrowserPanelProps {
  workspacePath?: string
  isElectron: boolean
  onOpenFile?: (filePath: string) => void
}

const EXTENSION_ICONS: Record<string, React.ReactNode> = {
  ts: <FileCode size={13} className="text-blue-400" />,
  tsx: <FileCode size={13} className="text-blue-400" />,
  js: <FileCode size={13} className="text-yellow-400" />,
  jsx: <FileCode size={13} className="text-yellow-400" />,
  json: <FileCode size={13} className="text-amber-500" />,
  html: <FileCode size={13} className="text-orange-400" />,
  css: <FileCode size={13} className="text-sky-400" />,
  scss: <FileCode size={13} className="text-pink-400" />,
  md: <FileText size={13} className="text-slate-400" />,
  py: <FileCode size={13} className="text-green-400" />,
  sh: <FileCode size={13} className="text-emerald-400" />,
  png: <Image size={13} className="text-purple-400" />,
  jpg: <Image size={13} className="text-purple-400" />,
  jpeg: <Image size={13} className="text-purple-400" />,
  svg: <Image size={13} className="text-purple-400" />,
  gif: <Image size={13} className="text-purple-400" />,
}

function getFileIcon(entry: FileEntry): React.ReactNode {
  if (entry.isDirectory) return <FolderOpen size={13} className="text-amber-500/80" />
  const ext = entry.extension?.toLowerCase() || ''
  return EXTENSION_ICONS[ext] || <File size={13} className="text-slate-500" />
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

export function FileBrowserPanel({ isElectron, onOpenFile }: FileBrowserPanelProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [currentDir, setCurrentDir] = useState<string>('')
  const [rootDir, setRootDir] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const loadFiles = useCallback(async (dirPath?: string) => {
    if (!isElectron) return
    setLoading(true)
    setError(null)
    try {
      const api = (window as any).electronAPI
      const result = await api?.workspace?.listDir?.(dirPath)
      if (result?.success) {
        setFiles(result.files || [])
        setCurrentDir(result.currentDir || '')
        if (!rootDir) setRootDir(result.currentDir || '')
      } else {
        setError(result?.error || '无法读取文件列表')
      }
    } catch {
      setError('读取文件列表失败')
    } finally {
      setLoading(false)
    }
  }, [isElectron, rootDir])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files
    const query = searchQuery.toLowerCase()
    return files.filter(f => f.name.toLowerCase().includes(query))
  }, [files, searchQuery])

  const sortedFiles = useMemo(() => {
    return [...filteredFiles].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [filteredFiles])

  const canGoUp = currentDir && currentDir !== rootDir

  const handleNavigate = useCallback((entry: FileEntry) => {
    if (entry.isDirectory) {
      setSearchQuery('')
      loadFiles(entry.path)
    } else {
      onOpenFile?.(entry.path)
    }
  }, [loadFiles, onOpenFile])

  const handleGoUp = useCallback(() => {
    if (!canGoUp) return
    const parentDir = currentDir.replace(/\/[^/]+\/?$/, '') || rootDir
    setSearchQuery('')
    loadFiles(parentDir)
  }, [canGoUp, currentDir, rootDir, loadFiles])

  const dirName = currentDir ? currentDir.split('/').pop() || '/' : '项目'

  if (!isElectron) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted dark:text-slate-500 text-sm p-8 text-center">
        <div>
          <FolderOpen size={36} className="mx-auto mb-3 opacity-20" />
          <p>文件浏览仅在桌面端可用</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 路径栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/40 dark:border-white/[0.05]">
        {canGoUp && (
          <button
            onClick={handleGoUp}
            className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted dark:text-slate-600 dark:hover:text-slate-400 hover:bg-surface/60 dark:hover:bg-white/[0.06] transition-colors"
            title="返回上级"
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <div className="flex items-center gap-1 text-[11px] text-text-muted dark:text-slate-500 font-mono truncate flex-1 min-w-0">
          <FolderOpen size={11} className="text-amber-500/60 flex-shrink-0" />
          <span className="truncate">{dirName}</span>
        </div>
        <button
          onClick={() => loadFiles(currentDir || undefined)}
          className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
          title="刷新"
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 搜索框 */}
      <div className="px-3 py-1.5 border-b border-border-subtle/30 dark:border-white/[0.04]">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-surface/40 dark:bg-white/[0.03] rounded-md border border-border-subtle/40 dark:border-white/[0.05]">
          <Search size={11} className="text-text-faint dark:text-slate-600 flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            className="flex-1 bg-transparent text-[11px] text-text-primary dark:text-white placeholder:text-text-faint/50 dark:placeholder:text-slate-700 outline-none"
          />
          {searchQuery && (
            <span className="text-[9px] text-text-faint dark:text-slate-600">{filteredFiles.length}</span>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 text-[11px] text-red-400 bg-red-500/5">{error}</div>
      )}

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto scroll-dark">
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-text-faint dark:text-slate-600 text-[11px]">
            <RefreshCw size={14} className="animate-spin mr-2" />
            加载中...
          </div>
        ) : sortedFiles.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-text-faint dark:text-slate-600 text-[11px]">
            {searchQuery ? '无匹配文件' : '空目录'}
          </div>
        ) : (
          <div className="py-1">
            {sortedFiles.map((entry) => (
              <button
                key={entry.path}
                onClick={() => handleNavigate(entry)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface/60 dark:hover:bg-white/[0.04] transition-colors group"
              >
                <span className="flex-shrink-0">{getFileIcon(entry)}</span>
                <span className={`text-[12px] truncate flex-1 min-w-0 ${
                  entry.isDirectory
                    ? 'text-text-primary dark:text-white/80 font-medium'
                    : 'text-text-secondary dark:text-slate-400'
                }`}>
                  {entry.name}
                </span>
                {entry.isDirectory ? (
                  <ChevronRight size={11} className="text-text-faint/50 dark:text-slate-700 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                ) : (
                  <span className="text-[9px] text-text-faint/40 dark:text-slate-700 font-mono flex-shrink-0">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-3 py-1.5 border-t border-border-subtle/30 dark:border-white/[0.04] text-[10px] text-text-faint/60 dark:text-slate-700 font-mono">
        {files.filter(f => f.isDirectory).length} 目录 · {files.filter(f => !f.isDirectory).length} 文件
      </div>
    </div>
  )
}

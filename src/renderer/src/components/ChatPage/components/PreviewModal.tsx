import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Eye, Code2, ZoomIn, ZoomOut, RotateCcw,
  Download, Copy, Check, Maximize2, Minimize2
} from 'lucide-react'
import type { Artifact } from '../types'

interface PreviewModalProps {
  artifact: Artifact
  onClose: () => void
}

type TabId = 'preview' | 'source'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/** 移除 SVG 中的脚本与事件属性 */
function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

export function PreviewModal({ artifact, onClose }: PreviewModalProps) {
  const hasSource = artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'code' || artifact.type === 'markdown'
  const [activeTab, setActiveTab] = useState<TabId>('preview')
  const [zoom, setZoom] = useState(1)
  const [copied, setCopied] = useState(false)
  const [fitMode, setFitMode] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const zoomIn = useCallback(() => {
    setFitMode(false)
    setZoom(current => {
      const nextStep = ZOOM_STEPS.find(s => s > current)
      return nextStep || current
    })
  }, [])

  const zoomOut = useCallback(() => {
    setFitMode(false)
    setZoom(current => {
      const prevStep = [...ZOOM_STEPS].reverse().find(s => s < current)
      return prevStep || current
    })
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
    setFitMode(true)
  }, [])

  const handleCopy = useCallback(() => {
    const text = artifact.content || artifact.src || ''
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [artifact])

  const handleDownload = useCallback(() => {
    const content = artifact.content || ''
    if (!content) return

    const extensionMap: Record<string, string> = {
      html: 'html', svg: 'svg', code: artifact.language || 'txt', markdown: 'md',
    }
    const extension = extensionMap[artifact.type] || 'txt'
    const filename = `${artifact.title || 'artifact'}.${extension}`
    const mimeMap: Record<string, string> = {
      html: 'text/html', svg: 'image/svg+xml', code: 'text/plain', markdown: 'text/markdown',
    }
    const mime = mimeMap[artifact.type] || 'text/plain'

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }, [artifact])

  const sourceContent = artifact.content || artifact.src || ''

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700/60 flex flex-col"
          style={{ width: 'min(95vw, 1200px)', height: 'min(90vh, 860px)' }}
          onClick={event => event.stopPropagation()}
        >
          {/* 顶部工具栏 */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/60 flex-shrink-0">
            {/* 标题 */}
            <span className="text-sm font-medium text-slate-200 truncate max-w-[300px]">
              {artifact.title || '预览'}
            </span>
            <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-700/60 uppercase">
              {artifact.type}
            </span>

            {/* 标签页切换 */}
            {hasSource && (
              <div className="flex items-center ml-4 bg-slate-700/40 rounded-lg p-0.5">
                <TabButton
                  active={activeTab === 'preview'}
                  onClick={() => setActiveTab('preview')}
                  icon={<Eye size={12} />}
                  label="预览"
                />
                <TabButton
                  active={activeTab === 'source'}
                  onClick={() => setActiveTab('source')}
                  icon={<Code2 size={12} />}
                  label="源码"
                />
              </div>
            )}

            <div className="flex-1" />

            {/* 缩放控制（仅预览模式） */}
            {activeTab === 'preview' && (artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'image') && (
              <div className="flex items-center gap-1 mr-2">
                <ToolbarButton onClick={zoomOut} icon={<ZoomOut size={14} />} title="缩小" />
                <button
                  onClick={resetZoom}
                  className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 rounded transition-colors min-w-[48px] text-center"
                  title="重置缩放"
                >
                  {fitMode ? 'Fit' : `${Math.round(zoom * 100)}%`}
                </button>
                <ToolbarButton onClick={zoomIn} icon={<ZoomIn size={14} />} title="放大" />
                <ToolbarButton
                  onClick={() => setFitMode(!fitMode)}
                  icon={fitMode ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
                  title={fitMode ? '实际大小' : '适应窗口'}
                />
              </div>
            )}

            {/* 操作按钮 */}
            <ToolbarButton onClick={handleCopy} icon={copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />} title="复制源码" />
            {hasSource && <ToolbarButton onClick={handleDownload} icon={<Download size={14} />} title="下载" />}
            <div className="w-px h-5 bg-slate-700 mx-1" />
            <ToolbarButton onClick={onClose} icon={<X size={15} />} title="关闭 (Esc)" />
          </div>

          {/* 内容区 */}
          <div ref={containerRef} className="flex-1 overflow-auto bg-slate-950">
            {activeTab === 'preview' ? (
              <PreviewPane artifact={artifact} zoom={zoom} fitMode={fitMode} />
            ) : (
              <SourcePane content={sourceContent} language={artifact.language || artifact.type} />
            )}
          </div>

          {/* 底部状态栏 */}
          <div className="flex items-center px-4 py-1.5 bg-slate-800/60 border-t border-slate-700/40 text-[10px] text-slate-500 flex-shrink-0 gap-4">
            {artifact.language && <span>语言: {artifact.language}</span>}
            {sourceContent && <span>{sourceContent.length.toLocaleString()} 字符</span>}
            {sourceContent && <span>{sourceContent.split('\n').length} 行</span>}
            <span className="ml-auto">Esc 关闭 · ⌘C 复制</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

/** 标签页按钮 */
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
        active
          ? 'bg-slate-600/60 text-slate-100 shadow-sm'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

/** 工具栏图标按钮 */
function ToolbarButton({ onClick, icon, title }: { onClick: () => void; icon: React.ReactNode; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
    >
      {icon}
    </button>
  )
}

/** 预览面板 */
function PreviewPane({ artifact, zoom, fitMode }: { artifact: Artifact; zoom: number; fitMode: boolean }) {
  switch (artifact.type) {
    case 'html':
      return (
        <div className="w-full h-full" style={fitMode ? undefined : { transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <iframe
            title="preview-html"
            srcDoc={artifact.content || ''}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0 bg-white"
          />
        </div>
      )

    case 'svg':
      return (
        <div
          className="w-full h-full flex items-center justify-center overflow-auto p-6"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        >
          <div
            style={fitMode ? { maxWidth: '100%', maxHeight: '100%' } : { transform: `scale(${zoom})`, transformOrigin: 'center' }}
            dangerouslySetInnerHTML={{ __html: sanitizeSvg(artifact.content || '') }}
          />
        </div>
      )

    case 'image':
      return (
        <div
          className="w-full h-full flex items-center justify-center overflow-auto p-6"
          style={{
            backgroundImage: 'linear-gradient(45deg, #1e293b 25%, transparent 25%), linear-gradient(-45deg, #1e293b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e293b 75%), linear-gradient(-45deg, transparent 75%, #1e293b 75%)',
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          }}
        >
          <img
            src={artifact.src}
            alt={artifact.title || 'image'}
            style={fitMode ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } : { transform: `scale(${zoom})`, transformOrigin: 'center' }}
            className="rounded-lg shadow-lg"
          />
        </div>
      )

    case 'code':
      return (
        <pre className="p-4 text-[13px] leading-relaxed text-slate-100 font-mono whitespace-pre overflow-auto h-full">
          <code>{artifact.content}</code>
        </pre>
      )

    case 'markdown':
      return (
        <div className="p-6 prose prose-invert prose-sm max-w-none">
          <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200">{artifact.content}</pre>
        </div>
      )

    default:
      return (
        <div className="p-6 text-sm text-slate-400">
          暂不支持预览此类型的产物（{artifact.type}）
        </div>
      )
  }
}

/** 源码面板 — 带行号 */
function SourcePane({ content, language }: { content: string; language: string }) {
  const lines = content.split('\n')
  const gutterWidth = String(lines.length).length

  return (
    <div className="flex h-full font-mono text-[12px] leading-[1.6]">
      {/* 行号 */}
      <div className="flex-shrink-0 py-3 pr-3 pl-4 text-right text-slate-600 select-none border-r border-slate-800 bg-slate-950">
        {lines.map((_, index) => (
          <div key={index} style={{ minWidth: `${gutterWidth}ch` }}>
            {index + 1}
          </div>
        ))}
      </div>
      {/* 代码 */}
      <div className="flex-1 py-3 pl-4 pr-6 overflow-auto text-slate-200">
        <pre className="whitespace-pre">
          {lines.map((line, index) => (
            <div key={index} className="hover:bg-slate-800/40 transition-colors">{line || '\u00A0'}</div>
          ))}
        </pre>
      </div>
      {/* 语言标签 */}
      <div className="absolute top-3 right-4 text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase">
        {language}
      </div>
    </div>
  )
}

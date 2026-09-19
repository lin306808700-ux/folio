import React, { useState, useRef, useMemo, useEffect } from 'react'
import {
  Code2, FileImage, Globe, Shapes, FileText, BarChart2,
  ClipboardList, ChevronDown, Copy, Check, Maximize2, FolderOpen, Download,
} from 'lucide-react'
import { PreviewModal } from './PreviewModal'
import type { Artifact, ArtifactType } from '../types'

interface ArtifactRendererProps {
  artifact: Artifact
  /** form 类型需要回传提交值 */
  onFormSubmit?: (artifactId: string, values: Record<string, any>) => void
}

const TYPE_META: Record<ArtifactType, { icon: React.ReactNode; label: string; defaultHeight: number }> = {
  html: { icon: <Globe size={13} />, label: 'HTML', defaultHeight: 320 },
  svg: { icon: <Shapes size={13} />, label: 'SVG', defaultHeight: 280 },
  image: { icon: <FileImage size={13} />, label: '图片', defaultHeight: 0 },
  code: { icon: <Code2 size={13} />, label: '代码', defaultHeight: 0 },
  chart: { icon: <BarChart2 size={13} />, label: '图表', defaultHeight: 0 },
  form: { icon: <ClipboardList size={13} />, label: '表单', defaultHeight: 0 },
  markdown: { icon: <FileText size={13} />, label: '文档', defaultHeight: 0 },
}

/** 移除 SVG 中的脚本与事件属性，防止注入 */
function sanitizeSvg(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

/** 统一产物渲染器 — 按 type 分发到具体渲染子组件 */
export function ArtifactRenderer({ artifact, onFormSubmit }: ArtifactRendererProps) {
  const meta = TYPE_META[artifact.type] || TYPE_META.code
  const [collapsed, setCollapsed] = useState(!!artifact.collapsed)
  const [copied, setCopied] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const copyText = useMemo(() => artifact.content || artifact.src || '', [artifact])

  function handleCopy() {
    if (!copyText) return
    navigator.clipboard?.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  function handleOpenFile() {
    if (!artifact.filePath) return
    const api = (window as any).electronAPI
    if (api?.shell?.showItemInFolder) api.shell.showItemInFolder(artifact.filePath)
    else api?.muse?.openWorkspace?.()
  }

  /** 放大预览：Electron 下用独立原生窗口承载（可自由拖动/缩放），Web 回退到 DOM 全屏层 */
  function handleFullscreen() {
    const openWindow = (window as any).electronAPI?.artifact?.openWindow
    if (openWindow) {
      openWindow({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        src: artifact.src,
      })
      return
    }
    setFullscreen(true)
  }

  const showCopy = artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'code'
  const showFullscreen = artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'image' || artifact.type === 'code' || artifact.type === 'markdown'
  const showDownload = artifact.type === 'html' || artifact.type === 'svg' || artifact.type === 'code' || artifact.type === 'markdown'

  function handleDownload() {
    const content = artifact.content || ''
    if (!content) return
    const extMap: Record<string, string> = { html: 'html', svg: 'svg', code: artifact.language || 'txt', markdown: 'md' }
    const filename = `${artifact.title || 'artifact'}.${extMap[artifact.type] || 'txt'}`
    const mimeMap: Record<string, string> = { html: 'text/html', svg: 'image/svg+xml', code: 'text/plain', markdown: 'text/markdown' }
    const blob = new Blob([content], { type: mimeMap[artifact.type] || 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="my-2 rounded-xl border border-border-subtle/70 bg-surface dark:bg-text-primary/[0.03] overflow-hidden shadow-sm max-w-[640px]">
      {/* 卡片头 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-elevated dark:bg-text-primary/[0.04] border-b border-border-subtle/60">
        <span className="text-text-muted">{meta.icon}</span>
        <span className="text-[12px] font-medium text-text-secondary truncate">
          {artifact.title || meta.label}
        </span>
        <span className="text-[10px] text-text-faint px-1.5 py-0.5 rounded bg-text-primary/[0.06]">{meta.label}</span>
        {artifact.language && (
          <span className="text-[10px] text-text-faint px-1.5 py-0.5 rounded bg-text-primary/[0.06] uppercase">{artifact.language}</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {showCopy && (
            <button onClick={handleCopy} title="复制源码"
              className="p-1 rounded hover:bg-text-primary/[0.08] text-text-faint hover:text-text-secondary transition-colors">
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
          )}
          {showDownload && (
            <button onClick={handleDownload} title="下载"
              className="p-1 rounded hover:bg-text-primary/[0.08] text-text-faint hover:text-text-secondary transition-colors">
              <Download size={13} />
            </button>
          )}
          {showFullscreen && (
            <button onClick={handleFullscreen} title="在独立窗口中放大"
              className="p-1 rounded hover:bg-text-primary/[0.08] text-text-faint hover:text-text-secondary transition-colors">
              <Maximize2 size={13} />
            </button>
          )}
          {artifact.filePath && (
            <button onClick={handleOpenFile} title="在文件夹中打开"
              className="p-1 rounded hover:bg-text-primary/[0.08] text-text-faint hover:text-text-secondary transition-colors">
              <FolderOpen size={13} />
            </button>
          )}
          <button onClick={() => setCollapsed(c => !c)} title={collapsed ? '展开' : '折叠'}
            className="p-1 rounded hover:bg-text-primary/[0.08] text-text-faint hover:text-text-secondary transition-colors">
            <ChevronDown size={14} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
        </div>
      </div>

      {/* 卡片体 */}
      {!collapsed && (
        <div className="bg-surface dark:bg-transparent">
          <ArtifactBody artifact={artifact} onFormSubmit={onFormSubmit} />
        </div>
      )}

      {/* 增强预览 Modal */}
      {fullscreen && (
        <PreviewModal artifact={artifact} onClose={() => setFullscreen(false)} />
      )}
    </div>
  )
}

/** 内容区按 type 分发 */
function ArtifactBody({ artifact, onFormSubmit }: ArtifactRendererProps) {
  const meta = TYPE_META[artifact.type]
  const height = artifact.height || meta?.defaultHeight || 320

  switch (artifact.type) {
    case 'html':
      return <HtmlSandbox content={artifact.content || ''} height={height} sandbox={artifact.sandbox !== false} />

    case 'svg':
      return (
        <div
          className="p-4 flex justify-center overflow-auto"
          style={{
            maxHeight: height,
            backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.08) 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }}
          dangerouslySetInnerHTML={{ __html: sanitizeSvg(artifact.content || '') }}
        />
      )

    case 'image':
      return (
        <div className="p-3 flex justify-center bg-inset dark:bg-text-primary/[0.02]">
          <img src={artifact.src} alt={artifact.title || 'image'}
            className="max-w-full rounded-lg" style={{ maxHeight: 480 }} />
        </div>
      )

    case 'code':
      return (
        <div className="relative">
          {artifact.language && (
            <span className="absolute top-2 right-3 text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded uppercase z-10">
              {artifact.language}
            </span>
          )}
          <pre className="p-3 text-[12px] leading-relaxed overflow-auto bg-slate-900 text-slate-100"
            style={{ maxHeight: 400 }}>
            <code>{artifact.content}</code>
          </pre>
        </div>
      )

    case 'chart':
    case 'form':
    case 'markdown':
      return (
        <div className="p-3 text-[12px] text-text-faint">
          该类型（{artifact.type}）由专用渲染器接入，详见 MessageContent 分发。
        </div>
      )

    default:
      return <div className="p-3 text-[12px] text-text-faint">未知产物类型</div>
  }
}

/** HTML iframe 沙箱渲染 — 隔离主应用，防注入，高度自适应内容 */
function HtmlSandbox({ content, height, sandbox }: { content: string; height: number; sandbox: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [adaptiveHeight, setAdaptiveHeight] = useState(height)

  // 自适应内容高度：加载完成后读取 document 实际高度
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document
        if (doc?.body) {
          const contentHeight = doc.body.scrollHeight
          // 限制范围：最小 120px，最大 600px
          const clampedHeight = Math.max(120, Math.min(600, contentHeight + 16))
          setAdaptiveHeight(clampedHeight)
        }
      } catch {
        // 跨域 sandbox 可能读取失败，使用默认高度
      }
    }

    iframe.addEventListener('load', handleLoad)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [content])

  return (
    <iframe
      ref={iframeRef}
      title="html-artifact"
      srcDoc={content}
      sandbox={sandbox ? 'allow-scripts allow-same-origin' : undefined}
      className="w-full border-0 bg-white transition-[height] duration-200"
      style={{ height: adaptiveHeight }}
    />
  )
}

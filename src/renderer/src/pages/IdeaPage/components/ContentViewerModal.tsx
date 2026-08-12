import React, { useMemo } from 'react'
import { ContentViewer } from '../types'
import { formatFilename } from '../utils/format'

function renderMarkdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) =>
    `<pre class="md-code-block"><code>${code.trimEnd()}</code></pre>`
  )

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>')

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr class="md-hr" />')

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>')

  // Paragraphs: wrap consecutive non-tag lines
  html = html.replace(/^(?!<[a-z]|<\/)(.*\S.*)$/gm, '<p class="md-p">$1</p>')

  // Collapse consecutive <li> into <ul>
  html = html.replace(/(<li class="md-li">[\s\S]*?<\/li>\n?)+/g, (match) =>
    `<ul class="md-ul">${match}</ul>`
  )

  // Remove empty paragraphs
  html = html.replace(/<p class="md-p"><\/p>/g, '')

  return html
}

// 跟随主题的 markdown 样式：颜色取自全局设计 token（CSS 变量），明暗两套主题自动适配
const MARKDOWN_STYLES = `
  .md-content { font-size: 14px; line-height: 1.75; color: rgb(var(--color-text-secondary)); }
  .md-content .md-h1 { font-size: 1.5em; font-weight: 700; color: rgb(var(--color-text-primary)); margin: 1.2em 0 0.6em; border-bottom: 1px solid rgb(var(--color-border-subtle) / 0.5); padding-bottom: 0.3em; }
  .md-content .md-h2 { font-size: 1.3em; font-weight: 700; color: rgb(var(--color-text-primary)); margin: 1em 0 0.5em; }
  .md-content .md-h3 { font-size: 1.1em; font-weight: 600; color: rgb(var(--color-text-primary)); margin: 0.8em 0 0.4em; }
  .md-content .md-h4 { font-size: 1em; font-weight: 600; color: rgb(var(--color-text-secondary)); margin: 0.6em 0 0.3em; }
  .md-content .md-p { margin: 0.4em 0; }
  .md-content .md-ul { list-style: disc; padding-left: 1.5em; margin: 0.4em 0; }
  .md-content .md-li { margin: 0.15em 0; }
  .md-content .md-code-block { background: rgb(var(--color-bg-inset) / 0.6); border: 1px solid rgb(var(--color-border-subtle) / 0.4); border-radius: 8px; padding: 12px 16px; overflow-x: auto; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.6; margin: 0.6em 0; color: rgb(var(--color-text-muted)); }
  .md-content .md-inline-code { background: rgb(var(--color-bg-inset) / 0.5); border: 1px solid rgb(var(--color-border-subtle) / 0.4); border-radius: 4px; padding: 1px 5px; font-family: ui-monospace, monospace; font-size: 0.9em; color: #818cf8; }
  .md-content .md-hr { border: none; border-top: 1px solid rgb(var(--color-border-subtle) / 0.5); margin: 1em 0; }
  .md-content .md-link { color: #818cf8; text-decoration: underline; text-underline-offset: 2px; }
  .md-content .md-link:hover { color: #a5b4fc; }
  .md-content strong { color: rgb(var(--color-text-primary)); font-weight: 600; }
  .md-content em { font-style: italic; color: rgb(var(--color-text-muted)); }
`

interface ContentViewerModalProps {
  viewer: ContentViewer
  onClose: () => void
}

const ContentViewerModal: React.FC<ContentViewerModalProps> = ({ viewer, onClose }) => {
  const typeLabels = { journal: '日志', insight: '洞察报告', profile: '主人画像' }
  const typeColors = {
    journal: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    insight: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    profile: 'text-violet-600 dark:text-violet-400 bg-violet-500/10 border-violet-500/20'
  }

  const renderedHtml = useMemo(() => renderMarkdownToHtml(viewer.content), [viewer.content])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <style>{MARKDOWN_STYLES}</style>
      <div
        className="w-full max-w-3xl max-h-[80vh] bg-surface dark:bg-slate-900 border border-border-subtle dark:border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${typeColors[viewer.type]}`}>
              {typeLabels[viewer.type]}
            </span>
            <h3 className="text-sm font-semibold text-text-secondary dark:text-slate-300 font-mono">{formatFilename(viewer.title)}</h3>
          </div>
          <button onClick={onClose} className="text-text-faint hover:text-text-secondary transition-colors text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="md-content" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        </div>
      </div>
    </div>
  )
}

export default ContentViewerModal

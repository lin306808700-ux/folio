import React, { useState, useMemo, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, Play } from 'lucide-react'
import ChartRenderer from './ChartRenderer'
import { parseTableFromProps, parseTableElement, type ParsedTable } from '../utils/tableParser'

/**
 * 包裹表格，渲染后从 DOM 提取数据判断是否可图表化
 */
const SmartTable: React.FC<{ children: React.ReactNode; isUser: boolean }> = ({ children, isUser }) => {
  const tableRef = useRef<HTMLTableElement>(null)
  const [chartData, setChartData] = useState<ParsedTable | null>(null)

  useEffect(() => {
    if (!tableRef.current) return
    const parsed = parseTableElement(tableRef.current)
    if (parsed && parsed.type === 'chartable') {
      setChartData(parsed)
    }
  }, [])

  if (chartData) {
    return <ChartRenderer table={chartData} />
  }

  return (
    <div className="overflow-x-auto my-4">
      <table ref={tableRef} className={`min-w-full text-sm border-collapse ${
        isUser ? 'border border-white/20' : 'border border-border-subtle/70'
      }`}>
        {children}
      </table>
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
  role?: 'user' | 'assistant'
  onExecuteCommand?: (command: string) => void
}

// 判断是否为 shell 类命令语言
const isShellLang = (lang: string): boolean => {
  const shellLangs = ['bash', 'sh', 'zsh', 'shell', 'terminal', 'console', 'powershell', 'cmd', '']
  return shellLangs.includes(lang.toLowerCase())
}

// 判断内容是否像命令（当语言为空时使用）
const looksLikeCommand = (content: string): boolean => {
  const commandPrefixes = [
    'ls', 'cd', 'git', 'npm', 'yarn', 'pnpm', 'docker', 'curl', 'wget',
    'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find', 'brew', 'pip',
    'python', 'node', 'npx', 'deno', 'bun', 'cargo', 'go', 'make',
    'chmod', 'chown', 'sudo', 'apt', 'yum', 'dnf', 'pacman', 'tnpm'
  ]
  const firstLine = content.trim().split('\n')[0].trim()
  const firstWord = firstLine.split(/\s+/)[0]
  return commandPrefixes.includes(firstWord) || firstLine.startsWith('./')
}

// 处理多行命令，将其连接起来
const processCommandLines = (value: string): string => {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))  // 去掉空行和注释行
    .join(' && ')
}

interface CodeBlockProps {
  language: string
  value: string
  onExecuteCommand?: (command: string) => void
}

const CodeBlock = ({ language, value, onExecuteCommand }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 判断是否显示执行按钮
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
  const isShell = isShellLang(language) && (language !== '' || looksLikeCommand(value))
  const showExecuteButton = isElectron && onExecuteCommand && isShell

  const handleExecute = () => {
    if (onExecuteCommand) {
      const command = processCommandLines(value)
      onExecuteCommand(command)
    }
  }

  return (
    <div className="relative group/code my-3 rounded-xl overflow-hidden">
      {/* 语言标签 + 按钮 */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#282c34] text-xs text-slate-400">
        <span className="font-mono uppercase tracking-wide">{language || 'code'}</span>
        <div className="flex items-center gap-2">
          {showExecuteButton && (
            <button
              onClick={handleExecute}
              className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 transition-colors"
            >
              <Play size={12} />
              <span>执行</span>
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 transition-colors"
          >
            {copied ? (
              <><Check size={12} className="text-emerald-400" /><span className="text-emerald-400">已复制</span></>
            ) : (
              <><Copy size={12} /><span>复制</span></>
            )}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '13px',
          lineHeight: '1.6',
          padding: '16px',
        }}
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

// 过滤 AI 思考标签残留（历史消息可能包含未清理的 think 标签）
function stripThinkingTags(text: string): string {
  if (!text) return text
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  cleaned = cleaned.replace(/<\/?think>/g, '')
  cleaned = cleaned.replace(/^(?:[a-z]*>[\s\n]*)+/gm, '')
  return cleaned.trim()
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, role, onExecuteCommand }) => {
  const isUser = role === 'user'
  const cleanedContent = useMemo(() => stripThinkingTags(content), [content])
  
  return (
    <div className={`prose max-w-none ${isUser ? '' : 'dark:prose-invert'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '')
          const value = String(children).replace(/\n$/, '')

          // 只有明确标记了语言前缀的代码块才渲染为 CodeBlock
          // 不再用 value.includes('\n') 判断，避免把 Markdown 混排内容误判为代码块
          if (!inline && match) {
            return <CodeBlock language={match[1]} value={value} onExecuteCommand={onExecuteCommand} />
          }

          return (
            <code className={`px-1.5 py-0.5 rounded text-[0.9em] font-mono ${
              isUser ? 'bg-white/20' : 'bg-text-primary/[0.08] text-brand'
            }`} {...props}>
              {children}
            </code>
          )
        },
        a({ node, href, children, ...props }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline ${isUser ? 'opacity-90 hover:opacity-100' : 'text-brand hover:text-brand-soft'}`}
              {...props}
            >
              {children}
            </a>
          )
        },
        table({ node, children, ...props }) {
          return <SmartTable isUser={isUser}>{children}</SmartTable>
        },
        th({ node, children, ...props }) {
          return (
            <th className={`px-3 py-2 border text-left font-semibold ${
              isUser ? 'bg-white/10 border-white/20' : 'bg-text-primary/[0.04] border-border-subtle/70 text-text-secondary'
            }`} {...props}>
              {children}
            </th>
          )
        },
        td({ node, children, ...props }) {
          return (
            <td className={`px-3 py-2 border ${
              isUser ? 'border-white/20' : 'border-border-subtle/70 text-text-muted'
            }`} {...props}>
              {children}
            </td>
          )
        },
        blockquote({ node, children, ...props }) {
          return (
            <blockquote className={`border-l-4 pl-4 py-2 my-4 italic ${
              isUser ? 'border-white/30 bg-white/10' : 'border-brand/30 bg-text-primary/[0.03] text-text-muted'
            }`} {...props}>
              {children}
            </blockquote>
          )
        },
        ul({ node, children, ...props }) {
          return <ul className="list-disc list-outside ml-4 space-y-1 my-3" {...props}>{children}</ul>
        },
        ol({ node, children, ...props }) {
          return <ol className="list-decimal list-outside ml-4 space-y-1 my-3" {...props}>{children}</ol>
        },
        li({ node, children, ...props }) {
          return <li className={`leading-relaxed pl-1 ${isUser ? '' : 'text-text-secondary'}`} {...props}>{children}</li>
        },
        h1({ node, children, ...props }) {
          return <h1 className={`text-2xl font-bold mt-6 mb-3 pb-2 border-b ${
            isUser ? 'border-white/20' : 'text-text-primary border-border-subtle/70'
          }`} {...props}>{children}</h1>
        },
        h2({ node, children, ...props }) {
          return <h2 className={`text-xl font-bold mt-5 mb-2 ${isUser ? '' : 'text-text-primary'}`} {...props}>{children}</h2>
        },
        h3({ node, children, ...props }) {
          return <h3 className={`text-lg font-semibold mt-4 mb-2 ${isUser ? '' : 'text-text-primary'}`} {...props}>{children}</h3>
        },
        h4({ node, children, ...props }) {
          return <h4 className={`text-base font-semibold mt-3 mb-1 ${isUser ? '' : 'text-text-primary/90'}`} {...props}>{children}</h4>
        },
        p({ node, children, ...props }) {
          return <p className={`my-2 leading-7 ${isUser ? '' : 'text-text-secondary'}`} {...props}>{children}</p>
        },
        hr({ node, ...props }) {
          return <hr className={`my-5 ${isUser ? 'border-white/20' : 'border-border-subtle/70'}`} {...props} />
        },
        strong({ node, children, ...props }) {
          return <strong className={`font-bold ${isUser ? '' : 'text-text-primary'}`} {...props}>{children}</strong>
        },
        em({ node, children, ...props }) {
          return <em className={`italic ${isUser ? 'opacity-80' : 'text-text-muted'}`} {...props}>{children}</em>
        },
        }}
      >
        {cleanedContent}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer

import React, { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import 'xterm/css/xterm.css'

interface TerminalProps {
  onReady?: (terminal: XTerm) => void
  executeCommand?: string
}

// 柔和、低饱和的终端配色，呼应意识海洋气质；背景半透明以透出深海氛围光
const TERMINAL_THEMES = {
  dark: {
    background: 'rgba(10, 16, 32, 0.45)',
    foreground: '#c5cdd8',
    cursor: '#a78bfa',
    cursorAccent: 'rgba(10,16,32,0.45)',
    selectionBackground: 'rgba(139,92,246,0.25)',
    black: '#3b4252',
    red: '#f48a8a',
    green: '#8fd9a8',
    yellow: '#e0c285',
    blue: '#8ab4f8',
    magenta: '#c4a7f0',
    cyan: '#8ed6dd',
    white: '#c5cdd8',
    brightBlack: '#5b6478',
    brightRed: '#ffa3a3',
    brightGreen: '#a8e6c0',
    brightYellow: '#ecd49a',
    brightBlue: '#a3c6fa',
    brightMagenta: '#d4bcf5',
    brightCyan: '#a6e3e8',
    brightWhite: '#e6edf3',
  },
  light: {
    background: 'rgba(244, 248, 255, 0.55)',
    foreground: '#3a4252',
    cursor: '#7c3aed',
    cursorAccent: 'rgba(244,248,255,0.55)',
    selectionBackground: 'rgba(124,58,237,0.18)',
    black: '#52586a',
    red: '#c2453f',
    green: '#1f9254',
    yellow: '#9a6b1a',
    blue: '#2563c2',
    magenta: '#7c3aed',
    cyan: '#0f8a92',
    white: '#3a4252',
    brightBlack: '#6b7280',
    brightRed: '#d4564f',
    brightGreen: '#27a35f',
    brightYellow: '#a9791f',
    brightBlue: '#2f6fd0',
    brightMagenta: '#8b4ff0',
    brightCyan: '#149aa3',
    brightWhite: '#1f2533',
  },
}

export const Terminal: React.FC<TerminalProps> = ({ onReady, executeCommand }) => {
  const { theme } = useTheme()
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm>()
  const fitAddonRef = useRef<FitAddon>()
  const cleanupRef = useRef<(() => void) | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const initTerminal = () => {
    if (!terminalRef.current || !window.electronAPI) {
      console.warn('[Terminal] electronAPI 不可用，可能在浏览器环境中运行')
      return
    }

    // 清理旧实例
    if (xtermRef.current) {
      if (cleanupRef.current) cleanupRef.current()
      xtermRef.current.dispose()
      xtermRef.current = undefined
    }
    setCreateError(null)

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowTransparency: true,
      theme: TERMINAL_THEMES[theme],
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(terminalRef.current)

    // 延迟适配，确保 DOM 已渲染
    setTimeout(async () => {
      fitAddon.fit()
      try {
        const result = await window.electronAPI!.terminal.create({
          cols: term.cols,
          rows: term.rows
        })
        if (result && !result.success) {
          setCreateError(result.error || '终端进程创建失败')
          console.error('[Terminal] 创建失败:', result.error)
        }
      } catch (e: any) {
        setCreateError(e.message || '终端进程创建失败')
        console.error('[Terminal] 创建异常:', e)
      }
    }, 100)

    // 连接终端数据流
    const cleanup = window.electronAPI.terminal.onData((data) => {
      term.write(data)
    })
    cleanupRef.current = cleanup

    term.onData((data) => {
      window.electronAPI!.terminal.write(data)
    })

    // 窗口大小变化时调整终端
    const handleResize = () => {
      fitAddon.fit()
      window.electronAPI!.terminal.resize({
        cols: term.cols,
        rows: term.rows
      })
    }
    window.addEventListener('resize', handleResize)

    xtermRef.current = term
    fitAddonRef.current = fitAddon
    onReady?.(term)

    // 返回清理函数供 useEffect 使用
    return () => {
      window.removeEventListener('resize', handleResize)
      if (cleanupRef.current) {
        cleanupRef.current()
      }
      term.dispose()
    }
  }

  useEffect(() => {
    const cleanup = initTerminal()
    return cleanup
  }, [])

  // 监听容器宽度变化，重新 fit 终端
  useEffect(() => {
    if (!terminalRef.current) return
    
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit()
        // 通知后端更新 pty 大小
        if (window.electronAPI?.terminal?.resize) {
          window.electronAPI.terminal.resize({
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows
          })
        }
      }
    })
    
    resizeObserver.observe(terminalRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  // 执行命令
  useEffect(() => {
    if (executeCommand && window.electronAPI) {
      window.electronAPI.terminal.write(executeCommand + '\r')
    }
  }, [executeCommand])

  // 明暗主题切换时，动态更新 xterm 配色（无需重建终端）
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = TERMINAL_THEMES[theme]
    }
  }, [theme])

  return (
    <div className="h-full w-full relative">
      <div 
        ref={terminalRef} 
        className="h-full w-full"
        style={{ padding: '8px' }}
      />
      {createError && (
        <div className="absolute inset-0 flex items-center justify-center bg-base/85 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4 text-center px-8">
            <AlertCircle size={40} className="text-red-400" />
            <div className="text-red-500 dark:text-red-300 text-sm font-medium">终端创建失败</div>
            <div className="text-text-muted text-xs max-w-[280px]">{createError}</div>
            <button
              onClick={() => initTerminal()}
              className="flex items-center gap-2 px-4 py-2 bg-surface/80 hover:bg-surface text-text-secondary border border-border-subtle/60 rounded-lg transition-all text-sm active:scale-95"
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

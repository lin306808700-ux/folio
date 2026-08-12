import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Terminal, CheckCircle2 } from 'lucide-react'

/**
 * 迷你终端 — 「Muse 在运行命令」
 *
 * 黑底等宽字体的输出流，包裹在圆角容器中，顶部标示"Muse 正在执行…"。
 * 假数据逐行打字追加，模拟脚本执行过程。
 */
export function MiniTerminal() {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 模拟逐行输出
  useEffect(() => {
    let alive = true
    let lineIndex = 0
    const timers: ReturnType<typeof setTimeout>[] = []

    function schedule(fn: () => void, ms: number) {
      const t = window.setTimeout(() => { if (alive) fn() }, ms)
      timers.push(t)
    }

    function addLine() {
      if (!alive || lineIndex >= FAKE_OUTPUT.length) {
        if (alive) setDone(true)
        return
      }
      const currentLine = FAKE_OUTPUT[lineIndex]
      setLines((prev) => [...prev, currentLine])
      lineIndex++
      const nextLine = lineIndex < FAKE_OUTPUT.length ? FAKE_OUTPUT[lineIndex] : ''
      const delay = nextLine.startsWith('$') ? 600 : 120 + Math.random() * 200
      schedule(addLine, delay)
    }

    schedule(addLine, 300)
    return () => { alive = false; timers.forEach(clearTimeout) }
  }, [])

  // 自动滚到底
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines])

  return (
    <div className="absolute inset-0 flex flex-col bg-slate-950/60">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <Terminal size={13} className="text-green-400" />
        <span className="text-xs text-white/60 font-medium">
          {done ? '执行完成' : 'Muse 正在执行…'}
        </span>
        {done && <CheckCircle2 size={12} className="text-emerald-400 ml-auto" />}
        {!done && (
          <motion.div
            className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>

      {/* 终端输出区 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-[1.7] scroll-container"
      >
        {lines.map((line, index) => (
          <div key={index} className={lineStyle(line)}>
            {line}
          </div>
        ))}
        {!done && <BlinkingCursor />}
      </div>
    </div>
  )
}

function lineStyle(line: string): string {
  if (!line) return 'text-white/55'
  if (line.startsWith('$')) return 'text-green-300/90 font-semibold mt-2'
  if (line.startsWith('✓') || line.startsWith('✔')) return 'text-emerald-400/80'
  if (line.startsWith('⚠') || line.includes('warning')) return 'text-amber-300/70'
  if (line.startsWith('✗') || line.includes('error') || line.includes('Error')) return 'text-red-400/80'
  return 'text-white/55'
}

function BlinkingCursor() {
  return (
    <motion.span
      className="inline-block w-2 h-3.5 bg-green-400/80 ml-0.5"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity }}
    />
  )
}

// ===== 假数据 =====
const FAKE_OUTPUT: string[] = [
  '$ npm install',
  'added 127 packages in 4.2s',
  '',
  '$ npm run build',
  '> ai-terminal@1.0.0 build',
  '> cd src/renderer && npm run build',
  '',
  'Compiling TypeScript...',
  '✓ src/App.tsx',
  '✓ src/components/ChatPage/index.tsx',
  '✓ src/components/MuseAvatar.tsx',
  '✓ src/components/CompanionDemo/index.tsx',
  '',
  'Bundling with webpack...',
  '⚠ warning: bundle size exceeds 244 KiB',
  '',
  'webpack 5.105.4 compiled with 3 warnings in 11.2s',
  '',
  '✓ Build completed successfully',
  '✓ Output: dist/bundle.js (2.36 MiB)',
]

export default MiniTerminal

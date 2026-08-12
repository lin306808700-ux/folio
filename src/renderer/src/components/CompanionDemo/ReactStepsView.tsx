import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Terminal, Eye, ChevronDown, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react'

interface ReActStep {
  id: number
  thought: string
  action: string
  input: string
  observation?: string
  status: 'running' | 'done'
}

/**
 * ReAct 思维链可视化 — 「Muse 的思考过程」
 *
 * 卡片流式展示每步的 thought / action / observation，
 * 新步骤以动画追加，默认只露 thought + action 摘要，点击展开看完整 observation。
 * 纯假数据驱动，模拟逐步执行。
 */
export function ReactStepsView() {
  const [steps, setSteps] = useState<ReActStep[]>([])
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  // 模拟 ReAct 逐步执行：每 1.8s 追加一步
  useEffect(() => {
    let alive = true
    let stepIndex = 0
    const maxSteps = FAKE_STEPS.length
    const timers: ReturnType<typeof setTimeout>[] = []

    function schedule(fn: () => void, ms: number) {
      const t = window.setTimeout(() => { if (alive) fn() }, ms)
      timers.push(t)
    }

    function addNextStep() {
      if (!alive || stepIndex >= maxSteps) return
      const step = FAKE_STEPS[stepIndex]
      setSteps((prev) => [...prev, { ...step, status: 'running' }])

      schedule(() => {
        setSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, status: 'done', observation: step.observation } : s))
        )
        stepIndex++
        schedule(addNextStep, 600)
      }, 1200)
    }

    schedule(addNextStep, 400)
    return () => { alive = false; timers.forEach(clearTimeout) }
  }, [])

  return (
    <div className="absolute inset-0 overflow-y-auto px-4 py-5 space-y-3 scroll-container bg-slate-950/40">
      {/* 头部提示 */}
      <div className="flex items-center gap-2 text-white/50 text-xs mb-2">
        <Brain size={13} className="text-violet-300" />
        <span>Muse 正在逐步思考和行动…</span>
      </div>

      <AnimatePresence initial={false}>
        {steps.map((step) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="rounded-xl bg-white/[0.06] border border-white/[0.08] overflow-hidden"
          >
            {/* 卡片头：步骤号 + thought + 状态 */}
            <button
              onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
            >
              <div className="flex-shrink-0 mt-0.5">
                {step.status === 'running' ? (
                  <Loader2 size={14} className="text-violet-300 animate-spin" />
                ) : (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/80 leading-relaxed">{step.thought}</p>
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-white/40">
                  <Terminal size={10} />
                  <span className="font-mono">{step.action}({step.input.slice(0, 40)}{step.input.length > 40 ? '…' : ''})</span>
                </div>
              </div>
              <div className="flex-shrink-0 text-white/30 mt-1">
                {step.observation && (expandedStep === step.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
              </div>
            </button>

            {/* 展开的 observation */}
            <AnimatePresence>
              {expandedStep === step.id && step.observation && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 pt-0">
                    <div className="flex items-center gap-1.5 text-[10px] text-white/35 mb-1.5">
                      <Eye size={10} />
                      <span>观察结果</span>
                    </div>
                    <pre className="text-[11px] text-white/60 font-mono whitespace-pre-wrap leading-relaxed bg-black/20 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
                      {step.observation}
                    </pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* 底部：全部完成后显示总结 */}
      {steps.length === FAKE_STEPS.length && steps.every((s) => s.status === 'done') && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-center py-3 text-xs text-emerald-300/70"
        >
          ✓ 全部步骤完成（共 {steps.length} 步）
        </motion.div>
      )}
    </div>
  )
}

// ===== 假数据 =====
const FAKE_STEPS: ReActStep[] = [
  {
    id: 1,
    thought: '用户想要分析这个项目的结构，我先看一下目录树。',
    action: 'shell',
    input: 'find . -maxdepth 2 -type f | head -30',
    observation: './src/main/index.js\n./src/renderer/src/App.tsx\n./src/renderer/src/components/ChatPage/index.tsx\n./package.json\n./tsconfig.json\n... (共 28 个文件)',
  },
  {
    id: 2,
    thought: '看到了主要文件，再看一下 package.json 了解技术栈。',
    action: 'read_file',
    input: 'package.json',
    observation: '{\n  "name": "ai-terminal",\n  "dependencies": {\n    "electron": "^41.0.2",\n    "react": "^18.3.1",\n    "framer-motion": "^12.40.0"\n  }\n}',
  },
  {
    id: 3,
    thought: '了解了，这是一个 Electron + React 项目。我来查看入口文件了解整体架构。',
    action: 'read_file',
    input: 'src/main/index.js (lines 1-30)',
    observation: '// Electron 主进程入口\nconst { app, BrowserWindow } = require("electron")\nconst { initChatHandler } = require("./chat-handler")\nconst { initMuseRouter } = require("./muse/router")\n// 初始化各子系统...',
  },
  {
    id: 4,
    thought: '架构清楚了。总结给用户：Electron 主进程管理窗口和 AI 通信，渲染进程是 React SPA，Muse 子系统负责 ReAct 智能体。',
    action: 'final_answer',
    input: '项目架构分析完成',
    observation: '已向用户输出项目架构分析结果。',
  },
]

export default ReactStepsView

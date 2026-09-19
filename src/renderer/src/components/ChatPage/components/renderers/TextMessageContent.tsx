// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Play, Zap } from 'lucide-react'
import MarkdownRenderer from '../../../MarkdownRenderer'
import { looksLikeCommand, extractCommandsFromText, preprocessScriptBlock, preprocessBareCodeBlocks } from '../message-utils'
import { useMessageBubbleContext } from '../MessageBubbleContext'
import { ThinkingBlock, extractThinking } from './ThinkingBlock'

/** 文本/Markdown 消息渲染 — 包含进度消息、思考中动画、命令检测按钮 */
export function TextMessageContent() {
  const { msg, content, loading, isElectron, onExecuteSpecificCommand } = useMessageBubbleContext()
  const [museHandling, setMuseHandling] = useState(false)

  // 对 AI 文本消息预处理：将 SCRIPT_BLOCK 裸文本转换为 Markdown 代码块
  // 同时处理非标准代码块（裸语言标记+代码）
  // 提取 thinking 部分和正文
  const { thinking, body: contentBody } = msg.role === 'assistant' ? extractThinking(content) : { thinking: null, body: content }
  const renderedContent = msg.role === 'assistant'
    ? preprocessBareCodeBlocks(preprocessScriptBlock(contentBody))
    : content

  const handleHandToMuse = async () => {
    if (!window.electronAPI?.muse?.executeCommand) return
    setMuseHandling(true)
    try {
      await window.electronAPI.muse.executeCommand({ command: msg.userInput || content.slice(0, 200) })
    } catch (e) {
      console.error('交给 Muse 失败:', e)
    } finally {
      setMuseHandling(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Thinking 折叠展示 */}
      {thinking && <ThinkingBlock content={thinking} isStreaming={loading && msg.role === 'assistant'} />}

      {/* 进度消息特殊渲染 */}
      {(msg as any).isProgress ? (
        <ProgressLines content={contentBody} />
      ) : msg.role === 'assistant' && !contentBody ? (
        // 仅在仍处于流式/思考阶段时渲染思考动画；流已结束但 AI 没产出任何内容时给出明确提示，避免气泡永远转圈
        (loading || msg.isThinking) ? (
          <ThinkingAnimation />
        ) : (
          <div className="text-sm text-gray-400 italic select-none">AI 未返回任何内容，请重试或检查后端服务</div>
        )
      ) : (
        <MarkdownRenderer
          content={msg.role === 'assistant' ? renderedContent : content}
          role={msg.role}
          onExecuteCommand={isElectron ? (cmd) => onExecuteSpecificCommand(cmd, '代码块命令') : undefined}
        />
      )}

      {/* 复杂任务：交给 Muse 处理按钮 */}
      {msg.role === 'assistant' && msg.isComplex && isElectron && (
        <div className="pt-1">
          <button
            onClick={handleHandToMuse}
            disabled={museHandling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-all disabled:opacity-50"
          >
            <Zap size={12} />
            {museHandling ? '已交给 Muse...' : '交给 Muse 处理'}
          </button>
        </div>
      )}

      {/* 提取并显示命令执行按钮 */}
      {/* {isElectron && msg.role === 'assistant' && (() => {
        const commands = extractCommandsFromText(content)
        if (commands.length > 0) {
          return (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-slate-500 font-medium">检测到命令：</div>
              {commands.map((cmd, index) => (
                <div key={index}>
                  <button
                    onClick={() => onExecuteSpecificCommand(cmd.command, `命令 ${index + 1}`)}
                    disabled={loading}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all text-left group active:scale-[0.98] disabled:opacity-50"
                  >
                    <Play size={14} className="text-emerald-600 flex-shrink-0" />
                    <code className="flex-1 text-xs text-emerald-800 font-mono truncate">{cmd.command}</code>
                  </button>
                </div>
              ))}
            </div>
          )
        }
        return null
      })()} */}
    </div>
  )
}

/** 进度消息行渲染 */
function ProgressLines({ content }: { content: string }) {
  const lines = content.split('\n').filter(line => line.trim())
  const totalLines = lines.length

  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        const trimmedLine = line.trim()
        const isLastLine = index === totalLines - 1

        const isSuccess = trimmedLine.includes('✅') || trimmedLine.includes('✓')
        const isFailed = trimmedLine.includes('❌') || trimmedLine.includes('✗')
        const isRunning = isLastLine && !isSuccess && !isFailed
        const isSubStatus = trimmedLine.match(/^[✅❌✓✗]\s*$/)

        if (isSubStatus) return null

        return (
          <div key={index} className="flex items-center gap-2">
            {isRunning ? (
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            ) : isSuccess ? (
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : isFailed ? (
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <div className="w-4 h-4 flex-shrink-0" />
            )}
            <span className={`text-sm ${
              isRunning ? 'text-blue-600 font-medium' :
              isSuccess ? 'text-slate-600' :
              isFailed ? 'text-red-600' :
              'text-slate-700'
            }`}>
              {trimmedLine.replace(/^[•✅❌✓✗]\s*/, '').replace(/^\s+/, '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 思考态分阶段文案 — 随等待时长推进，营造"进展感"而非死板的单句。
 * 越往后停留时间越长，符合"先快速理解、后深入组织"的真实节奏。
 * 每个阶段配一个语义色，让光晕/微粒随思绪推进而变色，更有生命感。
 */
const THINKING_PHASES = [
  { label: '理解你的意图', dwell: 2200, hue: 262 },
  { label: '检索相关上下文', dwell: 2800, hue: 230 },
  { label: '梳理思路', dwell: 3200, hue: 200 },
  { label: '组织语言', dwell: 3600, hue: 168 },
  { label: '仔细斟酌中', dwell: 4200, hue: 280 }
]

/** 思考中动画 — 意识体凝神：阶段轮播文案 + 微光呼吸点，让等待有进展感 */
function ThinkingAnimation() {
  const reduceMotion = useReducedMotion()
  const [phaseIndex, setPhaseIndex] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 按各阶段 dwell 时长推进，停在最后一个阶段
  useEffect(() => {
    if (phaseIndex >= THINKING_PHASES.length - 1) return
    timerRef.current = setTimeout(
      () => setPhaseIndex(i => Math.min(i + 1, THINKING_PHASES.length - 1)),
      THINKING_PHASES[phaseIndex].dwell
    )
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [phaseIndex])

  const currentPhase = THINKING_PHASES[phaseIndex]
  const currentLabel = currentPhase.label
  const hue = currentPhase.hue

  // 静态降级：reduceMotion 时只显示文案 + 静态点
  if (reduceMotion) {
    return (
      <div className="flex items-center gap-2.5 py-1 pl-1">
        <span className="text-sm text-text-muted font-light italic">{currentLabel}</span>
        <span className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-1 h-1 bg-text-muted rounded-full" />
          ))}
        </span>
      </div>
    )
  }

  return (
    <motion.div
      className="flex items-center gap-3 py-1 pl-1"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {/* 意识核心：随阶段变色的呼吸光晕 + 轨道环绕微粒 */}
      <span className="relative inline-flex items-center justify-center w-5 h-5 flex-shrink-0">
        {/* 外层呼吸光晕 */}
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(circle, hsla(${hue},85%,65%,0.55) 0%, transparent 70%)` }}
          animate={{ scale: [0.8, 1.5, 0.8], opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity }}
        />
        {/* 核心光点 */}
        <motion.span
          className="relative w-1.5 h-1.5 rounded-full"
          style={{ background: `hsl(${hue},90%,70%)`, boxShadow: `0 0 8px hsla(${hue},90%,65%,0.9)` }}
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
        />
        {/* 环绕轨道微粒 — 思绪流转感 */}
        <motion.span
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 3.2, ease: 'linear', repeat: Infinity }}
        >
          <span
            className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
            style={{ background: `hsla(${hue},90%,75%,0.9)`, boxShadow: `0 0 5px hsla(${hue},90%,70%,0.8)` }}
          />
        </motion.span>
      </span>

      {/* 文案：阶段切换淡入淡出 + 思绪流光扫过 */}
      <span className="relative inline-flex items-center h-5 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.span
            key={currentLabel}
            className="relative text-sm font-light italic whitespace-nowrap bg-clip-text text-transparent"
            style={{
              backgroundImage: `linear-gradient(100deg, hsla(${hue},45%,55%,0.85) 0%, hsla(${hue},80%,72%,1) 45%, hsla(${hue},45%,55%,0.85) 90%)`,
              backgroundSize: '220% 100%'
            }}
            initial={{ opacity: 0, y: 8, backgroundPositionX: '0%' }}
            animate={{ opacity: 1, y: 0, backgroundPositionX: ['0%', '-220%'] }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              y: { duration: 0.4, ease: 'easeOut' },
              opacity: { duration: 0.4, ease: 'easeOut' },
              backgroundPositionX: { duration: 2.8, ease: 'linear', repeat: Infinity }
            }}
          >
            {currentLabel}
          </motion.span>
        </AnimatePresence>
      </span>

      {/* 尾随三点：波浪起伏，随阶段同色 */}
      <span className="flex gap-1 items-center">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full"
            style={{ background: `hsl(${hue},80%,68%)`, boxShadow: `0 0 5px hsla(${hue},85%,62%,0.5)` }}
            animate={{ y: [0, -3, 0], opacity: [0.35, 0.85, 0.35] }}
            transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity, delay: i * 0.18 }}
          />
        ))}
      </span>
    </motion.div>
  )
}

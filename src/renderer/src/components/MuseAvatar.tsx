// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion, useAnimationControls } from 'framer-motion'

export type MuseState = 'idle' | 'working' | 'outputting' | 'error' | 'waiting'

interface MuseAvatarProps {
  state: MuseState
  size?: number
  className?: string
}

/** 各状态下整体动作的 framer-motion variants（替代原 CSS animate-class） */
const BODY_MOTION: Record<MuseState, any> = {
  // 呼吸：极缓慢的缩放 + 轻微上下浮动，制造"活着"的生命感
  idle: {
    scale: [1, 1.03, 1],
    y: [0, -1.5, 0],
    transition: { duration: 4, ease: 'easeInOut', repeat: Infinity },
  },
  // 工作：轻快弹跳
  working: {
    y: [0, -3, 0],
    transition: { duration: 0.6, ease: 'easeInOut', repeat: Infinity },
  },
  // 输出：呼吸式脉动
  outputting: {
    scale: [1, 1.05, 1],
    transition: { duration: 1.5, ease: 'easeInOut', repeat: Infinity },
  },
  // 出错：左右抖动
  error: {
    x: [0, -2, 2, -2, 2, 0],
    transition: { duration: 0.5, ease: 'easeInOut', repeat: Infinity },
  },
  // 等待：更慢的呼吸
  waiting: {
    scale: [1, 1.02, 1],
    y: [0, -1, 0],
    transition: { duration: 4.5, ease: 'easeInOut', repeat: Infinity },
  },
}

/**
 * Muse 像素风 2D 伴侣形象
 * 一只小猫精灵，具备拟人化生命体征：呼吸、随机眨眼、视线跟随、情绪渐变。
 */
export function MuseAvatar({ state, size = 64, className = '' }: MuseAvatarProps) {
  const reduceMotion = useReducedMotion()
  const isBlinking = useRandomBlink(state, reduceMotion)
  const { pupilX, pupilY, containerRef } = useGazeTracking(state, reduceMotion)
  const nodControls = useNod(reduceMotion)

  // 出错/眨眼时不显示视线偏移（眨眼时眼睛是闭的）
  const showEyes = !isBlinking && state !== 'error'

  return (
    <motion.div
      ref={containerRef}
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      title={getStateLabel(state)}
      animate={reduceMotion ? undefined : BODY_MOTION[state]}
    >
      <motion.div className="inline-flex" animate={nodControls} style={{ originY: 0.8 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ imageRendering: 'pixelated' }}
      >
        {/* 身体轮廓 - 圆润的精灵体（颜色随情绪平滑过渡） */}
        <motion.rect x="20" y="28" width="24" height="24" rx="4"
          animate={{ fill: getBodyColor(state) }} transition={{ duration: 0.5 }} />
        <motion.rect x="22" y="30" width="20" height="20" rx="3"
          animate={{ fill: getBodyHighlight(state) }} transition={{ duration: 0.5 }} />

        {/* 头部 */}
        <motion.rect x="16" y="12" width="32" height="28" rx="6"
          animate={{ fill: getBodyColor(state) }} transition={{ duration: 0.5 }} />
        <motion.rect x="18" y="14" width="28" height="24" rx="5"
          animate={{ fill: getBodyHighlight(state) }} transition={{ duration: 0.5 }} />

        {/* 耳朵 - 猫耳 */}
        <motion.polygon points="18,16 22,8 26,16" animate={{ fill: getBodyColor(state) }} transition={{ duration: 0.5 }} />
        <motion.polygon points="20,15 22,10 24,15" animate={{ fill: getEarInner(state) }} transition={{ duration: 0.5 }} />
        <motion.polygon points="38,16 42,8 46,16" animate={{ fill: getBodyColor(state) }} transition={{ duration: 0.5 }} />
        <motion.polygon points="40,15 42,10 44,15" animate={{ fill: getEarInner(state) }} transition={{ duration: 0.5 }} />

        {/* 眼睛 — 眨眼时闭眼，否则按状态渲染并叠加视线偏移 */}
        {showEyes
          ? <motion.g style={{ x: pupilX, y: pupilY }}>{renderEyes(state)}</motion.g>
          : renderClosedEyes(state)}

        {/* 嘴巴 */}
        {renderMouth(state)}

        {/* 腮红 */}
        <rect x="18" y="30" width="4" height="3" rx="1" fill="#ff9eae" opacity="0.6" />
        <rect x="42" y="30" width="4" height="3" rx="1" fill="#ff9eae" opacity="0.6" />

        {/* 尾巴（路径随状态平滑过渡） */}
        <motion.path
          animate={{ d: getTailPath(state), stroke: getBodyColor(state) }}
          transition={{ duration: 0.5 }}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* 状态特效 */}
        {renderStateEffect(state)}
      </svg>
      </motion.div>
    </motion.div>
  )
}

/**
 * 随机眨眼：每 2.5~6s 随机眨一次，闭眼 ~120ms。随机性是生命感的关键。
 */
function useRandomBlink(state: MuseState, reduceMotion: boolean | null): boolean {
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    // error 态用 X 眼，不眨；reduceMotion 时不眨
    if (reduceMotion || state === 'error') {
      setBlinking(false)
      return
    }

    let blinkTimer: ReturnType<typeof setTimeout>
    let openTimer: ReturnType<typeof setTimeout>

    function scheduleNextBlink() {
      const delay = 2500 + Math.random() * 3500
      blinkTimer = setTimeout(() => {
        setBlinking(true)
        openTimer = setTimeout(() => {
          setBlinking(false)
          scheduleNextBlink()
        }, 120)
      }, delay)
    }

    scheduleNextBlink()
    return () => {
      clearTimeout(blinkTimer)
      clearTimeout(openTimer)
    }
  }, [state, reduceMotion])

  return blinking
}

/**
 * 视线跟随：瞳孔朝目标方向轻微偏移（最大 ±2px），用 spring 平滑。
 * - 默认跟随鼠标
 * - 输入框聚焦时锁定看向输入框（input_focus 事件），blur 后恢复跟随鼠标
 * - working 态专注向前看，不跟随
 */
function useGazeTracking(state: MuseState, reduceMotion: boolean | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rawX = useMotionValue(0)
  const rawY = useMotionValue(0)
  const pupilX = useSpring(rawX, { stiffness: 120, damping: 18 })
  const pupilY = useSpring(rawY, { stiffness: 120, damping: 18 })

  const MAX_OFFSET = 2 // viewBox 单位

  // 根据目标屏幕坐标计算并设置瞳孔偏移
  function aimAt(targetX: number, targetY: number) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const dx = targetX - centerX
    const dy = targetY - centerY
    const distance = Math.hypot(dx, dy) || 1
    rawX.set((dx / distance) * MAX_OFFSET)
    rawY.set((dy / distance) * MAX_OFFSET)
  }

  // 跟随鼠标
  useEffect(() => {
    if (reduceMotion || state === 'working') {
      rawX.set(0)
      rawY.set(0)
      return
    }

    function handleMouseMove(event: MouseEvent) {
      aimAt(event.clientX, event.clientY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reduceMotion])

  return { pupilX, pupilY, containerRef }
}

/** 点头动画控制器（预留，当前无触发源） */
function useNod(reduceMotion: boolean | null) {
  const controls = useAnimationControls()
  void reduceMotion
  return controls
}

/** 闭眼（眨眼瞬间）— 一条短横线，沿用各状态眼睛中心位置 */
function renderClosedEyes(_state: MuseState): React.ReactNode {
  return (
    <>
      <path d="M23 25 Q26 27 29 25" stroke="#1e1b4b" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M35 25 Q38 27 41 25" stroke="#1e1b4b" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  )
}

function getStateLabel(state: MuseState): string {
  switch (state) {
    case 'idle': return 'Muse 空闲中~'
    case 'working': return 'Muse 正在工作...'
    case 'outputting': return 'Muse 输出中...'
    case 'error': return 'Muse 遇到了问题'
    case 'waiting': return 'Muse 等待你的指令...'
    default: return 'Muse'
  }
}

function getBodyColor(state: MuseState): string {
  switch (state) {
    case 'idle': return '#a78bfa'
    case 'working': return '#818cf8'
    case 'outputting': return '#6ee7b7'
    case 'error': return '#fca5a5'
    case 'waiting': return '#c4b5fd'
    default: return '#a78bfa'
  }
}

function getBodyHighlight(state: MuseState): string {
  switch (state) {
    case 'idle': return '#ddd6fe'
    case 'working': return '#c7d2fe'
    case 'outputting': return '#d1fae5'
    case 'error': return '#fde2e2'
    case 'waiting': return '#ede9fe'
    default: return '#ddd6fe'
  }
}

function getEarInner(state: MuseState): string {
  switch (state) {
    case 'idle': return '#f9a8d4'
    case 'working': return '#93c5fd'
    case 'outputting': return '#86efac'
    case 'error': return '#fda4af'
    case 'waiting': return '#f9a8d4'
    default: return '#f9a8d4'
  }
}

function renderEyes(state: MuseState): React.ReactNode {
  switch (state) {
    case 'idle':
      return (
        <>
          {/* 半闭眼 - 放松 */}
          <ellipse cx="26" cy="26" rx="3" ry="2.5" fill="#1e1b4b" />
          <ellipse cx="38" cy="26" rx="3" ry="2.5" fill="#1e1b4b" />
          <circle cx="27" cy="25" r="1" fill="white" />
          <circle cx="39" cy="25" r="1" fill="white" />
        </>
      )
    case 'working':
      return (
        <>
          {/* 专注眼 - 较小瞳孔 */}
          <circle cx="26" cy="25" r="3" fill="#1e1b4b" />
          <circle cx="38" cy="25" r="3" fill="#1e1b4b" />
          <circle cx="27" cy="24" r="1.5" fill="white" />
          <circle cx="39" cy="24" r="1.5" fill="white" />
        </>
      )
    case 'outputting':
      return (
        <>
          {/* 开心弯弯眼 */}
          <path d="M23 25 Q26 22 29 25" stroke="#1e1b4b" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M35 25 Q38 22 41 25" stroke="#1e1b4b" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* 闪亮高光 */}
          <circle cx="26" cy="22" r="1" fill="#fbbf24" />
          <circle cx="38" cy="22" r="1" fill="#fbbf24" />
        </>
      )
    case 'error':
      return (
        <>
          {/* X 眼 */}
          <line x1="24" y1="23" x2="28" y2="27" stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" />
          <line x1="28" y1="23" x2="24" y2="27" stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" />
          <line x1="36" y1="23" x2="40" y2="27" stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" />
          <line x1="40" y1="23" x2="36" y2="27" stroke="#1e1b4b" strokeWidth="2" strokeLinecap="round" />
        </>
      )
    case 'waiting':
      return (
        <>
          {/* 圆眼眨巴 */}
          <circle cx="26" cy="25" r="3.5" fill="#1e1b4b" />
          <circle cx="38" cy="25" r="3.5" fill="#1e1b4b" />
          <circle cx="27.5" cy="24" r="1.5" fill="white" />
          <circle cx="39.5" cy="24" r="1.5" fill="white" />
          <circle cx="26.5" cy="25.5" r="0.8" fill="white" opacity="0.5" />
          <circle cx="38.5" cy="25.5" r="0.8" fill="white" opacity="0.5" />
        </>
      )
    default:
      return null
  }
}

function renderMouth(state: MuseState): React.ReactNode {
  switch (state) {
    case 'idle':
      return (
        <path d="M29 33 Q32 36 35 33" stroke="#1e1b4b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      )
    case 'working':
      return (
        <>
          <line x1="29" y1="34" x2="35" y2="34" stroke="#1e1b4b" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )
    case 'outputting':
      return (
        <>
          {/* 大大的开心笑容 */}
          <path d="M27 32 Q32 38 37 32" stroke="#1e1b4b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </>
      )
    case 'error':
      return (
        <path d="M29 36 Q32 33 35 36" stroke="#1e1b4b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      )
    case 'waiting':
      return (
        <>
          <path d="M30 33 Q32 35 34 33" stroke="#1e1b4b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          {/* 小舌头 */}
          <ellipse cx="32" cy="35" rx="1.5" ry="1" fill="#f9a8d4" />
        </>
      )
    default:
      return null
  }
}

function getTailPath(state: MuseState): string {
  switch (state) {
    case 'idle': return 'M44 48 Q52 44 50 38 Q48 32 54 30'
    case 'working': return 'M44 48 Q54 46 52 40 Q50 34 56 32'
    case 'outputting': return 'M44 48 Q50 42 48 36 Q46 30 52 28'
    case 'error': return 'M44 48 Q46 50 44 52 Q42 54 44 56'
    case 'waiting': return 'M44 48 Q50 44 52 40 Q54 36 50 32'
    default: return 'M44 48 Q52 44 50 38 Q48 32 54 30'
  }
}

function renderStateEffect(state: MuseState): React.ReactNode {
  switch (state) {
    case 'working':
      return (
        <>
          {/* 闪烁的星星粒子 */}
          <circle cx="12" cy="18" r="1.5" fill="#fbbf24" opacity="0.8">
            <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1s" repeatCount="indefinite" />
          </circle>
          <circle cx="52" cy="14" r="1" fill="#fbbf24" opacity="0.6">
            <animate attributeName="opacity" values="0.6;0.1;0.6" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx="8" cy="32" r="1" fill="#818cf8" opacity="0.7">
            <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.2s" repeatCount="indefinite" />
          </circle>
        </>
      )
    case 'outputting':
      return (
        <>
          {/* 向上冒出的小气泡 */}
          <circle cx="48" cy="20" r="2" fill="#6ee7b7" opacity="0.4">
            <animate attributeName="cy" values="20;12;4" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.6;0" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="52" cy="24" r="1.5" fill="#6ee7b7" opacity="0.3">
            <animate attributeName="cy" values="24;16;8" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.5;0" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </>
      )
    case 'error':
      return (
        <>
          {/* 冒汗滴 */}
          <ellipse cx="14" cy="20" rx="1.5" ry="2.5" fill="#93c5fd" opacity="0.7">
            <animate attributeName="cy" values="20;24;28" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.7;0.4;0" dur="1.5s" repeatCount="indefinite" />
          </ellipse>
          {/* 叹号 */}
          <rect x="54" y="8" width="3" height="8" rx="1.5" fill="#ef4444" />
          <circle cx="55.5" cy="19" r="1.5" fill="#ef4444" />
        </>
      )
    case 'waiting':
      return (
        <>
          {/* Z Z Z 符号 */}
          <text x="48" y="16" fontSize="8" fill="#a78bfa" opacity="0.6" fontFamily="monospace" fontWeight="bold">
            z
            <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" />
          </text>
          <text x="52" y="10" fontSize="6" fill="#a78bfa" opacity="0.4" fontFamily="monospace" fontWeight="bold">
            z
            <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
          </text>
        </>
      )
    case 'idle':
    default:
      return (
        <>
          {/* 小音符 */}
          <text x="50" y="16" fontSize="8" fill="#a78bfa" opacity="0.5" fontFamily="serif">
            ♪
            <animate attributeName="opacity" values="0.5;0.2;0.5" dur="3s" repeatCount="indefinite" />
            <animate attributeName="y" values="16;13;16" dur="3s" repeatCount="indefinite" />
          </text>
        </>
      )
  }
}

export default MuseAvatar

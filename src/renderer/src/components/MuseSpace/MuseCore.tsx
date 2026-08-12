import React, { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTouchFeedback } from '../../hooks/useTouchFeedback'
import { onMuseInteraction, type MuseAmbientState } from '../muse-interaction-bus'
import { MuseBrainLogo, type MuseState } from '../MuseBrainLogo'

interface MuseCoreProps {
  onSummonChat: () => void
  heartbeatRunning: boolean
  currentTask: { command: string } | null
  activeGoal: { title: string } | null
  vitality: number
}

interface DisplayConfig {
  color: string
  glow: string
  breathDuration: number
  label: string
}

/**
 * MuseCore — 活体意识核
 *
 * 状态由真实数据驱动：
 * - chat 工作中 → 蓝（跟随 bus state）
 * - 心跳运行中 → 绿（探索中）
 * - 心跳停止 → 紫（休息中）
 * - 有当前任务 → 显示任务名
 */
export function MuseCore({ onSummonChat, heartbeatRunning, currentTask, activeGoal, vitality }: MuseCoreProps) {
  const [museState, setMuseState] = useState<MuseAmbientState>('waiting')
  const [whisper, setWhisper] = useState<string | null>(null)

  const { handlers, currentState } = useTouchFeedback({
    ripple: true,
    whisper: '嗯？',
    ambientResponse: true,
    scale: { hover: 1.1, press: 0.92 },
  })

  useEffect(() => {
    return onMuseInteraction((event) => {
      if (event.type === 'state_change') setMuseState(event.state)
      if (event.type === 'touch_release' && event.whisper) {
        setWhisper(event.whisper)
        window.setTimeout(() => setWhisper(null), 1500)
      }
    })
  }, [])

  const config = useMemo<DisplayConfig>(() => {
    if (museState === 'working') {
      const label = currentTask
        ? `正在处理：${currentTask.command.substring(0, 24)}${currentTask.command.length > 24 ? '...' : ''}`
        : '工作中...'
      return { color: '#60a5fa', glow: 'rgba(96,165,250,0.5)', breathDuration: 3.2, label }
    }
    if (museState === 'outputting') {
      return { color: '#5ebda6', glow: 'rgba(94,189,166,0.4)', breathDuration: 4.5, label: '输出中~' }
    }
    if (museState === 'error') {
      return { color: '#f87171', glow: 'rgba(248,113,113,0.3)', breathDuration: 8, label: '出错了' }
    }
    if (heartbeatRunning) {
      const goalLabel = activeGoal
        ? `探索：${activeGoal.title.substring(0, 16)}${activeGoal.title.length > 16 ? '...' : ''}`
        : '探索中...'
      return { color: '#34d399', glow: 'rgba(52,211,153,0.35)', breathDuration: 5, label: goalLabel }
    }
    return { color: '#8b5cf6', glow: 'rgba(139,92,246,0.3)', breathDuration: 8, label: '休息中' }
  }, [museState, currentTask, heartbeatRunning, activeGoal])

  const glyphState = useMemo<MuseState>(() => {
    if (museState === 'working' || currentTask) return 'working'
    if (museState === 'outputting') return 'outputting'
    if (museState === 'error') return 'error'
    if (heartbeatRunning) return 'idle'
    return 'waiting'
  }, [museState, currentTask, heartbeatRunning])

  const coreVariants = {
    idle: {
      scale: [1, 1 + vitality / 1200, 1],
      transition: { duration: config.breathDuration, repeat: Infinity, ease: 'easeInOut' as const },
    },
    hover: { scale: 1.1, transition: { duration: 0.2 } },
    press: { scale: 0.92, transition: { duration: 0.1 } },
  }

  return (
    <motion.div
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer select-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      onClick={onSummonChat}
      {...handlers}
    >
      <AnimatePresence>
        {whisper && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute -top-10 text-xs text-text-secondary font-light"
          >
            {whisper}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        animate={currentState}
        variants={coreVariants}
        className="relative flex items-center justify-center"
        initial={{ scale: 0 }}
      >
        <motion.div
          className="absolute rounded-full border border-white/[0.14]"
          style={{ width: 286, height: 286 }}
          animate={{
            rotate: 360,
            opacity: [0.18, 0.42 + vitality / 260, 0.18],
            scale: [1, 1.025, 1],
          }}
          transition={{
            rotate: { duration: currentTask ? 14 : 28, repeat: Infinity, ease: 'linear' },
            opacity: { duration: config.breathDuration, repeat: Infinity, ease: 'easeInOut' },
            scale: { duration: config.breathDuration + 1, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
        <motion.div
          className="absolute rounded-full border border-dashed border-white/[0.18]"
          style={{ width: 226, height: 226 }}
          animate={{ rotate: -360, opacity: [0.22, 0.5, 0.22] }}
          transition={{
            rotate: { duration: heartbeatRunning ? 18 : 42, repeat: Infinity, ease: 'linear' },
            opacity: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
        <motion.div
          className="absolute rounded-full blur-[60px]"
          style={{ width: 310, height: 310, background: config.glow }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0.35, 0.58 + vitality / 220, 0.35], scale: [1, 1.1 + vitality / 1000, 1] }}
          transition={{ duration: config.breathDuration, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="relative flex items-center justify-center"
          style={{
            width: 280,
            height: 280,
            filter: `drop-shadow(0 0 28px ${config.glow}) drop-shadow(0 0 70px ${config.glow})`,
          }}
          initial={{ scale: 0 }}
          animate={{ scale: [1, 1 + vitality / 1800, 1] }}
          transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}
        >
          <MuseBrainLogo
            size={280}
            variant="brain"
            state={glyphState}
            initialState={glyphState}
            rounded={false}
            className="relative z-10"
          />
        </motion.div>
      </motion.div>

      <div className="absolute top-[calc(50%+156px)] left-1/2 -translate-x-1/2 min-w-[180px] text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={config.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: [0.7, 1, 0.7], y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' }, layout: { duration: 0.3 } }}
            className="text-sm font-light tracking-wide whitespace-nowrap text-text-primary"
          >
            {config.label}
          </motion.div>
        </AnimatePresence>
      </div>

      <motion.div
        className="absolute top-[calc(50%+182px)] left-1/2 -translate-x-1/2 flex items-center gap-2 text-[11px] text-text-muted font-light whitespace-nowrap"
        animate={{ opacity: [0.4, 0.6, 0.4] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.color, boxShadow: `0 0 10px ${config.color}` }} />
        <span>触碰我，或开始输入</span>
      </motion.div>
    </motion.div>
  )
}

import React from 'react'
import { motion } from 'framer-motion'
import { useTouchFeedback } from '../../hooks/useTouchFeedback'

interface TouchPointProps {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
  label: string
  /** 活数据预览（如最新信件标题、文件数） */
  subtitle?: string
  count?: number
  angle: number
  distance: number
  color: string
  activity?: number
  onClick: () => void
  whisper?: string
  /** 入场动画延迟（秒） */
  enterDelay?: number
}

/**
 * TouchPoint — 有机触点
 *
 * 环绕 MuseCore 的浮动触点，每个代表 Muse 的一个"器官/能力"。
 * 有有机漂移、触感反馈、未读数 badge、活数据预览。
 */
export function TouchPoint({
  icon: Icon,
  label,
  subtitle,
  count,
  angle,
  distance,
  color,
  activity = 0.2,
  onClick,
  whisper = '嗯',
  enterDelay = 0,
}: TouchPointProps) {
  const { handlers, breathVariants, currentState } = useTouchFeedback({
    ripple: true,
    whisper,
    ambientResponse: true,
    scale: { hover: 1.12, press: 0.9 },
  })

  const rad = (angle - 90) * (Math.PI / 180)
  const x = Math.cos(rad) * distance
  const y = Math.sin(rad) * distance

  const driftX = Math.sin(angle * 0.3) * 6
  const driftY = Math.cos(angle * 0.3) * 6

  return (
    <motion.div
      className="absolute"
      style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)` }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: 1,
        scale: 1,
        x: [0, driftX, 0],
        y: [0, driftY, 0],
      }}
      transition={{
        opacity: { duration: 0.5, delay: enterDelay },
        scale: { type: 'spring', stiffness: 260, damping: 22, delay: enterDelay },
        x: { duration: 6 + (angle % 3), repeat: Infinity, ease: 'easeInOut', delay: enterDelay },
        y: { duration: 6 + (angle % 3), repeat: Infinity, ease: 'easeInOut', delay: enterDelay },
      }}
    >
      <motion.div
        className="group flex flex-col items-center cursor-pointer select-none"
        style={{ transform: 'translate(-50%, -50%)' }}
        animate={currentState}
        variants={breathVariants}
        onClick={onClick}
        {...handlers}
      >
        <motion.div
          className="absolute top-7 h-px origin-left"
          style={{
            width: 46,
            x: angle > 180 ? -48 : 12,
            rotate: angle > 180 ? 0 : 180,
            background: `linear-gradient(90deg, ${color}00, ${color}88, ${color}00)`,
          }}
          animate={{ opacity: [0.1, 0.35 + activity * 0.45, 0.1], scaleX: [0.6, 1.15, 0.6] }}
          transition={{ duration: 3.2 - activity, repeat: Infinity, ease: 'easeInOut', delay: enterDelay }}
        />
        <div
          className="relative flex items-center justify-center rounded-full backdrop-blur-md border transition-colors"
          style={{
            width: 62,
            height: 62,
            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.18), ${color}22 45%, rgba(8,8,26,0.08) 100%)`,
            borderColor: `${color}${Math.round(55 + activity * 80).toString(16).padStart(2, '0')}`,
            boxShadow: `inset 0 0 18px ${color}22`,
          }}
        >
          <motion.div
            className="absolute inset-0 rounded-full blur-xl"
            style={{ background: `${color}40` }}
            animate={{
              opacity: currentState === 'hover' || currentState === 'press' ? 0.78 : 0.16 + activity * 0.22,
              scale: [0.85, 1.18 + activity * 0.25, 0.85],
            }}
            transition={{ duration: 2.8 - activity * 0.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-[-7px] rounded-full border"
            style={{ borderColor: `${color}33` }}
            animate={{ rotate: 360, opacity: [0.12, 0.38 + activity * 0.25, 0.12] }}
            transition={{
              rotate: { duration: 10 - activity * 4, repeat: Infinity, ease: 'linear' },
              opacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
            }}
          />
          <Icon size={22} className="relative" style={{ color }} />
          <motion.div
            className="absolute bottom-2 left-1/2 h-0.5 -translate-x-1/2 rounded-full"
            style={{ width: 18 + activity * 18, background: color }}
            animate={{ opacity: [0.25, 0.85, 0.25] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {count !== undefined && count > 0 && (
            <motion.div
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full px-1"
              style={{ background: color }}
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              {count > 99 ? '99+' : count}
            </motion.div>
          )}
        </div>

        <span
          className="mt-2 text-xs font-medium tracking-wide whitespace-nowrap text-text-primary/90"
        >
          {label}
        </span>

        {subtitle && (
          <motion.span
            className="mt-0.5 max-w-[104px] truncate text-center text-[10px] font-light text-text-muted"
            animate={{ opacity: [0.45, 0.78, 0.45] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            {subtitle}
          </motion.span>
        )}
      </motion.div>
    </motion.div>
  )
}

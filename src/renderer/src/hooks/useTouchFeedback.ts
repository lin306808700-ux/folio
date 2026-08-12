import { useState, useRef } from 'react'
import type { Variants } from 'framer-motion'
import { emitMuseInteraction } from '../components/muse-interaction-bus'

export interface TouchFeedbackOptions {
  /** 按压时向 ambient 场发射涟漪 */
  ripple?: boolean
  /** 释放时 Muse 的语义回应（"嗯"、"好"、"收到"） */
  whisper?: string
  /** hover 时附近粒子汇聚 */
  ambientResponse?: boolean
  /** 自定义缩放比例 */
  scale?: { hover: number; press: number }
}

/**
 * 触感反馈系统 — 让每个交互元素"活着"
 *
 * 四层反馈：
 * 1. 视觉层：scale 变化（hover 放大 / press 收缩）
 * 2. ambient 层：通过 muse-interaction-bus 广播，GlobalAmbient 响应（粒子汇聚 / 涟漪）
 * 3. 语义层：释放时 Muse 低语（"嗯" / "好" / "收到"）
 * 4. 有机层：idle 时微呼吸动画（breathVariants）
 *
 * @example
 * const { handlers, breathVariants, currentState } = useTouchFeedback({
 *   ripple: true,
 *   whisper: '嗯？',
 *   ambientResponse: true,
 * })
 *
 * <motion.div animate={currentState} variants={breathVariants} {...handlers}>
 *   ...
 * </motion.div>
 */
export function useTouchFeedback(options: TouchFeedbackOptions = {}) {
  const {
    ripple = false,
    whisper,
    ambientResponse = false,
    scale = { hover: 1.05, press: 0.95 },
  } = options

  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const pressedRef = useRef(false)

  const getRect = (el: EventTarget | null) => {
    if (!(el instanceof HTMLElement)) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  const handlers = {
    onMouseEnter: (e: React.MouseEvent) => {
      setIsHovered(true)
      if (ambientResponse) {
        emitMuseInteraction({ type: 'touch_hover', rect: getRect(e.currentTarget) })
      }
    },
    onMouseLeave: () => {
      setIsHovered(false)
      setIsPressed(false)
      pressedRef.current = false
    },
    onMouseDown: (e: React.MouseEvent) => {
      pressedRef.current = true
      setIsPressed(true)
      if (ripple) {
        emitMuseInteraction({ type: 'touch_press', rect: getRect(e.currentTarget) })
      }
    },
    onMouseUp: () => {
      if (pressedRef.current && whisper) {
        emitMuseInteraction({ type: 'touch_release', whisper })
      }
      pressedRef.current = false
      setIsPressed(false)
    },
    // 触屏支持
    onTouchStart: (e: React.TouchEvent) => {
      pressedRef.current = true
      setIsPressed(true)
      setIsHovered(true)
      if (ripple) {
        emitMuseInteraction({ type: 'touch_press', rect: getRect(e.currentTarget) })
      }
    },
    onTouchEnd: () => {
      if (pressedRef.current && whisper) {
        emitMuseInteraction({ type: 'touch_release', whisper })
      }
      pressedRef.current = false
      setIsPressed(false)
      setIsHovered(false)
    },
  }

  const currentState = isPressed ? 'press' : isHovered ? 'hover' : 'idle'

  // 无呼吸的 variants（适合不需要 idle 呼吸的元素）
  const variants: Variants = {
    idle: { scale: 1 },
    hover: { scale: scale.hover },
    press: { scale: scale.press },
  }

  // 带呼吸的 variants（适合有机元素，idle 时微呼吸 scale 1.0↔1.02）
  const breathVariants: Variants = {
    idle: {
      scale: [1, 1.02, 1],
      transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
    },
    hover: { scale: scale.hover },
    press: { scale: scale.press },
  }

  return { handlers, variants, breathVariants, currentState, isHovered, isPressed }
}

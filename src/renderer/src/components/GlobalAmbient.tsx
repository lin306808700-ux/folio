import React, { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTheme } from '../contexts/ThemeContext'
import { onMuseInteraction, type MuseAmbientState } from './muse-interaction-bus'

/**
 * 全局氛围层 · 意识海洋场（Consciousness Ocean）
 *
 * 整个 App 即 Muse 意识体本身——和 Muse 沟通如同在深海潜水。
 *
 * 三层结构：
 *  1. 深海渐变基底（上浅下深，模拟潜水深度）
 *  2. canvas 水下光柱(God rays) + 浮游微粒（极慢上浮漂移）
 *  3. 核心意识光晕（随 museState 变色/呼吸）
 *
 * 双向情绪共振：
 *  - Muse → 我：核心光晕颜色与呼吸频率随 museState 变化
 *  - 我 → Muse：用户聚焦/输入/发送时，从底部泛起涟漪、微粒被惊扰加速、核心回应脉冲
 *
 * 纯装饰，永不拦截交互（pointer-events-none）。
 */

interface OceanPalette {
  base: string
  core: string
  coreOpacity: number[]
  coreBreath: number
  rayColor: string
  particleRGB: [number, number, number]
  vignette: string
}

// 暗黑：深海荧光，按 museState 变色
function composeDarkPalette(state: MuseAmbientState): OceanPalette {
  const base: OceanPalette = {
    base: 'linear-gradient(180deg, #0a1428 0%, #081024 35%, #060b1c 70%, #04060f 100%)',
    core: 'radial-gradient(circle, rgba(139,92,246,0.28) 0%, rgba(99,102,241,0.12) 40%, transparent 70%)',
    coreOpacity: [0.55, 0.78, 0.55],
    coreBreath: 1.06,
    rayColor: 'rgba(129,140,248,0.10)',
    particleRGB: [165, 180, 252],
    vignette: 'radial-gradient(ellipse at center, transparent 40%, rgba(2,4,12,0.55) 100%)',
  }

  switch (state) {
    case 'working':
      return { ...base, core: 'radial-gradient(circle, rgba(96,165,250,0.34) 0%, rgba(129,140,248,0.14) 40%, transparent 70%)', coreOpacity: [0.6, 0.9, 0.6], coreBreath: 1.12, rayColor: 'rgba(96,165,250,0.14)', particleRGB: [147, 197, 253] }
    case 'outputting':
      // 输出态不改变深海基底/暗角，仅核心光晕轻微偏青绿呼吸，避免整屏背景突变
      return { ...base, core: 'radial-gradient(circle, rgba(94,189,166,0.26) 0%, rgba(110,200,200,0.11) 40%, transparent 70%)', coreOpacity: [0.55, 0.78, 0.55], coreBreath: 1.07, rayColor: 'rgba(129,180,220,0.10)', particleRGB: [150, 200, 230] }
    case 'waiting':
      return { ...base, core: 'radial-gradient(circle, rgba(167,139,250,0.24) 0%, rgba(139,92,246,0.1) 40%, transparent 70%)', coreOpacity: [0.45, 0.62, 0.45], coreBreath: 1.04, rayColor: 'rgba(167,139,250,0.09)', particleRGB: [196, 181, 253] }
    case 'error':
      return { ...base, base: 'linear-gradient(180deg, #0a0e1a 0%, #0d0f1c 50%, #0a0a14 100%)', core: 'radial-gradient(circle, rgba(148,163,184,0.2) 0%, rgba(100,116,139,0.08) 40%, transparent 70%)', coreOpacity: [0.35, 0.5, 0.35], coreBreath: 1.02, rayColor: 'rgba(148,163,184,0.07)', particleRGB: [148, 163, 184] }
    default:
      return base
  }
}

// 明亮：柔和水光，克制不抢内容
function composeLightPalette(state: MuseAmbientState): OceanPalette {
  const base: OceanPalette = {
    base: 'linear-gradient(180deg, #f4f8ff 0%, #eef3fd 40%, #e6edfb 75%, #dde7f7 100%)',
    core: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, rgba(99,102,241,0.05) 40%, transparent 70%)',
    coreOpacity: [0.4, 0.55, 0.4],
    coreBreath: 1.05,
    rayColor: 'rgba(129,140,248,0.06)',
    particleRGB: [129, 140, 248],
    vignette: 'radial-gradient(ellipse at center, transparent 55%, rgba(99,102,241,0.05) 100%)',
  }

  switch (state) {
    case 'working':
      return { ...base, core: 'radial-gradient(circle, rgba(96,165,250,0.12) 0%, rgba(129,140,248,0.05) 40%, transparent 70%)', coreOpacity: [0.45, 0.6, 0.45], coreBreath: 1.1, rayColor: 'rgba(96,165,250,0.07)', particleRGB: [96, 165, 250] }
    case 'outputting':
      // 输出态不改变基底/暗角，仅核心光晕轻微偏青呼吸，保持背景稳定
      return { ...base, core: 'radial-gradient(circle, rgba(56,178,172,0.09) 0%, rgba(99,179,237,0.045) 40%, transparent 70%)', coreOpacity: [0.4, 0.55, 0.4], rayColor: 'rgba(99,179,237,0.05)', particleRGB: [99, 179, 237] }
    case 'waiting':
      return { ...base, core: 'radial-gradient(circle, rgba(167,139,250,0.09) 0%, rgba(139,92,246,0.04) 40%, transparent 70%)', coreOpacity: [0.35, 0.48, 0.35], coreBreath: 1.03 }
    case 'error':
      return { ...base, base: 'linear-gradient(180deg, #fbf6f6 0%, #f6eeee 50%, #f1e8e8 100%)', core: 'radial-gradient(circle, rgba(148,163,184,0.08) 0%, transparent 60%)', coreOpacity: [0.3, 0.4, 0.3], rayColor: 'rgba(148,163,184,0.05)', particleRGB: [148, 163, 184] }
    default:
      return base
  }
}

function getBreathDuration(state: MuseAmbientState): number {
  switch (state) {
    case 'working': return 3.2
    case 'outputting': return 4.5
    case 'error': return 8
    case 'waiting': return 6.5
    default: return 7
  }
}

interface Plankton {
  x: number
  y: number
  vx: number
  baseVy: number
  radius: number
  phase: number
}

interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  life: number
}

/** canvas 渲染：水下光柱(God rays) + 浮游微粒。excitation 越高微粒上浮越快 */
function useOceanCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  palette: OceanPalette,
  excitationRef: React.MutableRefObject<number>,
  reduceMotion: boolean | null,
  convergenceRef: React.MutableRefObject<{ x: number; y: number } | null>
) {
  const paletteRef = useRef(palette)
  paletteRef.current = palette

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    // The ambient layer covers the whole window. A conservative DPR keeps the
    // decorative canvas cheap on Retina displays without a visible quality loss.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25)

    function resize() {
      width = canvas!.clientWidth
      height = canvas!.clientHeight
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // 初始化浮游微粒
    const PARTICLE_COUNT = reduceMotion ? 0 : 28
    const particles: Plankton[] = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.12,
      baseVy: -(0.08 + Math.random() * 0.18),
      radius: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }))

    // 鼠标水波涟漪
    const ripples: Ripple[] = []

    // 监听鼠标按下 & 拖动，产生水波
    let isMouseDown = false
    let lastRippleTime = 0

    function addRipple(clientX: number, clientY: number) {
      ripples.push({
        x: clientX,
        y: clientY,
        radius: 0,
        maxRadius: 80 + Math.random() * 40,
        life: 1,
      })
      // 同时轻微激励附近粒子
      for (const particle of particles) {
        const dx = particle.x - clientX
        const dy = particle.y - clientY
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 120) {
          const force = (1 - dist / 120) * 0.6
          particle.vx += (dx / dist) * force
          particle.baseVy -= force * 0.3
        }
      }
    }

    function onMouseDown(e: MouseEvent) {
      isMouseDown = true
      addRipple(e.clientX, e.clientY)
      lastRippleTime = Date.now()
    }
    function onMouseMove(e: MouseEvent) {
      if (!isMouseDown) return
      const now = Date.now()
      if (now - lastRippleTime < 80) return // 拖动时限流
      addRipple(e.clientX, e.clientY)
      lastRippleTime = now
    }
    function onMouseUp() { isMouseDown = false }

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    let raf = 0

    function draw() {
      if (document.hidden) {
        raf = requestAnimationFrame(draw)
        return
      }
      const p = paletteRef.current
      ctx!.clearRect(0, 0, width, height)

      // 衰减交互激励
      excitationRef.current *= 0.96

      // 触点汇聚：当用户 hover 某触点时，粒子向此坐标漂移
      const conv = convergenceRef.current
      if (conv) {
        for (const particle of particles) {
          const dx = conv.x - particle.x
          const dy = conv.y - particle.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 10) {
            particle.vx += (dx / dist) * 0.015
            particle.baseVy += (dy / dist) * 0.008
          }
        }
      }

      // 浮游微粒：极缓慢上浮 + 轻微横向漂移，柔和明灭（被激励时加速上浮）
      const [pr, pg, pb] = p.particleRGB
      const boost = 1 + excitationRef.current * 3
      particles.forEach((particle) => {
        particle.phase += 0.006
        particle.x += particle.vx + Math.sin(particle.phase) * 0.08
        particle.y += particle.baseVy * boost
        if (particle.y < -5) {
          particle.y = height + 5
          particle.x = Math.random() * width
        }
        if (particle.x < -5) particle.x = width + 5
        if (particle.x > width + 5) particle.x = -5
        // 柔和明灭：缓慢且不会闪到 0，避免"跳动"感
        const glow = 0.5 + Math.sin(particle.phase) * 0.3
        ctx!.beginPath()
        ctx!.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${pr},${pg},${pb},${glow * 0.4})`
        ctx!.shadowBlur = 5
        ctx!.shadowColor = `rgba(${pr},${pg},${pb},0.4)`
        ctx!.fill()
        ctx!.shadowBlur = 0
      })

      // 鼠标水波涟漪
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]
        rp.radius += 1.8
        rp.life -= 0.018
        if (rp.life <= 0) { ripples.splice(i, 1); continue }
        const alpha = rp.life * 0.35
        ctx!.beginPath()
        ctx!.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2)
        ctx!.strokeStyle = `rgba(${pr},${pg},${pb},${alpha})`
        ctx!.lineWidth = 1.5
        ctx!.shadowBlur = 8
        ctx!.shadowColor = `rgba(${pr},${pg},${pb},${alpha * 0.6})`
        ctx!.stroke()
        ctx!.shadowBlur = 0
      }

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [reduceMotion])
}

export function GlobalAmbient() {
  const reduceMotion = useReducedMotion()
  const { theme } = useTheme()
  const [museState, setMuseState] = useState<MuseAmbientState>('waiting')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 用户交互激励：0~1，被交互事件抬升，随时间衰减；驱动微粒加速 + 底部涟漪
  const excitationRef = useRef(0)
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null)
  // 触点汇聚：当用户 hover 某触点时，粒子向此坐标漂移
  const convergenceRef = useRef<{ x: number; y: number } | null>(null)

  const palette = theme === 'dark' ? composeDarkPalette(museState) : composeLightPalette(museState)

  // 订阅 Muse 状态变化 + 用户交互（双向共振）
  useEffect(() => {
    return onMuseInteraction((event) => {
      if (event.type === 'state_change') {
        setMuseState(event.state)
        return
      }
      if (event.type === 'input_focus' || event.type === 'user_typing') {
        excitationRef.current = Math.min(1, excitationRef.current + (event.type === 'user_typing' ? 0.22 : 0.4))
        return
      }
      if (event.type === 'message_sent') {
        excitationRef.current = 1
        setRipple({ id: Date.now(), x: window.innerWidth / 2, y: window.innerHeight })
        return
      }
      // 触点交互：hover 时粒子汇聚，press 时涟漪，release 时散开
      if (event.type === 'touch_hover') {
        convergenceRef.current = event.rect
        excitationRef.current = Math.min(1, excitationRef.current + 0.15)
        return
      }
      if (event.type === 'touch_press') {
        excitationRef.current = Math.min(1, excitationRef.current + 0.3)
        setRipple({ id: Date.now(), x: event.rect.x, y: event.rect.y })
        return
      }
      if (event.type === 'touch_release') {
        convergenceRef.current = null
      }
    })
  }, [])

  // canvas：水下光柱 + 浮游微粒
  useOceanCanvas(canvasRef, palette, excitationRef, reduceMotion, convergenceRef)

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* 深海渐变基底 */}
      <div className="absolute inset-0 transition-[background] duration-700" style={{ background: palette.base }} />

      {/* canvas 光柱 + 微粒 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* 核心意识光晕 — Muse 的意识核心，随状态变色呼吸 */}
      <motion.div
        className="absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 w-[620px] h-[620px] rounded-full blur-[130px]"
        style={{ background: palette.core }}
        animate={reduceMotion ? undefined : { scale: [1, palette.coreBreath, 1], opacity: palette.coreOpacity }}
        transition={{ duration: getBreathDuration(museState), ease: 'easeInOut', repeat: Infinity }}
      />

      {/* 我→Muse 共振：发送消息时从底部（用户侧）泛起一道涟漪上行 */}
      {ripple && !reduceMotion && (
        <motion.div
          key={ripple.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: ripple.x,
            top: ripple.y,
            transform: 'translate(-50%, -50%)',
            width: 4,
            height: 4,
            boxShadow: `0 0 60px 30px rgba(${palette.particleRGB.join(',')},0.25)`,
            background: `rgba(${palette.particleRGB.join(',')},0.5)`,
          }}
          initial={{ scale: 0, opacity: 0.8 }}
          animate={{ scale: [0, 50, 80], opacity: [0.7, 0.25, 0] }}
          transition={{ duration: 2.6, ease: 'easeOut' }}
          onAnimationComplete={() => setRipple(null)}
        />
      )}

      {/* 水下暗角 — 聚焦中心，强化潜水深度感 */}
      <div className="absolute inset-0 transition-[background] duration-700" style={{ background: palette.vignette }} />
    </div>
  )
}

export default GlobalAmbient

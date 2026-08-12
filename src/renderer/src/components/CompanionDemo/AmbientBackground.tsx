import React, { useEffect, useMemo, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Muse 状态类型（意识体不需要 MuseAvatar，自己声明）
 */
export type MuseState = 'idle' | 'working' | 'outputting' | 'error' | 'waiting'

interface AmbientBackgroundProps {
  state: MuseState
  /** 用户正在输入时为 true，触发感应波纹 */
  isUserTyping?: boolean
}

/**
 * Muse 意识体 · 背景即 Muse
 *
 * 整个背景就是 Muse 的存在——它不占任何具象空间，
 * 而是通过光色、呼吸节律、粒子密度、场域脉动来表达情绪。
 *
 * 设计理念：用户在 Muse 的意识场内对话，像鱼在海中游——
 * 海不需要一个形象来表示自己的存在，它就是包裹你的一切。
 *
 * 状态映射：
 * - idle：近乎静止的深空，偶尔有微光尘埃缓慢飘过（星尘）
 * - working：脉动加速，核心光晕收缩聚焦——"我在凝神思考"
 * - outputting：暖色从中心扩散，像呼吸舒展——"我正在诉说"
 * - waiting：柔和律动，平静水波——"我在听你说"
 * - error：色温骤冷，轻微颤动——"我感到不安"
 */
export function AmbientBackground({ state, isUserTyping = false }: AmbientBackgroundProps) {
  const reduceMotion = useReducedMotion()
  const palette = useMemo(() => composePalette(state), [state])
  const breathDuration = getBreathDuration(state)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 微粒子场（canvas 绘制，轻量）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || reduceMotion) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let particles: Particle[] = []
    const particleCount = state === 'working' ? 60 : state === 'outputting' ? 45 : 25

    function resize() {
      canvas!.width = canvas!.offsetWidth * window.devicePixelRatio
      canvas!.height = canvas!.offsetHeight * window.devicePixelRatio
      ctx!.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    // 初始化粒子
    particles = Array.from({ length: particleCount }, () => createParticle(canvas!))

    function draw() {
      ctx!.clearRect(0, 0, canvas!.offsetWidth, canvas!.offsetHeight)
      const speed = state === 'working' ? 1.5 : state === 'outputting' ? 1.0 : 0.4
      particles.forEach((p) => {
        p.x += p.vx * speed
        p.y += p.vy * speed
        p.life -= 0.002

        if (p.life <= 0 || p.x < -10 || p.x > canvas!.offsetWidth + 10 || p.y < -10 || p.y > canvas!.offsetHeight + 10) {
          Object.assign(p, createParticle(canvas!))
        }

        const alpha = p.life * p.baseAlpha
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(${p.r}, ${p.g}, ${p.b}, ${alpha})`
        ctx!.fill()
      })
      animationId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }, [state, reduceMotion])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* 基底：深色场 */}
      <motion.div
        className="absolute inset-0"
        animate={{ background: palette.base }}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
      />

      {/* 核心意识光晕 — Muse 的"心"，在屏幕中心偏上 */}
      <motion.div
        className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
        animate={{
          width: palette.coreSize,
          height: palette.coreSize,
          background: palette.coreGlow,
          opacity: palette.coreOpacity,
          scale: [1, palette.coreBreath, 1],
        }}
        transition={{
          width: { duration: 1.2, ease: 'easeInOut' },
          height: { duration: 1.2, ease: 'easeInOut' },
          background: { duration: 1.5, ease: 'easeInOut' },
          opacity: { duration: 1, ease: 'easeInOut' },
          scale: { duration: breathDuration, ease: 'easeInOut', repeat: Infinity },
        }}
      />

      {/* 环绕流光带 — 像深海中的生物荧光 */}
      {palette.auroraStrips.map((strip, index) => (
        <motion.div
          key={index}
          className="absolute rounded-full blur-[80px]"
          style={{ width: strip.size, height: strip.size * 0.4, left: strip.left, top: strip.top }}
          animate={reduceMotion ? undefined : {
            background: strip.color,
            opacity: [strip.opacity, strip.opacity * 0.5, strip.opacity],
            x: [0, strip.drift, 0],
            y: [0, strip.drift * 0.3, 0],
            rotate: [0, strip.rotate, 0],
          }}
          transition={{
            duration: breathDuration + index * 3,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
        />
      ))}

      {/* 粒子 canvas 层 — 星尘/浮游微光 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: reduceMotion ? 0 : 0.7 }}
      />

      {/* 用户输入时的感应波纹 — 从底部中央扩散 */}
      {isUserTyping && !reduceMotion && (
        <motion.div
          className="absolute left-1/2 bottom-28 -translate-x-1/2 rounded-full border border-white/10"
          initial={{ width: 20, height: 20, opacity: 0.4 }}
          animate={{ width: 300, height: 300, opacity: 0 }}
          transition={{ duration: 2, ease: 'easeOut', repeat: Infinity }}
        />
      )}

      {/* 柔和暗角 — 把视线聚拢到中心对话区 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.5)_100%)]" />
    </div>
  )
}

// ===== 调色板 =====
interface AmbientPalette {
  base: string
  coreGlow: string
  coreSize: number
  coreOpacity: number
  coreBreath: number // scale 脉动幅度
  auroraStrips: AuroraStrip[]
}

interface AuroraStrip {
  size: number
  left: string
  top: string
  color: string
  opacity: number
  drift: number
  rotate: number
}

function composePalette(state: MuseState): AmbientPalette {
  const base: AmbientPalette = {
    base: 'linear-gradient(180deg, #0a0a1a 0%, #0f0e2a 50%, #12112b 100%)',
    coreGlow: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, rgba(99,102,241,0.2) 40%, transparent 70%)',
    coreSize: 500,
    coreOpacity: 0.6,
    coreBreath: 1.06,
    auroraStrips: [
      { size: 600, left: '-5%', top: '15%', color: 'rgba(129,140,248,0.15)', opacity: 0.3, drift: 30, rotate: 5 },
      { size: 500, left: '55%', top: '50%', color: 'rgba(167,139,250,0.12)', opacity: 0.25, drift: -25, rotate: -3 },
      { size: 350, left: '20%', top: '70%', color: 'rgba(99,102,241,0.1)', opacity: 0.2, drift: 20, rotate: 4 },
    ],
  }

  switch (state) {
    case 'working':
      return {
        ...base,
        coreGlow: 'radial-gradient(circle, rgba(96,165,250,0.6) 0%, rgba(129,140,248,0.3) 40%, transparent 70%)',
        coreSize: 380,
        coreOpacity: 0.75,
        coreBreath: 1.12,
        auroraStrips: [
          { size: 450, left: '10%', top: '20%', color: 'rgba(96,165,250,0.2)', opacity: 0.4, drift: 40, rotate: 8 },
          { size: 380, left: '50%', top: '40%', color: 'rgba(139,92,246,0.18)', opacity: 0.35, drift: -35, rotate: -6 },
          { size: 300, left: '30%', top: '60%', color: 'rgba(59,130,246,0.15)', opacity: 0.3, drift: 25, rotate: 5 },
        ],
      }
    case 'outputting':
      return {
        ...base,
        base: 'linear-gradient(180deg, #0a0a1a 0%, #0f1a2a 50%, #0f1e25 100%)',
        coreGlow: 'radial-gradient(circle, rgba(52,211,153,0.45) 0%, rgba(110,231,183,0.2) 40%, transparent 70%)',
        coreSize: 600,
        coreOpacity: 0.6,
        coreBreath: 1.08,
        auroraStrips: [
          { size: 650, left: '5%', top: '25%', color: 'rgba(110,231,183,0.12)', opacity: 0.3, drift: 20, rotate: 3 },
          { size: 500, left: '45%', top: '45%', color: 'rgba(52,211,153,0.1)', opacity: 0.25, drift: -18, rotate: -2 },
          { size: 400, left: '25%', top: '65%', color: 'rgba(167,139,250,0.08)', opacity: 0.2, drift: 15, rotate: 2 },
        ],
      }
    case 'waiting':
      return {
        ...base,
        coreGlow: 'radial-gradient(circle, rgba(167,139,250,0.35) 0%, rgba(139,92,246,0.15) 40%, transparent 70%)',
        coreSize: 520,
        coreOpacity: 0.5,
        coreBreath: 1.04,
        auroraStrips: [
          { size: 550, left: '0%', top: '20%', color: 'rgba(167,139,250,0.1)', opacity: 0.25, drift: 15, rotate: 2 },
          { size: 480, left: '50%', top: '50%', color: 'rgba(129,140,248,0.08)', opacity: 0.2, drift: -12, rotate: -2 },
        ],
      }
    case 'error':
      return {
        ...base,
        base: 'linear-gradient(180deg, #0a0a12 0%, #15141f 50%, #1a1825 100%)',
        coreGlow: 'radial-gradient(circle, rgba(148,163,184,0.3) 0%, rgba(100,116,139,0.15) 40%, transparent 70%)',
        coreSize: 350,
        coreOpacity: 0.4,
        coreBreath: 1.02,
        auroraStrips: [
          { size: 400, left: '15%', top: '30%', color: 'rgba(148,163,184,0.1)', opacity: 0.2, drift: 8, rotate: 1 },
          { size: 350, left: '55%', top: '55%', color: 'rgba(100,116,139,0.08)', opacity: 0.15, drift: -6, rotate: -1 },
        ],
      }
    default: // idle
      return base
  }
}

function getBreathDuration(state: MuseState): number {
  switch (state) {
    case 'working': return 3
    case 'outputting': return 4.5
    case 'error': return 8
    case 'waiting': return 6
    default: return 7
  }
}

// ===== 粒子 =====
interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  r: number
  g: number
  b: number
  baseAlpha: number
  life: number
}

function createParticle(canvas: HTMLCanvasElement): Particle {
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.6,
    vy: (Math.random() - 0.5) * 0.4,
    radius: 1 + Math.random() * 2,
    r: 160 + Math.floor(Math.random() * 80),
    g: 140 + Math.floor(Math.random() * 60),
    b: 220 + Math.floor(Math.random() * 35),
    baseAlpha: 0.15 + Math.random() * 0.25,
    life: 0.5 + Math.random() * 0.5,
  }
}

export default AmbientBackground

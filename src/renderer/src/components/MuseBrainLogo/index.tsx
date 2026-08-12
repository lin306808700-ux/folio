import React, { useEffect, useRef, useState } from 'react'
import { MuseBrainRenderer, MuseGlyphVariant, MuseState } from './renderer'
import { onMuseInteraction } from '../muse-interaction-bus'

interface MuseBrainLogoProps {
  state?: MuseState
  initialState?: MuseState
  variant?: MuseGlyphVariant
  size?: number
  className?: string
  rounded?: boolean
}

/**
 * Muse Brain Logo — 3D WebGPU neural particle brain
 *
 * Replaces a static logo with a living, breathing consciousness indicator.
 * Listens to muse-interaction-bus for state changes automatically.
 * Falls back to a simple CSS glow orb if WebGPU is unavailable.
 */
export function MuseBrainLogo({
  state: propState,
  initialState = 'idle',
  variant = 'brain',
  size = 48,
  className = '',
  rounded = true,
}: MuseBrainLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MuseBrainRenderer | null>(null)
  const [webgpuAvailable, setWebgpuAvailable] = useState(true)
  const [busState, setBusState] = useState<MuseState>(initialState)

  // Listen to interaction bus for state changes
  useEffect(() => {
    const cleanup = onMuseInteraction((event) => {
      if (event.type === 'state_change') {
        setBusState(event.state as MuseState)
      }
    })
    return cleanup
  }, [])

  const activeState = propState ?? busState

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr

    const renderer = new MuseBrainRenderer(variant)
    rendererRef.current = renderer

    renderer.init(canvas).then((ok) => {
      if (ok) {
        renderer.setState(activeState)
        renderer.start()
      } else {
        setWebgpuAvailable(false)
      }
    })

    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [size, variant])

  // Update state when it changes (from prop or bus)
  useEffect(() => {
    rendererRef.current?.setState(activeState)
  }, [activeState])

  if (!webgpuAvailable) {
    return <FallbackOrb state={activeState} size={size} className={className} />
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, borderRadius: rounded ? '50%' : 0 }}
    />
  )
}

/** CSS-only fallback when WebGPU is not available */
function FallbackOrb({ state, size, className }: { state: MuseState; size: number; className: string }) {
  const colorMap: Record<MuseState, string> = {
    idle: 'rgba(100, 200, 255, 0.6)',
    working: 'rgba(140, 100, 255, 0.7)',
    outputting: 'rgba(255, 160, 60, 0.7)',
    error: 'rgba(255, 80, 80, 0.7)',
    waiting: 'rgba(120, 180, 240, 0.5)',
  }

  return (
    <div
      className={`rounded-full animate-pulse ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${colorMap[state]}, transparent 70%)`,
        boxShadow: `0 0 ${size / 3}px ${colorMap[state]}`,
      }}
    />
  )
}

export default MuseBrainLogo

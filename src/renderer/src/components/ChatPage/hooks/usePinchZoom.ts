// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import { useState, useEffect, useRef, useCallback } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 3

/**
 * Pinch-to-zoom hook — 直接操作 DOM 避免 React 重渲染闪烁。
 * 缩放过程中通过 ref 直写 element.style.zoom，
 * 仅在手势结束时同步一次 React state（驱动恢复按钮显隐）。
 */
export function usePinchZoom() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isZoomed, setIsZoomed] = useState(false)
  const [displayScale, setDisplayScale] = useState(1) // 仅用于按钮文案
  const scaleRef = useRef(1)

  // ── Touch (touchscreen) ──
  const touchGesture = useRef({
    active: false,
    startDistance: 0,
    startScale: 1,
  })

  const getDistance = (touches: TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  /** 直写 DOM zoom，不触发 React render */
  const applyZoom = useCallback((scale: number) => {
    scaleRef.current = scale
    const el = containerRef.current
    if (el) {
      el.style.zoom = scale > 1.01 ? String(scale) : ''
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // ── Touch handlers ──
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      e.preventDefault()
      touchGesture.current = {
        active: true,
        startDistance: getDistance(e.touches),
        startScale: scaleRef.current,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!touchGesture.current.active || e.touches.length !== 2) return
      e.preventDefault()
      const dist = getDistance(e.touches)
      const ratio = dist / touchGesture.current.startDistance
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, touchGesture.current.startScale * ratio))
      applyZoom(next)
    }

    const onTouchEnd = () => {
      if (!touchGesture.current.active) return
      touchGesture.current.active = false
      // 手势结束：同步一次 React state
      const s = scaleRef.current
      setIsZoomed(s > 1.01)
      setDisplayScale(s)
    }

    // ── Trackpad pinch (Chromium fires wheel + ctrlKey for pinch) ──
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = -e.deltaY * 0.01
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current + delta))
      applyZoom(next)
      // 防抖：trackpad 松手后同步 React state
      if (wheelEndTimer) clearTimeout(wheelEndTimer)
      wheelEndTimer = setTimeout(() => {
        const s = scaleRef.current
        setIsZoomed(s > 1.01)
        setDisplayScale(s)
      }, 200)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      if (wheelEndTimer) clearTimeout(wheelEndTimer)
    }
  }, [applyZoom])

  const resetZoom = useCallback(() => {
    applyZoom(1)
    setIsZoomed(false)
    setDisplayScale(1)
  }, [applyZoom])

  return { containerRef, scale: displayScale, isZoomed, resetZoom }
}

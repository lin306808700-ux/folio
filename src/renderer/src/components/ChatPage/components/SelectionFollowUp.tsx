// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus } from 'lucide-react'

interface SelectionFollowUpProps {
  containerRef: React.RefObject<HTMLElement>
  enabled: boolean
  onFollowUp: (text: string) => void
}

interface SelectionAction {
  text: string
  x: number
  y: number
  placement: 'top' | 'bottom'
  truncated: boolean
}

export function SelectionFollowUp({ containerRef, enabled, onFollowUp }: SelectionFollowUpProps) {
  const [action, setAction] = useState<SelectionAction | null>(null)

  useEffect(() => {
    if (!enabled) return

    const captureSelection = () => {
      const selection = window.getSelection()
      const container = containerRef.current
      if (!selection || selection.isCollapsed || !container || selection.rangeCount === 0) {
        setAction(null)
        return
      }

      const range = selection.getRangeAt(0)
      const commonNode = range.commonAncestorContainer
      if (!container.contains(commonNode.nodeType === Node.TEXT_NODE ? commonNode.parentNode : commonNode)) {
        setAction(null)
        return
      }

      const text = selection.toString().trim()
      if (text.length < 2) {
        setAction(null)
        return
      }

      const rect = range.getBoundingClientRect()
      const x = Math.min(window.innerWidth - 46, Math.max(46, rect.left + rect.width / 2))
      const placement = rect.top >= 48 ? 'top' : 'bottom'
      const y = placement === 'top' ? rect.top - 10 : rect.bottom + 10
      setAction({ text: text.slice(0, 8000), x, y, placement, truncated: text.length > 8000 })
    }

    const clearSelectionAction = (event: Event) => {
      // scroll / resize 的 event.target 是 document 或 window，没有 closest，
      // 因此必须先确认是元素节点再调用。
      const target = event.target
      if (target instanceof Element && target.closest('[data-selection-follow-up]')) return
      setAction(null)
    }

    const container = containerRef.current
    container?.addEventListener('mouseup', captureSelection)
    container?.addEventListener('keyup', captureSelection)
    container?.addEventListener('touchend', captureSelection)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAction(null)
    }
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', clearSelectionAction, true)
    window.addEventListener('resize', clearSelectionAction)
    document.addEventListener('mousedown', clearSelectionAction)
    return () => {
      container?.removeEventListener('mouseup', captureSelection)
      container?.removeEventListener('keyup', captureSelection)
      container?.removeEventListener('touchend', captureSelection)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', clearSelectionAction, true)
      window.removeEventListener('resize', clearSelectionAction)
      document.removeEventListener('mousedown', clearSelectionAction)
    }
  }, [containerRef, enabled])

  if (!action) return null

  return createPortal(
    <button
      data-selection-follow-up
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onFollowUp(action.text)
        window.getSelection()?.removeAllRanges()
        setAction(null)
      }}
      className="fixed z-[100] flex h-9 items-center gap-1.5 rounded-lg border border-border-subtle/70 bg-surface/95 px-3 text-[11px] font-medium text-text-primary shadow-[0_8px_24px_rgba(0,0,0,0.22)] backdrop-blur-xl transition-colors hover:border-brand/40 hover:text-brand"
      style={{
        left: action.x,
        top: action.y,
        transform: action.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
      title="引用选中内容继续提问"
      aria-label="引用选中内容继续提问"
    >
      <MessageSquarePlus size={13} strokeWidth={1.8} />
      {action.truncated ? '追问（前 8000 字）' : '追问'}
    </button>,
    document.body
  )
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Folder, Plus } from 'lucide-react'
import { isElectron } from '../utils/config'

interface WorkspaceInfo {
  name: string
  path: string
}

interface RecentWorkspace extends WorkspaceInfo {
  lastUsed: number
}

export function WorkspaceSwitcher({ expanded }: { expanded: boolean }) {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [recent, setRecent] = useState<RecentWorkspace[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 64, top: 80 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const refreshWorkspace = useCallback(async () => {
    if (!isElectron) return
    const result = await window.electronAPI?.workspace?.getCurrent?.()
    setWorkspace(result?.success ? result.data : null)
  }, [])

  useEffect(() => {
    if (!isElectron) return
    refreshWorkspace()
    return window.electronAPI?.workspace?.onChanged?.((nextWorkspace) => {
      setWorkspace(nextWorkspace)
    })
  }, [refreshWorkspace])

  useEffect(() => {
    if (!menuOpen) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setMenuOpen(false)
      }
    }
    const closeMenu = () => setMenuOpen(false)

    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menuOpen])

  if (!isElectron) return null

  const toggleMenu = async () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }

    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPosition({
        left: rect.right + 8,
        top: Math.max(12, Math.min(rect.top, window.innerHeight - 340)),
      })
    }
    setMenuOpen(true)

    const result = await window.electronAPI?.workspace?.listWorkspaces?.()
    if (result?.success) setRecent(result.data || [])
  }

  const switchWorkspace = async (path: string) => {
    setMenuOpen(false)
    await window.electronAPI?.workspace?.setWorkspace?.(path)
  }

  const selectNewWorkspace = async () => {
    setMenuOpen(false)
    await window.electronAPI?.workspace?.openWorkspaceSelector?.()
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        title={workspace?.path || '选择工作区'}
        className={`flex w-full min-h-10 items-center rounded-lg text-left text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-colors ${
          expanded ? 'gap-3 px-3 py-2' : 'justify-center px-0 py-2'
        }`}
      >
        <span className="flex w-5 flex-shrink-0 items-center justify-center text-brand">
          <Folder size={17} />
        </span>
        {expanded && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] leading-3 text-text-faint">工作区</span>
              <span className="block truncate text-xs font-semibold text-text-secondary">
                {workspace?.name || '选择工作区'}
              </span>
            </span>
            <ChevronDown
              size={13}
              className={`flex-shrink-0 text-text-faint transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.12 }}
              style={{ left: menuPosition.left, top: menuPosition.top }}
              className="fixed z-[100] w-72 overflow-hidden rounded-lg border border-border-subtle/70 bg-surface shadow-xl dark:border-white/[0.08] dark:bg-slate-800"
            >
              <div className="border-b border-border-subtle/50 px-3 py-2 text-[10px] font-semibold text-text-faint dark:border-white/[0.06]">
                最近工作区
              </div>
              <div className="max-h-64 overflow-y-auto py-1 scroll-dark">
                {recent.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-faint">暂无记录</div>
                ) : recent.map((item) => {
                  const active = item.path === workspace?.path
                  return (
                    <button
                      key={item.path}
                      onClick={() => switchWorkspace(item.path)}
                      title={item.path}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-text-primary/[0.06]"
                    >
                      <Folder size={13} className={active ? 'flex-shrink-0 text-brand' : 'flex-shrink-0 text-text-faint'} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs ${active ? 'font-semibold text-brand' : 'text-text-secondary'}`}>
                          {item.name}
                        </span>
                        <span className="block truncate text-[10px] text-text-faint">{item.path}</span>
                      </span>
                      {active && <Check size={12} className="flex-shrink-0 text-brand" />}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={selectNewWorkspace}
                className="flex w-full items-center gap-2 border-t border-border-subtle/50 px-3 py-2.5 text-xs text-brand transition-colors hover:bg-brand/10 dark:border-white/[0.06]"
              >
                <Plus size={13} />
                选择其他文件夹...
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

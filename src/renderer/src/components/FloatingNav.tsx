// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, History, ChevronsRight, ChevronsLeft, Sun, Moon, BookOpen, Settings } from 'lucide-react'
import { isElectron } from '../utils/config'
import { useTheme } from '../contexts/ThemeContext'
import { MuseBrainLogo } from './MuseBrainLogo'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { SettingsModal } from './SettingsModal'

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

function FloatingNavItem({
  item,
  active,
  expanded,
}: {
  item: NavItem
  active: boolean
  expanded: boolean
}) {
  return (
    <Link
      key={item.path}
      to={item.path}
      title={!expanded ? item.label : undefined}
      className={`relative flex items-center rounded-xl text-sm transition-all active:scale-95 ${
        expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
      } ${
        active
          ? 'bg-text-primary/[0.1] text-text-primary font-semibold'
          : 'text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] hover:scale-105'
      }`}
    >
      <span className="w-5 flex-shrink-0 flex items-center justify-center relative z-10">
        <item.icon size={18} />
      </span>
      <AnimatePresence>
        {expanded && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex-1 whitespace-nowrap overflow-hidden relative z-10"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  )
}

/**
 * 固定图标导航
 *
 * 左缘固定一列图标栏（始终可见），点击按钮手动展开/收起文字标签。
 */
export function FloatingNav() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelConfigured, setModelConfigured] = useState(true)

  // 模型配置检查 — 未配置时自动弹出设置弹窗引导填写
  useEffect(() => {
    ;(window as any).electronAPI?.settings?.get?.().then((res: any) => {
      if (res && res.configured === false) {
        setModelConfigured(false)
        setSettingsOpen(true)
      }
    })
  }, [])

  const navItems: NavItem[] = [
    { path: '/chat', label: '对话', icon: MessageCircle },
    { path: '/learning', label: '学习图谱', icon: BookOpen },
    { path: '/history', label: '历史', icon: History },
  ]

  const navWidth = expanded ? 200 : 56

  return (
    <motion.nav
      animate={{ width: navWidth }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="relative z-10 flex-shrink-0 flex flex-col border-r border-border-subtle/60 overflow-hidden"
    >
      {/* macOS 红绿灯按钮区域 — 留足空间避免 logo 贴顶/被遮 */}
      {isElectron && <div className="drag-region h-10 flex-shrink-0" />}

      <div className={`flex-1 flex flex-col gap-1 ${expanded ? 'p-3' : 'px-2 py-3'} overflow-y-auto scroll-dark ${isElectron ? '' : 'pt-4'}`}>
        {/* Logo */}
        <div className={`flex items-center mb-3 ${expanded ? 'justify-center py-3' : 'justify-center py-2'}`}>
          <Link
            to="/chat"
            title="回到对话"
            className={`flex-shrink-0 rounded-xl flex items-center justify-center overflow-hidden border border-border-subtle/50 bg-surface/[0.08] shadow-[0_0_24px_rgba(56,189,248,0.08)] transition-all duration-200 cursor-pointer hover:border-cyan-300/25 hover:bg-surface/[0.12] active:scale-95 dark:bg-white/[0.06] dark:shadow-[0_0_28px_rgba(56,189,248,0.16)] ${expanded ? 'w-[120px] h-[120px]' : 'w-10 h-10'}`}
          >
            <MuseBrainLogo
              size={expanded ? 200 : 60}
              className="brightness-125 contrast-125 drop-shadow-[0_0_8px_rgba(125,211,252,0.75)]"
            />
          </Link>
        </div>

        <div className="mb-2 border-b border-border-subtle/60 pb-2">
          <WorkspaceSwitcher expanded={expanded} />
        </div>

        {/* 导航项 */}
        {navItems.map((item) => (
          <FloatingNavItem
            key={item.path}
            item={item}
            active={location.pathname === item.path}
            expanded={expanded}
          />
        ))}

        {/* 模型设置 — 未配置时高亮提醒 */}
        <button
          onClick={() => setSettingsOpen(true)}
          title="模型设置"
          className={`relative flex items-center rounded-xl text-sm text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors text-left ${
            expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
          }`}
        >
          <span className="w-5 flex-shrink-0 flex items-center justify-center text-cyan-400/90 relative">
            <Settings size={17} />
            {!modelConfigured && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-400 rounded-full animate-pulse" />
            )}
          </span>
          <AnimatePresence>
            {expanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex-1 whitespace-nowrap"
              >
                模型设置
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* 明暗主题切换 — mt-auto 把它及收起按钮推到底部 */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到明亮模式' : '切换到暗黑模式'}
          className={`mt-auto flex items-center rounded-xl text-sm text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors text-left ${
            expanded ? 'gap-3 px-3 py-2.5' : 'justify-center px-0 py-2.5'
          }`}
        >
          <span className="w-5 flex-shrink-0 flex items-center justify-center text-amber-400/90">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </span>
          <AnimatePresence>
            {expanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex-1 whitespace-nowrap"
              >
                {theme === 'dark' ? '明亮模式' : '暗黑模式'}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* 展开/收起按钮 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center py-3 border-t border-border-subtle/60 text-text-faint hover:text-text-primary transition-colors"
        title={expanded ? '收起' : '展开'}
      >
        {expanded ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
      </button>

      {/* 模型设置弹窗 — 未配置时 force 模式不允许关闭 */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} force={!modelConfigured} />
    </motion.nav>
  )
}

export default FloatingNav

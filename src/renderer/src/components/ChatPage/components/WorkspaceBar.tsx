import React, { useState, useEffect, useCallback } from 'react'
import { Box, Play, FolderOpen, Code2 } from 'lucide-react'

interface WorkspaceEnv {
  type: string
  label: string
  startCommand: string | null
  runnable: boolean
}

interface EditorInfo {
  id: string
  name: string
}

interface WorkspaceBarProps {
  isElectron: boolean
  /** 启动环境：把命令交给终端执行 */
  onStartEnv: (command: string) => void
}

/**
 * 当前工作区的终端工具。工作区切换由全局导航负责。
 */
export function WorkspaceBar({ isElectron, onStartEnv }: WorkspaceBarProps) {
  const [env, setEnv] = useState<WorkspaceEnv | null>(null)
  const [editors, setEditors] = useState<EditorInfo[]>([])

  const refreshEnv = useCallback(async () => {
    if (!isElectron) return
    const res = await window.electronAPI?.workspace?.detectEnv?.()
    setEnv(res?.success ? res.data : null)
  }, [isElectron])

  // 初始化环境与编辑器（编辑器走主进程冷启动缓存）
  useEffect(() => {
    if (!isElectron) return
    refreshEnv()
    window.electronAPI?.workspace?.detectEditors?.().then((res: any) => {
      if (res?.success) setEditors(res.data || [])
    })

    const cleanup = window.electronAPI?.workspace?.onChanged?.(() => refreshEnv())
    return () => cleanup?.()
  }, [isElectron, refreshEnv])

  if (!isElectron) return null

  return (
    <div className="flex items-center gap-2">
      {/* 环境徽章 */}
      {env && env.type !== 'unknown' && (
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-300 border border-violet-400/20 flex-shrink-0">
          <Box size={9} />
          {env.label}
        </span>
      )}

      {/* 操作按钮组 */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {env?.runnable && env.startCommand && (
          <button
            onClick={() => onStartEnv(env.startCommand as string)}
            title={`启动环境：${env.startCommand}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-violet-600 dark:text-violet-300 hover:bg-violet-500/15 transition-colors"
          >
            <Play size={11} />
            <span>启动</span>
          </button>
        )}
        <button
          onClick={() => window.electronAPI?.workspace?.openInFolder?.()}
          title="在访达中打开"
          className="flex items-center justify-center w-7 h-7 rounded-lg text-text-faint hover:text-amber-500 dark:hover:text-amber-400 hover:bg-text-primary/[0.06] transition-colors"
        >
          <FolderOpen size={13} />
        </button>
        {editors[0] && (
          <button
            onClick={() => window.electronAPI?.workspace?.openInEditor?.(editors[0].id)}
            title={`用 ${editors[0].name} 打开`}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-text-faint hover:text-sky-500 dark:hover:text-sky-400 hover:bg-text-primary/[0.06] transition-colors"
          >
            <Code2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

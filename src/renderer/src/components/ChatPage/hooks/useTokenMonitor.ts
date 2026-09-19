// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import { useState, useEffect, useCallback } from 'react'

interface TokenCall {
  source: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextMode: string
  timestamp: number
}

interface TokenStats {
  totalCalls: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  intentIntercepted: number
}

interface TokenMonitorState {
  /** 累计统计 */
  stats: TokenStats
  /** 最近一次调用 */
  lastCall: TokenCall | null
  /** 本次会话的 Token 总消耗 */
  sessionTokens: number
}

export function useTokenMonitor() {
  const [state, setState] = useState<TokenMonitorState>({
    stats: {
      totalCalls: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      intentIntercepted: 0,
    },
    lastCall: null,
    sessionTokens: 0,
  })

  useEffect(() => {
    if (!window.electronAPI?.token) return

    const cleanup = window.electronAPI.token.onUpdate((data) => {
      setState(prev => ({
        stats: data.stats,
        lastCall: data.call,
        sessionTokens: prev.sessionTokens + data.call.totalTokens,
      }))
    })

    return cleanup
  }, [])

  const resetSession = useCallback(() => {
    setState(prev => ({ ...prev, sessionTokens: 0, lastCall: null }))
  }, [])

  return { ...state, resetSession }
}

import { useState, useEffect, useRef, useCallback } from 'react'

export interface TokenStats {
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  avgInputTokens: number
  avgOutputTokens: number
  intentIntercepted: number
  tokensSavedByIntent: number
}

const emptyTokenStats: TokenStats = {
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  avgInputTokens: 0,
  avgOutputTokens: 0,
  intentIntercepted: 0,
  tokensSavedByIntent: 0
}

export function useSessionStatus(isElectron: boolean) {
  const [latency, setLatency] = useState<number>(0)
  const [tokenStats, setTokenStats] = useState<TokenStats>(emptyTokenStats)
  const [safetyLevel, setSafetyLevel] = useState<'SECURE' | 'CAUTION' | 'DANGER'>('SECURE')
  const [sessionLoaded, setSessionLoaded] = useState(false)

  const sessionIdRef = useRef(`ai_terminal_${Date.now()}`) // fallback 默认值

  // 从主进程获取持久化的 sessionId
  useEffect(() => {
    const loadSession = async () => {
      try {
        if (isElectron && window.electronAPI?.session?.getCurrent) {
          const result = await window.electronAPI.session.getCurrent()
          if (result?.sessionId) {
            sessionIdRef.current = result.sessionId
            console.log('[Session] 已从主进程加载 sessionId:', result.sessionId)
          }
        }
      } catch (e) {
        console.warn('[Session] 获取 sessionId 失败，使用默认值')
      }
      setSessionLoaded(true)
    }
    loadSession()
  }, [isElectron])

  // Token 统计轮询 — 每 5 秒从 system:getStats 获取
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.system) return
    const poll = () => {
      window.electronAPI!.system.getStats().then((res: any) => {
        if (res.success && res.data?.token) {
          const t = res.data.token
          setTokenStats({
            totalCalls: t.totalCalls || 0,
            totalInputTokens: t.totalInputTokens || 0,
            totalOutputTokens: t.totalOutputTokens || 0,
            totalTokens: t.totalTokens || 0,
            avgInputTokens: t.avgInputTokens || 0,
            avgOutputTokens: t.avgOutputTokens || 0,
            intentIntercepted: t.intentIntercepted || 0,
            tokensSavedByIntent: t.tokensSavedByIntent || 0
          })
        }
      }).catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => clearInterval(timer)
  }, [])

  const resetSession = useCallback(async (): Promise<void> => {
    try {
      if (isElectron && window.electronAPI?.session?.reset) {
        const result = await window.electronAPI.session.reset()
        if (result?.sessionId) {
          sessionIdRef.current = result.sessionId
          console.log('[Session] 已重置 sessionId:', result.sessionId)
          return
        }
      }
    } catch (e) {
      console.warn('[Session] 重置 sessionId 失败，使用本地生成')
    }
    // fallback
    sessionIdRef.current = `ai_terminal_${Date.now()}`
  }, [isElectron])

  return {
    latency,
    setLatency,
    tokenStats,
    safetyLevel,
    setSafetyLevel,
    sessionIdRef,
    resetSession,
    sessionLoaded
  }
}

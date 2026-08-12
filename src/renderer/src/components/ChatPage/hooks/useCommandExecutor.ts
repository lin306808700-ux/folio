import { useCallback } from 'react'
import type { Message } from '../types'

interface UseCommandExecutorOptions {
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  loading: boolean
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  pendingCommand: string | undefined
  setPendingCommand: React.Dispatch<React.SetStateAction<string | undefined>>
  commandToExecute: string | undefined
  setCommandToExecute: React.Dispatch<React.SetStateAction<string | undefined>>
  setSafetyLevel: (v: 'SECURE' | 'CAUTION' | 'DANGER') => void
  refreshSkills: () => void
}

export function useCommandExecutor(options: UseCommandExecutorOptions) {
  const {
    setMessages,
    loading,
    setLoading,
    pendingCommand,
    setPendingCommand,
    setCommandToExecute,
    setSafetyLevel,
    refreshSkills
  } = options

  // 安全执行命令
  const safeExecute = useCallback(async (cmd: string, feedbackLabel: string) => {
    if (!cmd) return

    if (window.electronAPI?.security) {
      try {
        // 超时回退机制（借鉴 Claude Code 权限系统的分类器 + 超时回退模式）
        // 安全分析最多等待 2 秒，超时则跳过分析直接执行（不阻塞用户体验）
        const SECURITY_TIMEOUT = 2000
        const analysisPromise = window.electronAPI.security.analyze(cmd)
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SECURITY_TIMEOUT)
        )

        const analysis = await Promise.race([analysisPromise, timeoutPromise])

        if (!analysis) {
          console.warn(`[Security] 安全分析超时 (>${SECURITY_TIMEOUT}ms)，跳过检查`)
        } else {
          if (analysis.riskLevel === 'critical' || analysis.riskLevel === 'high') {
            setSafetyLevel('DANGER')
          } else if (analysis.riskLevel === 'medium') {
            setSafetyLevel('CAUTION')
          } else {
            setSafetyLevel('SECURE')
          }
          if (!analysis.safe) {
            const riskLabels: Record<string, string> = {
              critical: '☠️ 致命风险',
              high: '🔴 高风险',
              medium: '🟡 中等风险'
            }
            const riskLabel = riskLabels[analysis.riskLevel] || '⚠️ 风险'
            const suggestions = analysis.suggestions?.length
              ? `\n\n💡 建议：\n${analysis.suggestions.map((s: string) => `  • ${s}`).join('\n')}`
              : ''

            const shouldProceed = confirm(
              `${riskLabel}（评分 ${analysis.riskScore}/100）\n\n${analysis.message}\n\n命令: ${cmd}${suggestions}\n\n确定要执行吗？`
            )
            if (!shouldProceed) {
              const cancelMsg: Message = {
                id: `cancel-${Date.now()}`, role: 'assistant',
                content: `⛔ 已取消执行：${feedbackLabel}`, type: 'text'
              }
              setMessages(prev => [...prev, cancelMsg])
              return
            }
          }
        }
      } catch (e) {
        console.warn('[Security] 安全分析失败:', e)
      }
    }

    const feedbackMsg: Message = { id: `exec-${Date.now()}`, role: 'assistant', content: `✅ ${feedbackLabel}`, type: 'text' }
    setMessages(prev => [...prev, feedbackMsg])
    setCommandToExecute(cmd)
    setTimeout(() => setCommandToExecute(undefined), 100)
  }, [setSafetyLevel, setMessages, setCommandToExecute])

  const executeCommand = useCallback(() => {
    if (pendingCommand) {
      const cmd = pendingCommand
      setPendingCommand(undefined)
      safeExecute(cmd, '已执行命令')
    }
  }, [pendingCommand, setPendingCommand, safeExecute])

  const executeScript = useCallback((runCommand: string) => {
    safeExecute(runCommand, '已执行脚本')
  }, [safeExecute])

  const executeSpecificCommand = useCallback((cmd: string, label: string) => {
    safeExecute(cmd, `已执行：${label}`)
  }, [safeExecute])

  const installSkill = useCallback(async (skillData: { url: string; skillName?: string }) => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const result = await window.electronAPI.db.skills.install({ url: skillData.url, skillName: skillData.skillName })
      if (result.success) {
        const successMsg: Message = {
          id: `skill-success-${Date.now()}`, role: 'assistant',
          content: `✅ 技能安装成功！\n\n技能名称：${result.skill?.name}\n描述：${result.skill?.description || '无'}\n\n已添加到技能矩阵。`,
          type: 'text'
        }
        setMessages(prev => [...prev, successMsg])
        refreshSkills()
      } else {
        throw new Error(result.error || '安装失败')
      }
    } catch (error: any) {
      const errorMsg: Message = { id: `skill-error-${Date.now()}`, role: 'assistant', content: `❌ 技能安装失败：${error.message}`, type: 'text' }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [setLoading, setMessages, refreshSkills])

  const confirmTaskAction = useCallback(async (taskId: string, confirmed: boolean, modifiedStep?: any) => {
    if (!window.electronAPI || !window.electronAPI.task) return
    setLoading(true)
    try {
      await window.electronAPI.task.confirm({ taskId, confirmed, modifiedStep })
      const msg: Message = {
        id: `task-action-${Date.now()}`, role: 'assistant',
        content: confirmed ? `✅ 已确认执行` : `❌ 已取消操作`, type: 'text'
      }
      setMessages(prev => [...prev, msg])
      if (!confirmed) setLoading(false)
    } catch (error: any) {
      const errorMsg: Message = { id: `task-error-${Date.now()}`, role: 'assistant', content: `❌ 确认失败：${error.message}`, type: 'text' }
      setMessages(prev => [...prev, errorMsg])
      setLoading(false)
    }
  }, [setLoading, setMessages])

  return {
    safeExecute,
    executeCommand,
    executeScript,
    executeSpecificCommand,
    installSkill,
    confirmTaskAction
  }
}

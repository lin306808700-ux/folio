import React, { useState, useRef } from 'react'

export function useInputHistory(input: string, setInput: (v: string) => void, onSend?: () => void) {
  const [inputHistory, setInputHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const tempInputRef = useRef('')

  const recordInput = (text: string) => {
    setInputHistory(prev => [text, ...prev.slice(0, 49)])
    setHistoryIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter 发送
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      onSend?.()
      return
    }
    // Enter 键换行，不发送
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      return
    }
    // 输入历史浏览（单行时 ↑↓ 翻历史，多行时 ↑↓ 正常移动光标）
    if (e.key === 'ArrowUp' && !input.includes('\n')) {
      e.preventDefault()
      if (historyIndex === -1) tempInputRef.current = input
      const nextIndex = Math.min(historyIndex + 1, inputHistory.length - 1)
      if (nextIndex >= 0 && inputHistory[nextIndex]) {
        setHistoryIndex(nextIndex)
        setInput(inputHistory[nextIndex])
      }
    }
    if (e.key === 'ArrowDown' && !input.includes('\n')) {
      e.preventDefault()
      if (historyIndex <= 0) {
        setHistoryIndex(-1)
        setInput(tempInputRef.current)
      } else {
        const nextIndex = historyIndex - 1
        setHistoryIndex(nextIndex)
        setInput(inputHistory[nextIndex])
      }
    }
  }

  const resetHistoryIndex = () => setHistoryIndex(-1)

  return {
    inputHistory,
    handleKeyDown,
    recordInput,
    resetHistoryIndex
  }
}

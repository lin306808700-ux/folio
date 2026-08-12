import React from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** error 类型消息渲染 — 含重试按钮 */
export function ErrorContent() {
  const { msg, loading, onRetry } = useMessageBubbleContext()

  if (msg.type !== 'error' || (!msg.retryRequest && !msg.retryUserInput)) return null

  return (
    <button
      onClick={() => onRetry(msg.retryRequest || msg.retryUserInput!)}
      disabled={loading}
      className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all shadow-sm active:scale-95 disabled:opacity-50 text-sm"
    >
      {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
      重试
    </button>
  )
}

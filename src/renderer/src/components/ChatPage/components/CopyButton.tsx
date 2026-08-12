import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-all"
      title="复制消息"
    >
      {copied ? <><Check size={12} className="text-emerald-500" /><span className="text-emerald-500">已复制</span></> : <><Copy size={12} /><span>复制</span></>}
    </button>
  )
}

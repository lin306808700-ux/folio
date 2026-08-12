import React, { useState } from 'react'
import { Loader2, Check, Save, ChevronDown, ChevronUp } from 'lucide-react'

export function SaveScriptAsSkill({ scriptData, onSaved }: {
  scriptData: { lang: string; description: string; scriptContent: string; filename: string; scriptFile?: string }
  onSaved: () => void
}) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'saving' | 'done'>('idle')
  const [name, setName] = useState(scriptData.description || '')
  const [desc, setDesc] = useState('')
  const [prompt, setPrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setMode('saving')
    try {
      // 有外部脚本文件时，content 只存描述文本，脚本由 scriptFile 独立维护
      // 没有外部脚本文件时，才将脚本内嵌到 content 中
      const skillContent = scriptData.scriptFile
        ? (prompt.trim() || scriptData.description || '')
        : `${prompt.trim() ? prompt.trim() + '\n\n' : ''}\`\`\`${scriptData.lang}\n${scriptData.scriptContent}\n\`\`\``

      const result = await window.electronAPI!.db.skills.saveLocal({
        name: name.trim(),
        description: desc.trim() || scriptData.description || '',
        content: skillContent,
        scriptFile: scriptData.scriptFile
      })
      if (result.success) {
        setMode('done')
        onSaved()
      } else {
        throw new Error(result.error)
      }
    } catch (e: any) {
      alert('保存失败：' + e.message)
      setMode('editing')
    }
  }

  if (mode === 'done') {
    return (
      <span className="flex items-center gap-1 px-3 py-2 text-xs text-emerald-600 font-medium animate-in slide-in-from-left duration-300">
        <Check size={14} /> 已保存为技能
      </span>
    )
  }

  if (mode === 'editing' || mode === 'saving') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="技能名称"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-28 px-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:border-violet-400 bg-white"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && !showPrompt && handleSave()}
          />
          <input
            type="text"
            placeholder="描述（可选）"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="w-32 px-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:border-violet-400 bg-white"
            onKeyDown={e => e.key === 'Enter' && !showPrompt && handleSave()}
          />
          <button onClick={handleSave} disabled={!name.trim() || mode === 'saving'}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-all disabled:opacity-50 active:scale-95">
            {mode === 'saving' ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />}
            保存
          </button>
          <button onClick={() => setMode('idle')}
            className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
            取消
          </button>
        </div>
        
        {/* 可折叠的使用指引区域 */}
        {!showPrompt ? (
          <button
            onClick={() => setShowPrompt(true)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-500 transition-colors self-start"
          >
            <ChevronDown size={12} />
            + 添加使用指引
          </button>
        ) : (
          <div className="flex flex-col gap-1.5 animate-in slide-in-from-top duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">使用指引</span>
              <button
                onClick={() => setShowPrompt(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <ChevronUp size={12} />
              </button>
            </div>
            <textarea
              placeholder="描述如何使用此技能..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="w-full h-16 px-2 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:border-violet-400 bg-white resize-none"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <button onClick={() => setMode('editing')}
      className="flex items-center gap-1.5 px-3 py-2 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 rounded-lg transition-all active:scale-95 border border-violet-200">
      <Save size={14} /> 保存为技能
    </button>
  )
}

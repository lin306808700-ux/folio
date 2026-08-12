import React, { useState, useEffect } from 'react'
import { X, Loader2, Check, Zap } from 'lucide-react'

interface SkillEditModalProps {
  mode: 'create' | 'edit'
  skill?: {
    id?: string
    name: string
    description: string
    content: string
    source?: string
  }
  onClose: () => void
  onSave: (skill: any) => Promise<void>
}

export function SkillEditModal({ mode, skill, onClose, onSave }: SkillEditModalProps) {
  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')

  // 保存状态
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  // 编辑模式回填
  useEffect(() => {
    if (mode === 'edit' && skill) {
      setName(skill.name || '')
      setDescription(skill.description || '')
      setContent(skill.content || '')
    }
  }, [mode, skill])

  // 模态打开时临时隐藏 BrowserView（原生层会盖住模态），关闭时恢复
  useEffect(() => {
    window.electronAPI?.browser?.temporaryHide?.()
    return () => {
      window.electronAPI?.browser?.temporaryShow?.()
    }
  }, [])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('请输入技能名称')
      return
    }
    if (!content.trim()) {
      setError('请输入技能内容')
      return
    }

    setError('')
    setSaving(true)

    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        content: content.trim()
      })
      setSaveSuccess(true)
      setTimeout(() => onClose(), 1500)
    } catch (e: any) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const canSave = !!name.trim() && !!content.trim()

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 shadow-2xl animate-in zoom-in-95">
        {/* 顶部标题栏 */}
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-2xl font-black flex items-center gap-3">
            <Zap className="text-indigo-500" />
            {mode === 'create' ? '定义新技能' : '编辑技能'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* 表单字段 */}
        <div className="space-y-5">
          {/* 技能名称 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              技能名称 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-5 py-3 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              placeholder="例如：代码专家"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          {/* 技能描述 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              技能描述
            </label>
            <input
              type="text"
              className="w-full px-5 py-3 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              placeholder="描述这个技能的用途"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* 技能内容 */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              技能内容 <span className="text-rose-500">*</span>
            </label>
            <textarea
              className="w-full px-5 py-3 bg-slate-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 h-64 resize-y transition-all font-mono text-sm"
              placeholder="输入技能的完整内容，包括指令、脚本、流程等..."
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mt-4 text-sm text-rose-500 font-medium">
            {error}
          </div>
        )}

        {/* 底部按钮区 */}
        <div className="mt-8">
          <button
            onClick={handleSave}
            disabled={!canSave || saving || saveSuccess}
            className={`w-full py-4 rounded-2xl font-black shadow-xl transition-all flex items-center justify-center gap-2 ${
              saveSuccess
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                保存中...
              </>
            ) : saveSuccess ? (
              <>
                <Check size={20} />
                已保存
              </>
            ) : (
              mode === 'create' ? '激活技能' : '保存修改'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SkillEditModal

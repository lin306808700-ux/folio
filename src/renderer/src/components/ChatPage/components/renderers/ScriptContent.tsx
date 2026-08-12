import React, { useState } from 'react'
import { Play, Loader2, RefreshCw, CheckCircle, AlertCircle, ShieldCheck, ShieldClose } from 'lucide-react'
import { ScriptPreview } from '../ScriptPreview'
import { SaveScriptAsSkill } from '../SaveScriptAsSkill'
import { RollbackButton } from '../parts/RollbackButton'
import { useMessageBubbleContext } from '../MessageBubbleContext'

/** script 类型消息渲染 — 含 6 种 execStatus 状态 */
export function ScriptContent() {
  const { msg, isElectron, onExecuteScript, onSkillsSaved } = useMessageBubbleContext()

  if (msg.type !== 'script' || !msg.scriptData || !isElectron) return null

  const { scriptData } = msg

  return (
    <div className="mt-3 space-y-3">
      <ScriptPreview
        content={scriptData.scriptContent}
        lang={scriptData.lang}
        filename={scriptData.filename}
      />
      <ScriptStatusRenderer scriptData={scriptData} onExecuteScript={onExecuteScript} onSkillsSaved={onSkillsSaved} />
    </div>
  )
}

/** 脚本执行状态分支渲染 */
function ScriptStatusRenderer({
  scriptData,
  onExecuteScript,
  onSkillsSaved,
}: {
  scriptData: NonNullable<import('../../types').Message['scriptData']>
  onExecuteScript: (runCommand: string) => void
  onSkillsSaved: () => void
}) {
  switch (scriptData.execStatus) {
    case 'executing':
      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-violet-100 text-violet-700 rounded-lg">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm font-medium">执行中...</span>
          </div>
          <span className="text-xs text-slate-400 font-mono truncate max-w-[200px]">{scriptData.filename}</span>
        </div>
      )

    case 'retrying':
      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-lg">
            <RefreshCw size={14} className="animate-spin" />
            <span className="text-sm font-medium">AI 修复重试中 ({scriptData.retryCount}/{scriptData.maxRetries})</span>
          </div>
          <button
            onClick={() => {
              if (window.electronAPI?.script) {
                window.electronAPI.script.cancelExecution?.()
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all border border-slate-200"
          >
            <AlertCircle size={12} /> 取消
          </button>
        </div>
      )

    case 'completed':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <CheckCircle size={14} />
              <span className="text-sm font-medium">执行完成</span>
            </div>
            <SaveScriptAsSkill scriptData={scriptData} onSaved={onSkillsSaved} />
            {scriptData.snapshot && (
              <RollbackButton snapshot={scriptData.snapshot} />
            )}
          </div>
          {scriptData.snapshot && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>📸 已备份 {scriptData.snapshot.totalChanges} 个文件变更</span>
              <span className="text-slate-500">
                ({scriptData.snapshot.changes.modified.length} 修改,
                {' '}{scriptData.snapshot.changes.created.length} 新增,
                {' '}{scriptData.snapshot.changes.deleted.length} 删除)
              </span>
            </div>
          )}
          {scriptData.execResult?.stdout && (
            <pre className="mt-2 p-3 bg-slate-800 text-slate-200 rounded-lg text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap">
              {scriptData.execResult.stdout}
            </pre>
          )}
        </div>
      )

    case 'failed':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg">
              <AlertCircle size={14} />
              <span className="text-sm font-medium">执行失败</span>
            </div>
            <button
              onClick={() => onExecuteScript(scriptData.runCommand)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all"
            >
              <Play size={12} /> 手动执行
            </button>
          </div>
          {scriptData.execResult?.error && (
            <pre className="mt-2 p-3 bg-red-900/20 text-red-300 rounded-lg text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap border border-red-800/30">
              {scriptData.execResult.error}
            </pre>
          )}
        </div>
      )

    case 'needAuth':
      return <NeedAuthCard scriptData={scriptData} />

    default:
      // pending / 无状态：显示手动执行按钮
      return (
        <div className="flex items-center gap-3">
          <button
            onClick={() => onExecuteScript(scriptData.runCommand)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-all shadow-sm active:scale-95"
          >
            <Play size={14} /> 执行脚本
          </button>
          <SaveScriptAsSkill scriptData={scriptData} onSaved={onSkillsSaved} />
          <span className="text-xs text-slate-400 font-mono truncate max-w-[200px]" title={scriptData.scriptFile}>
            {scriptData.filename}
          </span>
        </div>
      )
  }
}

/** 授权确认卡片 — 点击后立即反馈状态，防止"点了没反应" */
function NeedAuthCard({ scriptData }: { scriptData: any }) {
  // 'pending' | 'granted' | 'denied'
  const [authState, setAuthState] = useState<'pending' | 'granted' | 'denied'>('pending')

  const handleGrant = () => {
    if (authState !== 'pending') return
    setAuthState('granted')
    window.electronAPI?.script?.authResponse({ authId: scriptData?.authId, granted: true })
  }

  const handleDeny = () => {
    if (authState !== 'pending') return
    setAuthState('denied')
    window.electronAPI?.script?.authResponse({ authId: scriptData?.authId, granted: false })
  }

  if (authState === 'granted') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg">
        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">已授权，执行中...</span>
        <Loader2 size={14} className="text-emerald-500 animate-spin ml-auto" />
      </div>
    )
  }

  if (authState === 'denied') {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-lg">
        <ShieldClose size={14} className="text-slate-400" />
        <span className="text-sm text-slate-500 dark:text-slate-400">已拒绝执行</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
        <AlertCircle size={14} className="text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">需要授权：{scriptData.dangerReason || '脚本包含潜在危险操作'}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleGrant}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-all shadow-sm active:scale-95"
        >
          <CheckCircle size={14} /> 授权执行
        </button>
        <button
          onClick={handleDeny}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
        >
          拒绝
        </button>
      </div>
    </div>
  )
}

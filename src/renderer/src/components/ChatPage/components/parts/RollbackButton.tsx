import React, { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

interface RollbackButtonProps {
  snapshot: {
    snapshotId: string
    timestamp: number
    totalChanges: number
    changes: { modified: string[]; created: string[]; deleted: string[] }
  }
}

/** 回滚按钮 — 将脚本执行产生的文件变更恢复到执行前的状态 */
export function RollbackButton({ snapshot }: RollbackButtonProps) {
  const [rolling, setRolling] = useState(false)
  const [done, setDone] = useState(false)

  const handleRollback = async () => {
    if (rolling || done || !window.electronAPI?.snapshot) return
    setRolling(true)
    try {
      const result = await window.electronAPI.snapshot.rollbackOne({ snapshotId: snapshot.snapshotId })
      if (result.success) {
        setDone(true)
      } else {
        console.error('[Rollback] 回滚失败:', result.error)
      }
    } catch (err) {
      console.error('[Rollback] 回滚异常:', err)
    } finally {
      setRolling(false)
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-lg">
        <RefreshCw size={12} />
        <span>已回滚</span>
      </div>
    )
  }

  return (
    <button
      onClick={handleRollback}
      disabled={rolling}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-100 hover:bg-orange-50 text-slate-500 hover:text-orange-600 rounded-lg transition-all disabled:opacity-50"
      title={`回滚 ${snapshot.totalChanges} 个文件变更`}
    >
      {rolling ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      <span>回滚</span>
    </button>
  )
}

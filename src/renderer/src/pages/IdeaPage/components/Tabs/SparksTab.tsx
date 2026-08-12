import React from 'react'
import { Sparkles, Trash2 } from 'lucide-react'

interface SparksTabProps {
  ideas: any[]
  onDelete: (id: string) => void
}

const SparksTab: React.FC<SparksTabProps> = ({ ideas, onDelete }) => {
  if (ideas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Sparkles size={40} className="mb-4 opacity-30" />
        <p className="text-sm">还没有捕获到灵感。和 AI 对话时，有价值的内容会自动采集。</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ideas.map((idea: any) => (
        <div
          key={idea.id}
          className="p-6 rounded-2xl bg-slate-800/40 border border-fuchsia-500/15 hover:border-fuchsia-500/30 backdrop-blur-sm transition-all relative group"
        >
          <button
            onClick={() => onDelete(idea.id)}
            className="absolute top-4 right-4 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={14} />
          </button>
          <div className="inline-flex px-2 py-0.5 bg-fuchsia-500/10 text-fuchsia-400 text-[10px] font-bold rounded-full uppercase mb-3 border border-fuchsia-500/20">
            Spark
          </div>
          <h3 className="text-lg font-bold text-slate-200 mb-2">{idea.title}</h3>
          <p className="text-slate-400 text-sm leading-relaxed">{idea.content}</p>
        </div>
      ))}
    </div>
  )
}

export default SparksTab

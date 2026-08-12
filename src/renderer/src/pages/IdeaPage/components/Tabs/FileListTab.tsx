import React from 'react'
import { BookOpen, Compass, User, FileText, ChevronRight } from 'lucide-react'
import { ContentViewer } from '../../types'
import { formatFilename, extractDate } from '../../utils/format'

interface FileListTabProps {
  title: string
  icon: React.FC<any>
  files: string[]
  emptyText: string
  type: ContentViewer['type']
  onOpen: (type: ContentViewer['type'], filename: string) => void
  accentColor: string
}

const FileListTab: React.FC<FileListTabProps> = ({ title, icon: Icon, files, emptyText, type, onOpen, accentColor }) => {
  const borderColorMap: Record<string, string> = {
    amber: 'border-amber-500/20 hover:border-amber-500/40',
    cyan: 'border-cyan-500/20 hover:border-cyan-500/40',
    violet: 'border-violet-500/20 hover:border-violet-500/40'
  }

  const iconColorMap: Record<string, string> = {
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    violet: 'text-violet-400'
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Icon size={40} className="mb-4 opacity-30" />
        <p className="text-sm">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {files.map(file => (
        <button
          key={file}
          onClick={() => onOpen(type, file)}
          className={`flex items-center gap-3 p-4 rounded-2xl bg-slate-800/40 border ${borderColorMap[accentColor]} backdrop-blur-sm transition-all group text-left`}
        >
          <div className={`w-8 h-8 rounded-xl bg-slate-700/50 flex items-center justify-center shrink-0 ${iconColorMap[accentColor]}`}>
            <FileText size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-300 truncate font-mono">{formatFilename(file)}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{extractDate(file)}</div>
          </div>
          <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
        </button>
      ))}
    </div>
  )
}

export default FileListTab

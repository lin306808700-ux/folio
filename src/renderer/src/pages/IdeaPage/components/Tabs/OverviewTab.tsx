import React, { useState, useEffect } from 'react'
import { Sparkles, BookOpen, Compass, User, FolderOpen, Loader2, FileText, Eye, ExternalLink, Globe } from 'lucide-react'
import { MuseStatus, ContentViewer } from '../../types'
import { formatFilename } from '../../utils/format'

interface OverviewTabProps {
  museStatus: MuseStatus | null
  museLoading: boolean
  ideas: any[]
  onOpenContent: (type: ContentViewer['type'], filename: string) => void
}

const OverviewTab: React.FC<OverviewTabProps> = ({ museStatus, museLoading, ideas, onOpenContent }) => {
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([])
  
  useEffect(() => {
    // 加载工作空间文件列表
    const loadFiles = async () => {
      try {
        const result = await (window as any).electronAPI.muse.getWorkspaceFiles()
        if (result?.success) {
          setWorkspaceFiles(result.files)
        }
      } catch (err) {
        console.error('加载工作空间文件失败:', err)
      }
    }
    loadFiles()
  }, [])
  
  if (museLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-violet-400" size={32} /></div>
  }

  const stats = [
    { label: '日志', value: museStatus?.journals.length || 0, icon: BookOpen, color: 'amber' },
    { label: '洞察', value: museStatus?.insights.length || 0, icon: Compass, color: 'cyan' },
    { label: '画像维度', value: museStatus?.profileSections.length || 0, icon: User, color: 'violet' },
    { label: '灵感', value: ideas.length, icon: Sparkles, color: 'fuchsia' },
    { label: '工作空间', value: museStatus?.workspaceFiles.length || 0, icon: FolderOpen, color: 'emerald' }
  ]

  const colorMap: Record<string, string> = {
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-500/20 text-amber-400',
    cyan: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/20 text-cyan-400',
    violet: 'from-violet-500/20 to-violet-600/5 border-violet-500/20 text-violet-400',
    fuchsia: 'from-fuchsia-500/20 to-fuchsia-600/5 border-fuchsia-500/20 text-fuchsia-400',
    emerald: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/20 text-emerald-400'
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-3">
        {stats.map(stat => (
          <div
            key={stat.label}
            className={`p-4 rounded-2xl bg-gradient-to-br border ${colorMap[stat.color]} backdrop-blur-sm`}
          >
            <stat.icon size={16} className="mb-2 opacity-70" />
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs opacity-60 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <RecentList
          title="最近日志"
          icon={BookOpen}
          files={museStatus?.journals.slice(0, 5) || []}
          type="journal"
          onOpen={onOpenContent}
          accentColor="amber"
        />
        <RecentList
          title="最近洞察"
          icon={Compass}
          files={museStatus?.insights.slice(0, 5) || []}
          type="insight"
          onOpen={onOpenContent}
          accentColor="cyan"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <RecentList
          title="主人画像"
          icon={User}
          files={museStatus?.profileSections || []}
          type="profile"
          onOpen={onOpenContent}
          accentColor="violet"
        />
        <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 backdrop-blur-sm flex flex-col" style={{ maxHeight: '800px' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-300">工作空间</h3>
            </div>
            <button
              onClick={() => (window as any).electronAPI.muse.openWorkspace()}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
              title="打开工作空间目录"
            >
              <ExternalLink size={12} />
              <span>打开目录</span>
            </button>
          </div>
          {workspaceFiles.length === 0 ? (
            <p className="text-xs text-slate-500 italic">缪斯还没有创建任何文件</p>
          ) : (
            <div className="space-y-1 overflow-y-auto flex-1">
              {workspaceFiles.map(file => (
                <div key={file.path} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-slate-700/50 transition-all group">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <FileText size={12} className="text-emerald-500/60 shrink-0" />
                    <span className="truncate font-mono text-slate-400" title={file.path}>{file.path}</span>
                  </div>
                  {file.url && (
                    <button
                      onClick={() => {
                        const api = (window as any).electronAPI
                        if (api.shell?.openExternal) {
                          api.shell.openExternal(file.url)
                        } else {
                          window.open(file.url, '_blank')
                        }
                      }}
                      className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      title="在浏览器中打开"
                    >
                      <Globe size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const RecentList: React.FC<{
  title: string
  icon: React.FC<any>
  files: string[]
  type: ContentViewer['type']
  onOpen: (type: ContentViewer['type'], filename: string) => void
  accentColor: string
}> = ({ title, icon: Icon, files, type, onOpen, accentColor }) => {
  const iconColorMap: Record<string, string> = {
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    violet: 'text-violet-400'
  }

  return (
    <div className="p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className={iconColorMap[accentColor] || 'text-slate-400'} />
        <h3 className="text-sm font-semibold text-slate-300">{title}</h3>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-slate-500 italic">暂无内容</p>
      ) : (
        <div className="space-y-1">
          {files.map(file => (
            <button
              key={file}
              onClick={() => onOpen(type, file)}
              className="w-full flex items-center justify-between gap-2 text-xs text-slate-400 hover:text-slate-200 py-1.5 px-2 rounded-lg hover:bg-slate-700/50 transition-all group"
            >
              <span className="truncate font-mono">{formatFilename(file)}</span>
              <Eye size={12} className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default OverviewTab

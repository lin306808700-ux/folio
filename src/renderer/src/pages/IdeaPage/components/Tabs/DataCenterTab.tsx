import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen, Compass, User, Sparkles, FolderOpen, FileText, Eye,
  ExternalLink, Globe, ChevronDown, ChevronRight, Trash2, ArrowRight
} from 'lucide-react'
import { MuseStatus, ContentViewer } from '../../types'
import { formatFilename, extractDate } from '../../utils/format'

interface DataCenterTabProps {
  museStatus: MuseStatus | null
  museLoading: boolean
  ideas: any[]
  onOpenContent: (type: ContentViewer['type'], filename: string) => void
  onDeleteIdea: (id: string) => void
}

interface SectionConfig {
  key: string
  title: string
  icon: React.FC<any>
  color: string
  borderColor: string
  iconColor: string
  bgColor: string
}

const SECTIONS: SectionConfig[] = [
  { key: 'journals', title: '日志', icon: BookOpen, color: 'amber', borderColor: 'border-amber-500/20', iconColor: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10' },
  { key: 'insights', title: '洞察报告', icon: Compass, color: 'cyan', borderColor: 'border-cyan-500/20', iconColor: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-500/10' },
  { key: 'profile', title: '主人画像', icon: User, color: 'violet', borderColor: 'border-violet-500/20', iconColor: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-500/10' },
  { key: 'workspace', title: '创作空间', icon: FolderOpen, color: 'emerald', borderColor: 'border-emerald-500/20', iconColor: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-500/10' },
  { key: 'sparks', title: '灵感', icon: Sparkles, color: 'fuchsia', borderColor: 'border-fuchsia-500/20', iconColor: 'text-fuchsia-600 dark:text-fuchsia-400', bgColor: 'bg-fuchsia-500/10' },
]

const DataCenterTab: React.FC<DataCenterTabProps> = ({ museStatus, museLoading, ideas, onOpenContent, onDeleteIdea }) => {
  const navigate = useNavigate()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['journals', 'insights']))
  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([])
  const [artifactCount, setArtifactCount] = useState(0)

  useEffect(() => {
    const loadFiles = async () => {
      try {
        const result = await (window as any).electronAPI.muse.getWorkspaceFiles()
        if (result?.success) {
          setWorkspaceFiles(result.files)
        }
        // 加载产物计数
        const artifacts = await (window as any).electronAPI?.artifacts?.getRecent(100)
        setArtifactCount(artifacts?.length || 0)
      } catch (err) {
        console.error('加载工作空间文件失败:', err)
      }
    }
    loadFiles()
  }, [])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const getFiles = (key: string): string[] => {
    if (!museStatus) return []
    switch (key) {
      case 'journals': return museStatus.journals
      case 'insights': return museStatus.insights
      case 'profile': return museStatus.profileSections
      default: return []
    }
  }

  const getContentType = (key: string): ContentViewer['type'] | null => {
    switch (key) {
      case 'journals': return 'journal'
      case 'insights': return 'insight'
      case 'profile': return 'profile'
      default: return null
    }
  }

  const getCount = (key: string): number => {
    if (key === 'workspace') return artifactCount || workspaceFiles.length
    if (key === 'sparks') return ideas.length
    return getFiles(key).length
  }

  return (
    <div className="space-y-3">
      {/* 顶部统计条 */}
      <div className="flex items-center gap-4 px-1 mb-2">
        {SECTIONS.map(section => (
          <div key={section.key} className="flex items-center gap-1.5 text-xs text-text-muted">
            <section.icon size={12} className={section.iconColor} />
            <span>{section.title}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${section.bgColor} ${section.iconColor}`}>
              {getCount(section.key)}
            </span>
          </div>
        ))}
      </div>

      {/* 各分区 */}
      {SECTIONS.map(section => {
        const isExpanded = expandedSections.has(section.key)
        const count = getCount(section.key)

        return (
          <div key={section.key} className={`rounded-xl border ${section.borderColor} bg-surface/50 dark:bg-slate-800/30 backdrop-blur-sm overflow-hidden`}>
            {/* 分区标题 */}
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-text-primary/[0.03] dark:hover:bg-white/[0.02] transition-colors"
            >
              <section.icon size={15} className={section.iconColor} />
              <span className="text-sm font-medium text-text-secondary dark:text-slate-300">{section.title}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${section.bgColor} ${section.iconColor}`}>
                {count}
              </span>

              {/* 右侧操作 */}
              <div className="ml-auto flex items-center gap-2">
                {section.key === 'workspace' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      (window as any).electronAPI.muse.openWorkspace()
                    }}
                    className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <ExternalLink size={10} />
                    打开目录
                  </span>
                )}
                {isExpanded ? <ChevronDown size={14} className="text-text-faint" /> : <ChevronRight size={14} className="text-text-faint" />}
              </div>
            </button>

            {/* 分区内容 */}
            {isExpanded && count > 0 && (
              <div className="border-t border-border-subtle/40 dark:border-white/5 px-2 py-2">
                {/* 文件列表类（日志/洞察/画像） */}
                {['journals', 'insights', 'profile'].includes(section.key) && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {getFiles(section.key).map(file => {
                      const contentType = getContentType(section.key)!
                      return (
                        <button
                          key={file}
                          onClick={() => onOpenContent(contentType, file)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-text-primary/[0.04] dark:hover:bg-white/5 transition-colors group text-left"
                        >
                          <FileText size={12} className={`${section.iconColor} opacity-50`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-text-muted truncate font-mono">{formatFilename(file)}</div>
                            <div className="text-[10px] text-text-faint">{extractDate(file)}</div>
                          </div>
                          <Eye size={11} className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0 text-text-muted" />
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* 创作空间 — 跳转到 /artifacts */}
                {section.key === 'workspace' && (
                  <div className="px-3 py-3">
                    <button
                      onClick={() => navigate('/artifacts')}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 hover:bg-emerald-500/10 transition-colors group"
                    >
                      <FolderOpen size={16} className="text-emerald-400" />
                      <div className="flex-1 text-left">
                        <div className="text-sm text-text-secondary dark:text-slate-300 font-medium">查看创作空间</div>
                        <div className="text-[11px] text-text-muted">Muse 生成的所有产物在此统一管理</div>
                      </div>
                      <ArrowRight size={14} className="text-emerald-500 dark:text-emerald-400 opacity-50 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </div>
                )}

                {/* 灵感 */}
                {section.key === 'sparks' && (
                  <div className="grid grid-cols-2 gap-2">
                    {ideas.map((idea: any) => (
                      <div key={idea.id} className="px-3 py-2.5 rounded-lg bg-surface/40 dark:bg-white/[0.02] hover:bg-surface dark:hover:bg-white/5 transition-colors relative group">
                        <button
                          onClick={() => onDeleteIdea(idea.id)}
                          className="absolute top-2 right-2 text-text-faint hover:text-rose-500 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={11} />
                        </button>
                        <h4 className="text-xs font-medium text-text-secondary dark:text-slate-300 mb-1 pr-4 truncate">{idea.title}</h4>
                        <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed">{idea.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 空状态 */}
            {isExpanded && count === 0 && (
              <div className="border-t border-border-subtle/40 dark:border-white/5 px-4 py-4">
                <p className="text-xs text-text-faint italic text-center">暂无内容</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default DataCenterTab

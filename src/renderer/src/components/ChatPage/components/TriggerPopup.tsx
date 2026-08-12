import React, { useMemo } from 'react'
import {
  FolderOpen, File, FileText, Code, Image, Zap, Palette,
  Shield, Trash2, RefreshCw, Search, Layers
} from 'lucide-react'
import type { TriggerItem, TriggerType } from '../hooks/useTriggerSearch'

// 图标名 → lucide 组件映射
const iconComponents: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  FolderOpen, File, FileText, Code, Image, Zap, Palette,
  Shield, Trash2, RefreshCw, Layers,
}

// 分组图标映射
const groupIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  '工作区文件': FolderOpen,
  '技能': Zap,
  '场景模板': Palette,
  '系统': Shield,
  '会话': RefreshCw,
  '模板 & 质量': Layers,
}

interface TriggerPopupProps {
  trigger: TriggerType
  items: TriggerItem[]
  selectedIndex: number
  isOpen: boolean
  onSelect: (item: TriggerItem) => void
  onHoverItem: (index: number) => void
}

/** 将 items 按 group 分组，保留原始 index 用于选中态 */
function groupItems(items: TriggerItem[]): Array<{ type: 'header'; group: string } | { type: 'item'; item: TriggerItem; originalIndex: number }> {
  const result: Array<{ type: 'header'; group: string } | { type: 'item'; item: TriggerItem; originalIndex: number }> = []
  let lastGroup: string | undefined

  items.forEach((item, index) => {
    const group = item.group || ''
    if (group && group !== lastGroup) {
      result.push({ type: 'header', group })
      lastGroup = group
    }
    result.push({ type: 'item', item, originalIndex: index })
  })

  return result
}

export function TriggerPopup({ trigger, items, selectedIndex, isOpen, onSelect, onHoverItem }: TriggerPopupProps) {
  const grouped = useMemo(() => groupItems(items), [items])

  // 统计分组数（用于决定是否显示分组标题）
  const hasMultipleGroups = useMemo(() => {
    const groups = new Set(items.map(i => i.group).filter(Boolean))
    return groups.size > 1
  }, [items])

  if (!isOpen || items.length === 0) return null

  const headerLabels: Record<TriggerType, string> = {
    '@': '引用',
    '#': '创作空间',
    '/': '命令 & 技能',
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 mx-4 z-50">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden max-h-[360px] flex flex-col">
        {/* 头部 */}
        <div className="px-4 py-2 text-xs font-bold text-slate-400 uppercase border-b border-slate-600 flex-shrink-0 flex items-center gap-2">
          <Search size={12} />
          {headerLabels[trigger] || '搜索结果'}
          <span className="text-slate-600 font-normal normal-case ml-auto">
            {items.length} 项
          </span>
        </div>

        {/* 列表（带分组标题） */}
        <div className="overflow-y-auto flex-1 scroll-dark">
          {grouped.map((entry, entryIndex) => {
            if (entry.type === 'header') {
              // 仅有一个分组时不显示标题
              if (!hasMultipleGroups) return null
              const GroupIcon = groupIcons[entry.group]
              return (
                <div
                  key={`group-${entry.group}`}
                  className="px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 bg-slate-800/80 sticky top-0 z-10 border-b border-slate-700/40"
                >
                  {GroupIcon && <GroupIcon size={10} className="text-slate-500" />}
                  {entry.group}
                </div>
              )
            }

            const { item, originalIndex } = entry
            const IconComp = iconComponents[item.icon]
            const isSelected = originalIndex === selectedIndex

            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  isSelected ? 'bg-indigo-600/20 border-l-2 border-indigo-400' : 'hover:bg-slate-700/50 border-l-2 border-transparent'
                }`}
                onClick={() => onSelect(item)}
                onMouseEnter={() => onHoverItem(originalIndex)}
              >
                {/* 图标 */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'bg-indigo-500/20' : 'bg-slate-700/50'
                }`}>
                  {IconComp ? (
                    <IconComp size={14} className={isSelected ? 'text-indigo-400' : 'text-slate-400'} />
                  ) : (
                    <File size={14} className="text-slate-400" />
                  )}
                </div>

                {/* 文字 */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${isSelected ? 'text-indigo-300 font-semibold' : 'text-slate-200'}`}>
                    {item.label}
                  </div>
                  {item.sublabel && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {item.sublabel}
                    </div>
                  )}
                </div>

                {/* 快捷键提示 */}
                {isSelected && (
                  <span className="text-[10px] text-slate-600 bg-slate-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    ↵
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* 底部提示 */}
        <div className="px-3 py-1.5 border-t border-slate-700/50 flex items-center gap-3 text-[10px] text-slate-600 flex-shrink-0">
          <span>↑↓ 导航</span>
          <span>↵ 选择</span>
          <span>Esc 关闭</span>
          {trigger === '@' && <span className="ml-auto">@ 文件 · 技能 · 模板</span>}
        </div>
      </div>
    </div>
  )
}

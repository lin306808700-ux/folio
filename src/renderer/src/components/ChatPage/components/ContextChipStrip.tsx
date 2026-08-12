import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Zap, Palette, Shield, FileText, X } from 'lucide-react'

export interface ContextChip {
  id: string
  type: 'skill' | 'template' | 'craft' | 'pipeline'
  label: string
  detail?: string
  removable?: boolean
}

interface ContextChipStripProps {
  chips: ContextChip[]
  onRemove?: (chipId: string) => void
  onChipClick?: (chip: ContextChip) => void
}

const chipConfig: Record<ContextChip['type'], { icon: React.ReactNode; bgClass: string; textClass: string; borderClass: string }> = {
  skill: {
    icon: <Zap size={11} />,
    bgClass: 'bg-indigo-500/15',
    textClass: 'text-indigo-300',
    borderClass: 'border-indigo-500/30',
  },
  template: {
    icon: <Palette size={11} />,
    bgClass: 'bg-violet-500/15',
    textClass: 'text-violet-300',
    borderClass: 'border-violet-500/30',
  },
  craft: {
    icon: <Shield size={11} />,
    bgClass: 'bg-amber-500/15',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-500/30',
  },
  pipeline: {
    icon: <FileText size={11} />,
    bgClass: 'bg-cyan-500/15',
    textClass: 'text-cyan-300',
    borderClass: 'border-cyan-500/30',
  },
}

export function ContextChipStrip({ chips, onRemove, onChipClick }: ContextChipStripProps) {
  if (chips.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 overflow-x-auto scrollbar-hide">
      <AnimatePresence mode="popLayout">
        {chips.map(chip => {
          const config = chipConfig[chip.type]
          return (
            <motion.button
              key={chip.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              onClick={() => onChipClick?.(chip)}
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                border ${config.bgClass} ${config.textClass} ${config.borderClass}
                hover:brightness-125 transition-all cursor-default whitespace-nowrap
                ${onChipClick ? 'cursor-pointer' : ''}
              `}
              title={chip.detail || chip.label}
            >
              {config.icon}
              <span className="max-w-[120px] truncate">{chip.label}</span>
              {chip.removable && onRemove && (
                <span
                  role="button"
                  onClick={(event) => { event.stopPropagation(); onRemove(chip.id) }}
                  className="ml-0.5 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={10} />
                </span>
              )}
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

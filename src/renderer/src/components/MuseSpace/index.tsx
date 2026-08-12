import React, { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, History, MessageCircle } from 'lucide-react'
import { useMuseSpaceData } from '../../hooks/useMuseSpaceData'

interface MuseSpaceProps {
  onSummonChat: () => void
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

export function MuseSpace({ onSummonChat }: MuseSpaceProps) {
  const navigate = useNavigate()
  const data = useMuseSpaceData()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
      sessionStorage.setItem('muse_initial_key', event.key)
      onSummonChat()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onSummonChat])

  const summary = useMemo(() => {
    if (data.currentTask) return `正在处理：${data.currentTask.command}`
    if (data.unreadCount > 0) return `有 ${data.unreadCount} 封新来信等你查看`
    return '从一个问题开始，或者继续最近的学习。'
  }, [data.currentTask, data.unreadCount])

  // 功能减法：信箱/作品入口已隐藏，首页只保留学习主链路
  const actions = [
    { label: '学习图谱', detail: '结构化学习与知识沉淀', icon: BookOpen, color: '#6db5a8', onClick: () => navigate('/learning') },
    { label: '历史', detail: data.journalCount ? `${data.journalCount} 篇日志` : '回到过去对话', icon: History, color: '#72a6d8', onClick: () => navigate('/history') },
  ]

  return (
    <section className="relative h-full w-full overflow-y-auto px-6 py-10 sm:px-10 lg:px-14">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center py-8">
        <div className="mb-10 max-w-2xl animate-in">
          <div className="mb-5 flex items-center gap-2.5 text-xs text-text-muted">
            <span className={`h-2 w-2 rounded-full ${data.heartbeatRunning ? 'bg-emerald-400' : 'bg-text-faint/50'}`} />
            <span>{data.loading ? '正在同步' : data.heartbeatRunning ? 'Muse 运行中' : 'Muse 已就绪'}</span>
          </div>
          <h1 className="text-4xl font-semibold leading-tight text-text-primary sm:text-5xl">
            {getGreeting()}，从哪里继续？
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-700 dark:text-white/70 sm:text-base" title={summary}>
            {summary}
          </p>
        </div>

        <button
          onClick={onSummonChat}
          className="group mb-5 flex w-full items-center gap-4 rounded-lg border border-border-subtle/70 bg-surface/[0.08] px-5 py-5 text-left shadow-[0_16px_50px_rgba(0,0,0,0.08)] transition-colors hover:border-emerald-300/40 hover:bg-surface/[0.12] focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
            <MessageCircle size={21} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-medium text-text-primary">开始对话</span>
            <span className="mt-1 block text-xs text-text-muted">输入任何内容，直接进入工作区</span>
          </span>
          <ArrowRight size={19} className="shrink-0 text-text-faint transition-transform group-hover:translate-x-1 group-hover:text-text-primary" />
        </button>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {actions.map(({ label, detail, icon: Icon, color, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className="group flex min-h-[104px] flex-col items-start justify-between rounded-lg border border-border-subtle/60 bg-surface/[0.045] p-4 text-left transition-colors hover:border-border-strong/60 hover:bg-surface/[0.09] focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              <Icon size={19} style={{ color }} />
              <span>
                <span className="block text-sm font-medium text-text-primary">{label}</span>
                <span className="mt-1 block text-[11px] text-text-muted">{detail}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">直接键入文字也可以开始</p>
      </div>
    </section>
  )
}

export default MuseSpace

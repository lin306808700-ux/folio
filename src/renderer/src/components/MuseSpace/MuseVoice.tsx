import React, { useMemo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { MuseSpaceData } from '../../hooks/useMuseSpaceData'

interface MuseVoiceProps {
  data: MuseSpaceData
}

interface Activity {
  id: string
  text: string
}

/**
 * 根据真实数据生成上下文问候（不是固定模板）
 */
function buildGreeting(data: MuseSpaceData): string {
  const hour = new Date().getHours()
  const period = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  // 优先级：正在做的 > 未读信 > 成长数据
  if (data.currentTask) {
    const cmd = data.currentTask.command.substring(0, 30)
    return `${period}。我正在处理：${cmd}${data.currentTask.command.length > 30 ? '...' : ''}`
  }
  if (data.heartbeatRunning) {
    if (data.activeGoal) {
      const title = data.activeGoal.title.substring(0, 20)
      return `${period}。我在探索「${title}」`
    }
    return `${period}。我在自主探索中。`
  }
  if (data.unreadCount > 0) {
    if (data.latestLetter) {
      const title = data.latestLetter.title.substring(0, 20)
      return `${period}。信箱里有 ${data.unreadCount} 封信，最新的是「${title}」`
    }
    return `${period}。信箱里有 ${data.unreadCount} 封信等你。`
  }
  // 成长数据
  const parts: string[] = []
  if (data.journalCount > 0) parts.push(`${data.journalCount} 篇日志`)
  if (data.insightCount > 0) parts.push(`${data.insightCount} 条洞察`)
  if (parts.length > 0) {
    return `${period}。已积累 ${parts.join('，')}。`
  }
  return `${period}。我在这里。`
}

/**
 * 从真实数据生成活动低语
 */
function buildActivities(data: MuseSpaceData): Activity[] {
  const acts: Activity[] = []

  if (data.activeGoal) {
    const title = data.activeGoal.title.substring(0, 24)
    acts.push({
      id: 'active-goal',
      text: `正在探索：${title}${data.activeGoal.title.length > 24 ? '...' : ''}`,
    })
  }

  if (data.currentTask) {
    acts.push({
      id: 'current-task',
      text: `正在处理：${data.currentTask.command.substring(0, 36)}`,
    })
  }

  if (data.latestLetter) {
    const title = data.latestLetter.title.substring(0, 24)
    acts.push({
      id: 'latest-letter',
      text: `最新信件：${title}${data.latestLetter.title.length > 24 ? '...' : ''}`,
    })
  }

  data.recentCompletedTasks.forEach((t) => {
    acts.push({
      id: `completed-${t.id}`,
      text: `完成了：${t.command.substring(0, 30)}`,
    })
  })

  return acts.slice(0, 3)
}

/**
 * MuseVoice — 自主活动层
 *
 * 基于真实数据：
 * - 问候：根据心跳/信件/任务/成长数据动态生成
 * - 活动低语：真实任务名、信件标题
 * - 成长统计：日志/洞察/作品/目标
 */
export function MuseVoice({ data }: MuseVoiceProps) {
  const [greeting, setGreeting] = useState<string | null>(null)
  const [showGreeting, setShowGreeting] = useState(false)

  const activities = useMemo(() => buildActivities(data), [data])
  const greetingText = useMemo(() => buildGreeting(data), [data])
  const signals = useMemo(() => [
    { key: '心跳', value: data.heartbeatRunning ? 'RUN' : 'REST', active: data.heartbeatRunning },
    { key: '信件', value: String(data.unreadCount), active: data.unreadCount > 0 },
    { key: '任务', value: data.currentTask ? 'LIVE' : String(data.recentCompletedTasks.length), active: !!data.currentTask },
    { key: '目标', value: data.activeGoal ? String(data.activeGoal.exploreStepCount) : String(data.goalCount), active: !!data.activeGoal },
  ], [data])

  // 问候延迟淡入，数据变化时更新
  useEffect(() => {
    setShowGreeting(false)
    const timer = window.setTimeout(() => {
      setGreeting(greetingText)
      setShowGreeting(true)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [greetingText])

  return (
    <motion.div
      className="pointer-events-none absolute bottom-12 left-1/2 w-full max-w-xl -translate-x-1/2 px-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.8, ease: 'easeOut' }}
    >
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.035] px-5 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur-xl">
        <motion.div
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
          animate={{ x: ['-70%', '70%'] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <motion.span
              className="h-2 w-2 rounded-full bg-emerald-300"
              animate={{ opacity: [0.35, 1, 0.35], scale: [0.8, 1.25, 0.8] }}
              transition={{ duration: data.heartbeatRunning ? 1.4 : 4.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-[10px] uppercase tracking-[0.28em] text-text-faint">muse telemetry</span>
          </div>
          <motion.span
            className="text-[10px] text-text-faint"
            animate={{ opacity: [0.35, 0.72, 0.35] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            {data.loading ? 'syncing' : 'live'}
          </motion.span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {signals.map((signal, i) => (
            <motion.div
              key={signal.key}
              className="rounded-2xl border border-white/[0.06] bg-black/[0.08] px-3 py-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9 + i * 0.05 }}
            >
              <div className="mb-1 text-[9px] text-text-faint">{signal.key}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium text-text-primary/85">{signal.value}</span>
                <motion.span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: signal.active ? '#5eead4' : 'rgba(255,255,255,0.28)' }}
                  animate={{ opacity: signal.active ? [0.3, 1, 0.3] : 0.35 }}
                  transition={{ duration: 1.8 + i * 0.3, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </motion.div>
          ))}
        </div>

      <AnimatePresence mode="wait">
        {greeting && showGreeting && (
          <motion.p
            key={greeting}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 0.85, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="mt-4 text-center text-sm font-light leading-relaxed text-text-primary/80"
          >
            {greeting}
          </motion.p>
        )}
      </AnimatePresence>

      {/* 活动低语 */}
      <div className="mt-3 space-y-1.5">
        <AnimatePresence>
          {activities.map((act) => (
            <motion.p
              key={act.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 0.55, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5 }}
              className="flex items-center justify-center gap-2 text-center text-[11px] font-light italic text-text-muted"
            >
              <span className="h-px w-8 bg-white/10" />
              <span className="truncate">{act.text}</span>
              <span className="h-px w-8 bg-white/10" />
            </motion.p>
          ))}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3 text-[10px] font-light text-text-faint">
        {data.journalCount > 0 && <span>{data.journalCount} 篇日志</span>}
        {data.insightCount > 0 && <span>·</span>}
        {data.insightCount > 0 && <span>{data.insightCount} 条洞察</span>}
        {data.workspaceFileCount > 0 && <span>·</span>}
        {data.workspaceFileCount > 0 && <span>{data.workspaceFileCount} 件作品</span>}
        {data.goalCount > 0 && <span>·</span>}
        {data.goalCount > 0 && <span>{data.goalCount} 个目标</span>}
      </div>
      </div>
    </motion.div>
  )
}

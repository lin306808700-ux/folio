import { useState, useEffect, useRef } from 'react'
import { isElectron } from '../utils/config'

export interface MuseSpaceData {
  /** Muse 心跳是否运行中 */
  heartbeatRunning: boolean
  /** 未读信件数 */
  unreadCount: number
  /** 最新未读信件（无未读则最新信件） */
  latestLetter: {
    id: string
    title: string
    status: string
    created_at: string
  } | null
  /** 所有信件 */
  letters: any[]
  /** 当前正在执行的任务 */
  currentTask: {
    id: string
    command: string
    status: string
  } | null
  /** 最近完成的任务 */
  recentCompletedTasks: {
    id: string
    command: string
    completedAt: string | null
  }[]
  /** 日志数 */
  journalCount: number
  /** 洞察数 */
  insightCount: number
  /** 工作区文件数 */
  workspaceFileCount: number
  /** 目标数 */
  goalCount: number
  /** 当前活跃目标 */
  activeGoal: {
    id: string
    title: string
    description: string
    exploreStepCount: number
    insightCount: number
  } | null
  /** 是否正在加载 */
  loading: boolean
}

/**
 * MuseSpace 数据 hook — 连接 Muse 真实状态
 *
 * 拉取心跳状态、信件、任务、成长数据，30秒刷新一次。
 * 监听实时事件（新信件、任务更新）自动刷新。
 */
export function useMuseSpaceData(): MuseSpaceData {
  const [heartbeatRunning, setHeartbeatRunning] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [letters, setLetters] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [journalCount, setJournalCount] = useState(0)
  const [insightCount, setInsightCount] = useState(0)
  const [workspaceFileCount, setWorkspaceFileCount] = useState(0)
  const [goalCount, setGoalCount] = useState(0)
  const [activeGoal, setActiveGoal] = useState<MuseSpaceData['activeGoal']>(null)
  const [loading, setLoading] = useState(true)
  const fetchingRef = useRef(false)

  const fetchAll = async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const muse = (window as any).electronAPI?.muse
      if (!muse) return

      const [status, heartbeat, count, lettersData, tasksData, goalsData] = await Promise.all([
        muse.getStatus?.(),
        muse.getHeartbeatStatus?.(),
        muse.getUnreadCount?.(),
        muse.getLetters?.(),
        muse.getTasks?.(),
        muse.goal?.list?.(),
      ])

      if (status) {
        setJournalCount(status.journals?.length ?? 0)
        setInsightCount(status.insights?.length ?? 0)
        setWorkspaceFileCount(status.workspaceFiles?.length ?? 0)
      }
      if (heartbeat) setHeartbeatRunning(heartbeat.isRunning ?? false)
      if (typeof count === 'number') setUnreadCount(count)
      if (lettersData) setLetters(lettersData)
      if (tasksData) setTasks(tasksData)
      if (Array.isArray(goalsData)) {
        setGoalCount(goalsData.length)
        // 找第一个 active 目标
        const active = goalsData.find((g: any) => g.status === 'active')
        if (active) {
          setActiveGoal({
            id: active.id,
            title: active.title,
            description: active.description || '',
            exploreStepCount: (active.exploreSteps || []).length,
            insightCount: (active.insights || []).length,
          })
        } else {
          setActiveGoal(null)
        }
      }
    } catch (err) {
      console.error('MuseSpace data fetch failed:', err)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }

  useEffect(() => {
    if (!isElectron) {
      setLoading(false)
      return
    }

    fetchAll()

    // 30 秒定时刷新
    const timer = setInterval(fetchAll, 30000)

    // 实时事件监听
    const cleanupLetter = (window as any).electronAPI?.muse?.onNewLetter?.(() => fetchAll())
    const cleanupCount = (window as any).electronAPI?.muse?.onUnreadCountUpdated?.(() => fetchAll())
    const cleanupTask = (window as any).electronAPI?.muse?.onTaskQueueUpdate?.(() => fetchAll())

    return () => {
      clearInterval(timer)
      cleanupLetter?.()
      cleanupCount?.()
      cleanupTask?.()
    }
  }, [])

  // 派生数据
  const latestLetter = letters.find((l: any) => l.status === 'unread') || letters[0] || null

  const currentTask = tasks.find((t: any) => t.status === 'executing')
    ? {
        id: tasks.find((t: any) => t.status === 'executing').id,
        command: tasks.find((t: any) => t.status === 'executing').command,
        status: 'executing',
      }
    : null

  const recentCompletedTasks = tasks
    .filter((t: any) => t.status === 'completed')
    .slice(0, 3)
    .map((t: any) => ({
      id: t.id,
      command: t.command,
      completedAt: t.completedAt,
    }))

  return {
    heartbeatRunning,
    unreadCount,
    latestLetter: latestLetter
      ? {
          id: latestLetter.id,
          title: latestLetter.title,
          status: latestLetter.status,
          created_at: latestLetter.created_at,
        }
      : null,
    letters,
    currentTask,
    recentCompletedTasks,
    journalCount,
    insightCount,
    workspaceFileCount,
    goalCount,
    activeGoal,
    loading,
  }
}

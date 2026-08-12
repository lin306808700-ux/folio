import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { baseUrl, getAuthHeaders, isElectron } from '../../../utils/config'
import { MuseStatus, Letter, Task } from '../types'

export const useMuseData = () => {
  const [ideas, setIdeas] = useState<any[]>([])
  const [letters, setLetters] = useState<Letter[]>([])
  const [museStatus, setMuseStatus] = useState<MuseStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [museLoading, setMuseLoading] = useState(true)
  const [tasks, setTasks] = useState<Task[]>([])
  const [heartbeatRunning, setHeartbeatRunning] = useState(false)
  const [goals, setGoals] = useState<any[]>([])
  const [autonomyState, setAutonomyState] = useState<any>(null)
  const [knowledgeResults, setKnowledgeResults] = useState<{ memories: any[]; insights: any[]; summaries: any[] } | null>(null)

  const fetchIdeas = useCallback(async () => {
    try {
      if (isElectron) {
        const data = await (window as any).electronAPI.db.ideas.getAll()
        setIdeas(data)
      } else {
        const res = await axios.get(`${baseUrl}/api/ideas`, { headers: getAuthHeaders() })
        setIdeas(res.data.data || [])
      }
    } catch {
      setIdeas([])
    }
  }, [])

  const fetchMuseStatus = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse) {
      setMuseLoading(false)
      return
    }
    try {
      const status = await (window as any).electronAPI.muse.getStatus()
      setMuseStatus(status)
      
      const heartbeatStatus = await (window as any).electronAPI.muse.getHeartbeatStatus()
      setHeartbeatRunning(heartbeatStatus?.isRunning ?? false)
    } catch (err) {
      console.error('获取缪斯状态失败:', err)
    } finally {
      setMuseLoading(false)
    }
  }, [])

  const fetchLetters = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse?.getLetters) return
    try {
      const data = await (window as any).electronAPI.muse.getLetters()
      setLetters(data || [])
    } catch {
      setLetters([])
    }
  }, [])

  const fetchGoals = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse?.goal) return
    try {
      const data = await (window as any).electronAPI.muse.goal.list()
      setGoals(data || [])
    } catch {
      setGoals([])
    }
  }, [])

  const fetchAutonomyState = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse?.autonomy) return
    try {
      const data = await (window as any).electronAPI.muse.autonomy.getState()
      setAutonomyState(data)
    } catch {
      setAutonomyState(null)
    }
  }, [])

  const searchKnowledge = useCallback(async (keyword: string, limit?: number) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.knowledge) return
    try {
      const data = await (window as any).electronAPI.muse.knowledge.search(keyword, limit)
      setKnowledgeResults(data)
    } catch {
      setKnowledgeResults(null)
    }
  }, [])

  const tasksSnapshotRef = useRef<string>('')

  const fetchTasks = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse?.getTasks) return
    try {
      const data = await (window as any).electronAPI.muse.getTasks()
      const snapshot = JSON.stringify((data || []).map((t: Task) => `${t.id}:${t.status}`))
      if (snapshot !== tasksSnapshotRef.current) {
        tasksSnapshotRef.current = snapshot
        setTasks(data || [])
      }
    } catch {
      setTasks([])
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchIdeas(), fetchMuseStatus(), fetchLetters(), fetchTasks(), fetchGoals(), fetchAutonomyState()]).finally(() => setLoading(false))
  }, [fetchIdeas, fetchMuseStatus, fetchLetters, fetchTasks, fetchGoals, fetchAutonomyState])

  useEffect(() => {
    const cleanup = (window as any).electronAPI?.muse?.onNewLetter?.(() => {
      fetchLetters()
    })
    return () => cleanup?.()
  }, [fetchLetters])

  // 任务列表 5 秒定时刷新
  useEffect(() => {
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  return {
    ideas,
    letters,
    museStatus,
    loading,
    museLoading,
    tasks,
    heartbeatRunning,
    setHeartbeatRunning,
    goals,
    autonomyState,
    knowledgeResults,
    fetchIdeas,
    fetchMuseStatus,
    fetchLetters,
    fetchTasks,
    fetchGoals,
    fetchAutonomyState,
    searchKnowledge,
    setLetters,
    setTasks
  }
}

import { useState, useCallback } from 'react'
import axios from 'axios'
import { baseUrl, getAuthHeaders, isElectron } from '../../../utils/config'
import { ContentViewer, Letter } from '../types'

export const useMuseActions = (
  fetchIdeas: () => Promise<void>,
  fetchMuseStatus: () => Promise<void>,
  fetchLetters: () => Promise<void>,
  fetchTasks: () => Promise<void>,
  setLetters: React.Dispatch<React.SetStateAction<Letter[]>>,
  fetchGoals?: () => Promise<void>,
  fetchAutonomyState?: () => Promise<void>
) => {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [commandText, setCommandText] = useState('')
  const [commandLoading, setCommandLoading] = useState(false)
  const [heartbeatPaused, setHeartbeatPaused] = useState(false)
  const [viewer, setViewer] = useState<ContentViewer | null>(null)
  const [expandedLetter, setExpandedLetter] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [editCommand, setEditCommand] = useState('')
  const [editingSubtask, setEditingSubtask] = useState<string | null>(null)
  const [editSubtaskCommand, setEditSubtaskCommand] = useState('')
  const [editSubtaskStatus, setEditSubtaskStatus] = useState<string>('')

  const triggerMorningReview = async () => {
    if (!isElectron) return
    
    // 检查今天是否已经触发过
    const today = new Date().toISOString().slice(0, 10)
    const lastMorningReview = localStorage.getItem('lastMorningReview')
    
    if (lastMorningReview === today) {
      alert('今天已经进行过晨间回顾了')
      return
    }
    
    setActionLoading('morning')
    try {
      await (window as any).electronAPI.muse.morningReview()
      localStorage.setItem('lastMorningReview', today)
      await fetchMuseStatus()
    } catch (err) {
      console.error('晨间回顾失败:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const triggerExplore = async () => {
    if (!isElectron) return
    setActionLoading('explore')
    try {
      await (window as any).electronAPI.muse.explore()
      await fetchMuseStatus()
    } catch (err) {
      console.error('主动探索失败:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const executeCommand = async () => {
    if (!isElectron || !commandText.trim()) return
    setCommandLoading(true)
    try {
      await (window as any).electronAPI.muse.executeCommand({ command: commandText.trim() })
      setCommandText('')
    } catch (err: any) {
      console.error('指令执行失败:', err)
    } finally {
      setCommandLoading(false)
    }
  }

  const toggleHeartbeat = useCallback(async (currentlyRunning: boolean) => {
    if (!isElectron) return
    try {
      if (currentlyRunning) {
        await (window as any).electronAPI.muse.pauseHeartbeat()
      } else {
        await (window as any).electronAPI.muse.restartHeartbeat()
      }
    } catch (err) {
      console.error('心跳控制失败:', err)
    }
  }, [])

  const markLetterRead = async (id: string) => {
    await (window as any).electronAPI?.muse?.markRead(id)
    setLetters(prev => prev.map(l => l.id === id && l.status === 'unread' ? { ...l, status: 'read' } : l))
  }

  const replyToLetter = async (id: string) => {
    if (!replyText.trim()) return
    setReplyLoading(true)
    try {
      await (window as any).electronAPI?.muse?.replyLetter(id, replyText.trim())
      setLetters(prev => prev.map(l => l.id === id ? { ...l, status: 'replied', reply: replyText.trim(), reply_at: new Date().toISOString() } : l))
      setReplyText('')
    } catch (err) {
      console.error('回复失败:', err)
    } finally {
      setReplyLoading(false)
    }
  }

  /** 直接回复信件（不依赖 replyText state，供 TasksTab 快捷确认用） */
  const confirmTaskReply = useCallback(async (letterId: string, replyContent: string) => {
    if (!isElectron) return
    setReplyLoading(true)
    try {
      await (window as any).electronAPI?.muse?.replyLetter(letterId, replyContent)
      setLetters(prev => prev.map(l => l.id === letterId ? { ...l, status: 'replied', reply: replyContent, reply_at: new Date().toISOString() } : l))
    } catch (err) {
      console.error('快捷回复失败:', err)
    } finally {
      setReplyLoading(false)
    }
  }, [setLetters])

  const deleteLetter = async (id: string) => {
    if (!confirm('确定删除这封信吗？')) return
    await (window as any).electronAPI?.muse?.deleteLetter(id)
    setLetters(prev => prev.filter(l => l.id !== id))
    if (expandedLetter === id) setExpandedLetter(null)
  }

  const openContent = async (type: ContentViewer['type'], filename: string) => {
    if (!isElectron) return
    try {
      let result: any
      if (type === 'journal') {
        result = await (window as any).electronAPI.muse.readJournal({ filename })
      } else if (type === 'insight') {
        result = await (window as any).electronAPI.muse.readInsight({ filename })
      } else {
        // profile 类型：去掉 .md 后缀，因为后端会自动拼接
        const section = filename.replace(/\.md$/, '')
        result = await (window as any).electronAPI.muse.readProfile({ section })
      }
      if (result?.success) {
        setViewer({ title: filename, content: result.content, type })
      }
    } catch (err) {
      console.error('读取内容失败:', err)
    }
  }

  const deleteIdea = async (id: string) => {
    if (!confirm('确定要删除吗？')) return
    try {
      if (isElectron) {
        await (window as any).electronAPI.db.ideas.delete(id)
      } else {
        await axios.delete(`${baseUrl}/api/ideas/${id}`, { headers: getAuthHeaders() })
      }
      fetchIdeas()
    } catch {
      alert('删除失败')
    }
  }

  const updateTask = useCallback(async (taskId: string, updates: any) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.updateTask) return
    try {
      await (window as any).electronAPI.muse.updateTask(taskId, updates)
      fetchTasks()
    } catch (err) {
      console.error('更新任务失败:', err)
    }
  }, [fetchTasks])

  const deleteTask = useCallback(async (taskId: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.deleteTask) return
    if (!confirm('确定要删除这个任务吗？')) return
    try {
      await (window as any).electronAPI.muse.deleteTask(taskId)
      fetchTasks()
    } catch (err) {
      console.error('删除任务失败:', err)
    }
  }, [fetchTasks])

  const addSubtask = useCallback(async (parentId: string, command: string, priority?: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.addSubtask) return
    try {
      const result = await (window as any).electronAPI.muse.addSubtask(parentId, command, priority || 'normal')
      if (result?.success) {
        fetchTasks()
      } else {
        console.error('添加子任务失败:', result?.error)
      }
      return result
    } catch (err) {
      console.error('添加子任务失败:', err)
    }
  }, [fetchTasks])

  // ========== 目标管理 ========== 
  const createGoal = useCallback(async (title: string, description?: string, direction?: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.goal) return
    try {
      await (window as any).electronAPI.muse.goal.create({ title, description, direction })
      fetchGoals?.()
    } catch (err) {
      console.error('创建目标失败:', err)
    }
  }, [fetchGoals])

  const completeGoal = useCallback(async (id: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.goal) return
    try {
      await (window as any).electronAPI.muse.goal.complete(id)
      fetchGoals?.()
    } catch (err) {
      console.error('完成目标失败:', err)
    }
  }, [fetchGoals])

  const deleteGoal = useCallback(async (id: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.goal) return
    if (!confirm('确定要删除这个目标吗？')) return
    try {
      await (window as any).electronAPI.muse.goal.delete(id)
      fetchGoals?.()
    } catch (err) {
      console.error('删除目标失败:', err)
    }
  }, [fetchGoals])

  const addGoalStep = useCallback(async (goalId: string, topic: string) => {
    if (!isElectron || !(window as any).electronAPI?.muse?.goal) return
    try {
      await (window as any).electronAPI.muse.goal.addStep(goalId, topic)
      fetchGoals?.()
    } catch (err) {
      console.error('添加探索步骤失败:', err)
    }
  }, [fetchGoals])

  // ========== 自主等级 ==========
  const evaluateAutonomy = useCallback(async () => {
    if (!isElectron || !(window as any).electronAPI?.muse?.autonomy) return
    try {
      await (window as any).electronAPI.muse.autonomy.evaluate()
      fetchAutonomyState?.()
    } catch (err) {
      console.error('评估自主等级失败:', err)
    }
  }, [fetchAutonomyState])

  return {
    actionLoading,
    commandText,
    commandLoading,
    heartbeatPaused,
    viewer,
    expandedLetter,
    replyText,
    replyLoading,
    editingTask,
    editCommand,
    editingSubtask,
    editSubtaskCommand,
    editSubtaskStatus,
    setActionLoading,
    setCommandText,
    setCommandLoading,
    setHeartbeatPaused,
    setViewer,
    setExpandedLetter,
    setReplyText,
    setReplyLoading,
    setEditingTask,
    setEditCommand,
    setEditingSubtask,
    setEditSubtaskCommand,
    setEditSubtaskStatus,
    triggerMorningReview,
    triggerExplore,
    executeCommand,
    toggleHeartbeat,
    markLetterRead,
    replyToLetter,
    confirmTaskReply,
    deleteLetter,
    openContent,
    deleteIdea,
    updateTask,
    deleteTask,
    addSubtask,
    createGoal,
    completeGoal,
    deleteGoal,
    addGoalStep,
    evaluateAutonomy
  }
}

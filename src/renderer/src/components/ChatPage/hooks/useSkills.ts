import { useState, useEffect, useRef } from 'react'

export function useSkills(isElectron: boolean) {
  const [skills, setSkills] = useState<any[]>([])
  const [selectedSkill, setSelectedSkill] = useState<any>(null)
  const [showSkillMenu, setShowSkillMenu] = useState(false)

  const skillMenuRef = useRef<HTMLDivElement>(null)

  // 加载技能列表（纯文件加载）
  useEffect(() => {
    if (!isElectron) return
    loadSkills()
  }, [])

  // 监听 skills 目录变化，自动刷新
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.db?.skills?.onChanged) return
    const cleanup = window.electronAPI.db.skills.onChanged(() => {
      console.log('[useSkills] skills 目录变化，自动刷新')
      loadSkills()
    })
    return cleanup
  }, [])

  const loadSkills = async () => {
    if (!isElectron) return
    try {
      const fileSkills = await window.electronAPI!.db.skills.getAll()
      console.log('[useSkills] 加载了', fileSkills.length, '个技能')
      setSkills(fileSkills || [])
    } catch (e) {
      console.error('[useSkills] 加载技能失败:', e)
      setSkills([])
    }
  }

  // 点击外部关闭技能菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target as Node)) {
        setShowSkillMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const refreshSkills = async () => {
    if (!isElectron) return
    try {
      const fileSkills = await window.electronAPI!.db.skills.getAll()
      setSkills(fileSkills || [])
    } catch (e) {
      console.error('[useSkills] 刷新技能失败:', e)
    }
  }

  const updateSkill = async (id: string, data: any) => {
    if (!isElectron) return
    try {
      await window.electronAPI!.db.skills.update(id, data)
      await refreshSkills()
    } catch (e) {
      console.error('[useSkills] 更新技能失败:', e)
      throw e
    }
  }

  return {
    skills,
    setSkills,
    selectedSkill,
    setSelectedSkill,
    showSkillMenu,
    setShowSkillMenu,
    skillMenuRef,
    refreshSkills,
    updateSkill
  }
}

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Mail, Target } from 'lucide-react'
import PageShell from '../components/PageShell'
import { useMuseData } from './IdeaPage/hooks/useMuseData'
import { useMuseActions } from './IdeaPage/hooks/useMuseActions'
import LettersTab from './IdeaPage/components/Tabs/LettersTab'
import GoalsTab from './IdeaPage/components/Tabs/GoalsTab'

type MuseTab = 'letters' | 'goals'

const IdeaPage = () => {
  const data = useMuseData()
  const actions = useMuseActions(
    data.fetchIdeas,
    data.fetchMuseStatus,
    data.fetchLetters,
    data.fetchTasks,
    data.setLetters,
    data.fetchGoals,
    data.fetchAutonomyState
  )
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<MuseTab>(
    () => searchParams.get('tab') === 'goals' ? 'goals' : 'letters'
  )

  useEffect(() => {
    const letterId = searchParams.get('letterId')
    if (letterId) {
      setActiveTab('letters')
      actions.setExpandedLetter(letterId)
      const targetLetter = data.letters.find(letter => letter.id === letterId)
      if (targetLetter?.status === 'unread') actions.markLetterRead(letterId)
    }
    if (letterId || searchParams.get('tab')) setSearchParams({}, { replace: true })
  }, [searchParams])

  const unreadCount = useMemo(
    () => data.letters.filter(letter => letter.status === 'unread').length,
    [data.letters]
  )
  const activeGoalsCount = useMemo(
    () => data.goals.filter(goal => goal.status === 'active').length,
    [data.goals]
  )

  if (data.loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-text-muted" size={24} /></div>
  }

  const tabs = [
    { key: 'letters' as const, label: '来信', icon: Mail, count: unreadCount },
    { key: 'goals' as const, label: '目标', icon: Target, count: activeGoalsCount },
  ]

  return (
    <PageShell
      title="缪斯"
      description="管理 Muse 主动发起的来信和长期目标"
      toolbar={
        <div className="flex items-center gap-5" role="tablist" aria-label="缪斯视图">
          {tabs.map(tab => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex h-8 items-center gap-1.5 border-b text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-text-primary text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              <tab.icon size={13} />
              {tab.label}
              {tab.count > 0 && <span className="text-[10px] text-text-faint">{tab.count}</span>}
            </button>
          ))}
        </div>
      }
    >
      {activeTab === 'letters' ? (
        <LettersTab
          letters={data.letters}
          expandedLetter={actions.expandedLetter}
          onExpand={(id: string) => {
            actions.setExpandedLetter(actions.expandedLetter === id ? null : id)
            if (data.letters.find(letter => letter.id === id)?.status === 'unread') actions.markLetterRead(id)
          }}
          replyText={actions.replyText}
          onReplyTextChange={actions.setReplyText}
          onReply={actions.replyToLetter}
          onDelete={actions.deleteLetter}
          replyLoading={actions.replyLoading}
        />
      ) : (
        <GoalsTab
          goals={data.goals}
          onCreateGoal={actions.createGoal}
          onCompleteGoal={actions.completeGoal}
          onDeleteGoal={actions.deleteGoal}
          onAddStep={actions.addGoalStep}
        />
      )}
    </PageShell>
  )
}

export default IdeaPage

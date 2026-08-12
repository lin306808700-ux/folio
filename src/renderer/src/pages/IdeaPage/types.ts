export interface MuseStatus {
  home: string
  journals: string[]
  insights: string[]
  workspaceFiles: string[]
  profileSections: string[]
}

export interface Letter {
  id: string
  title: string
  content: string
  priority: 'low' | 'normal' | 'high'
  status: 'unread' | 'read' | 'replied'
  reply: string | null
  reply_at: string | null
  source: string
  taskId: string | null
  created_at: string
}

/** 判断信件是否为等待确认类型 */
export function isDecisionLetter(letter: Letter): boolean {
  return !!(
    letter.taskId &&
    letter.status !== 'replied' &&
    (letter.title.includes('❓') || letter.title.includes('🔄'))
  )
}

export interface ContentViewer {
  title: string
  content: string
  type: 'journal' | 'insight' | 'profile'
}

export interface Task {
  id: string
  command: string
  priority: 'high' | 'normal' | 'low'
  status: 'pending' | 'executing' | 'reviewing' | 'completed' | 'failed' | 'closed' | 'suspended' | 'waiting_reply' | 'repairing'
  type: 'normal' | 'subtask' | 'decision'
  parentId: string | null
  rootId: string | null
  depth: number
  executionOrder: number
  subtasks: string[]
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  suspendedAt: string | null
  suspendReason: string | null
  result: any
  error: string | null
  attempts: number
}

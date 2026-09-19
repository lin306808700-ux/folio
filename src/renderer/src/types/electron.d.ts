// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

// Electron API 类型定义
export interface ElectronAPI {
  // Session 管理
  session: {
    getCurrent: () => Promise<{ sessionId: string }>
    reset: () => Promise<{ sessionId: string }>
  }
  terminal: {
    create: (opts: { cols: number; rows: number }) => Promise<{ success: boolean; error?: string }>
    write: (data: string) => void
    resize: (size: { cols: number; rows: number }) => void
    onData: (callback: (data: string) => void) => () => void
    // 新增：获取终端最近输出（用于 AI 分析执行结果）
    getRecentOutput: (limit?: number) => Promise<{ output: string }>
  }
  ai: {
    call: (params: {
      userInput: string
      empId?: string
      sessionId?: string
      scriptTemplate?: any
    }) => Promise<{ success: boolean; content?: string; error?: string; webSearched?: boolean; isTask?: boolean; isScript?: boolean; isSearchReplace?: boolean }>
    // 流式调用（发起请求，数据通过 IPC 事件推送）
    stream: (params: {
      userInput: string
      empId?: string
      sessionId?: string
      scriptTemplate?: any
    }) => Promise<{ success: boolean }>
    // 中断流式响应
    abortStream: () => Promise<{ success: boolean }>
    greeting: () => Promise<{ success: boolean; content?: string }>
    onSearchStatus: (callback: (status: { searching: boolean; keywords?: string }) => void) => () => void
    // 流式 chunk 事件监听
    onStreamChunk: (callback: (data: { chunk: string; sessionId: string }) => void) => () => void
    // followUp 进度事件监听
    onFollowUpProgress: (callback: (data: { type: string; message: string; depth: number; sessionId: string; isStep?: boolean; isStepStatus?: boolean; stepIndex?: number; isSummary?: boolean }) => void) => () => void
    // 流式结束事件监听
    onStreamEnd: (callback: (data: { success: boolean; content?: string; error?: string; webSearched?: boolean; isScript?: boolean; isSearchReplace?: boolean; isTask?: boolean; aborted?: boolean }) => void) => () => void
  }
  db: {
    history: {
      getAll: () => Promise<any[]>
      add: (item: any) => Promise<any>
      delete: (id: string) => Promise<boolean>
      clearAll: () => Promise<boolean>
    }
    memories: {
      getAll: () => Promise<any[]>
      add: (content: string) => Promise<any>
      delete: (id: string) => Promise<boolean>
    }
    memorySummary: {
      getAll: () => Promise<any[]>
      delete: (id: string) => Promise<boolean>
    }
    ideas: {
      getAll: () => Promise<any[]>
      add: (item: { title?: string; content: string }) => Promise<any>
      delete: (id: string) => Promise<boolean>
    }
  }
  // 脚本子进程执行事件
  script: {
    onExecuting: (callback: (data: { filename: string; lang: string; description: string; retryCount: number }) => void) => () => void
    onOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string; filename: string }) => void) => () => void
    onError: (callback: (data: { filename: string; error: string; stderr: string; retryCount: number; willRetry: boolean }) => void) => () => void
    onComplete: (callback: (data: { filename: string; stdout: string; exitCode: number }) => void) => () => void
    onNeedAuth: (callback: (data: { authId: string; filename: string; lang: string; description: string; scriptContent: string; riskLevel: string; reason: string; details: any }) => void) => () => void
    onRetrying: (callback: (data: { filename: string; retryCount: number; maxRetries: number }) => void) => () => void
    authResponse: (data: { authId: string; granted: boolean }) => void
  }
  snapshot: {
    list: () => Promise<{ success: boolean; snapshots: Array<{ snapshotId: string; timestamp: number; workDir: string; scriptId: string; description: string; filename: string; totalChanges: number; changes: { modified: string[]; created: string[]; deleted: string[] } }> }>
    rollback: (params: { timestamp: number }) => Promise<{ success: boolean; rolledBack: number; details: any[]; error?: string }>
    rollbackOne: (params: { snapshotId: string }) => Promise<{ success: boolean; restored: string[]; removed: string[]; errors: string[]; error?: string }>
    delete: (params: { snapshotId: string }) => Promise<{ success: boolean; error?: string }>
  }
  muse: {
    learning: {
      list: () => Promise<{ success: boolean; data?: LearningMap[]; error?: string }>
      listMeta: () => Promise<{ success: boolean; data?: LearningMapMeta[]; error?: string }>
      get: (mapId: string) => Promise<{ success: boolean; data?: LearningMap | null; error?: string }>
      getNode: (mapId: string, nodeId: string) => Promise<{ success: boolean; data?: LearningNode; error?: string }>
      create: (payload: { title: string; description?: string }) => Promise<{ success: boolean; data?: LearningMap; error?: string }>
      updateMap: (payload: { mapId: string; updates: { title?: string; description?: string } }) => Promise<{ success: boolean; data?: LearningMap; error?: string }>
      deleteMap: (mapId: string) => Promise<{ success: boolean; data?: { id: string; title: string; removedNodes: number }; error?: string }>
      addNode: (payload: { mapId: string; parentId: string; title: string; summary?: string; status?: LearningNode['status'] }) => Promise<{ success: boolean; data?: LearningNode; error?: string }>
      deleteNode: (payload: { mapId: string; nodeId: string }) => Promise<{ success: boolean; data?: { map: LearningMap; removed: string[] }; error?: string }>
      updateNode: (payload: { mapId: string; nodeId: string; updates: Partial<Pick<LearningNode, 'title' | 'status' | 'verifiedBy' | 'summary' | 'evidence' | 'nextStep' | 'content' | 'qa' | 'quiz'>> }) => Promise<{ success: boolean; data?: LearningNode; error?: string }>
      setCurrent: (payload: { mapId: string; nodeId: string }) => Promise<{ success: boolean; data?: LearningMap; error?: string }>
      aiAsk: (payload: { requestId: string; kind: 'content' | 'ask' | 'drill' | 'quiz' | 'grade'; mapTitle?: string; nodePath?: string; nodeTitle: string; selection?: string; question?: string; content?: string; answers?: string; nodeDirectory?: string }) => Promise<{ success: boolean; error?: string }>
      aiAbort: (requestId: string) => Promise<{ success: boolean }>
      onAiChunk: (callback: (data: { requestId: string; delta: string; content: string }) => void) => () => void
      onAiEnd: (callback: (data: { requestId: string; success: boolean; content: string; error?: string }) => void) => () => void
      prefetchStatus: () => Promise<{ success: boolean; data?: LearningPrefetchStatus }>
      prefetchBump: (mapId: string, nodeId: string) => Promise<{ success: boolean }>
      getSettings: () => Promise<{ success: boolean; data?: LearningSettings; error?: string }>
      setSettings: (patch: Partial<LearningSettings>) => Promise<{ success: boolean; data?: LearningSettings; error?: string }>
      onPrefetchStatus: (callback: (data: LearningPrefetchStatus & { lastDone?: { mapId: string; nodeId: string } }) => void) => () => void
    }
    getStatus: () => Promise<{
      home: string
      journals: string[]
      insights: string[]
      workspaceFiles: string[]
      profileSections: string[]
    }>
    // 知识检索
    knowledge: {
      search: (keyword: string, limit?: number) => Promise<{ memories: any[]; insights: any[]; summaries: any[] }>
      consolidate: () => Promise<any>
      retrieveRelevant: (taskCommand: string, limit?: number) => Promise<{ experience: string }>
    }
    onTaskProgress: (callback: (data: { taskId: string; subtaskId?: string; status: string; message: string; current: number; total: number; error?: string; repairAttempts?: number }) => void) => () => void
  }
  workspace: {
    getCurrent: () => Promise<{ success: boolean; data: { path: string; name: string } | null }>
    openWorkspaceSelector: () => Promise<{ success: boolean; data?: { path: string; name: string }; canceled?: boolean; error?: string }>
    setWorkspace: (path: string) => Promise<{ success: boolean; data?: { path: string; name: string }; error?: string }>
    listWorkspaces: () => Promise<{ success: boolean; data: Array<{ path: string; name: string; lastUsed: number }> }>
    detectEnv: () => Promise<{ success: boolean; data: { type: string; label: string; startCommand: string | null; runnable: boolean } | null }>
    detectEditors: () => Promise<{ success: boolean; data: Array<{ id: string; name: string }> }>
    openInFolder: (path?: string) => Promise<{ success: boolean; error?: string }>
    openInEditor: (editorId: string) => Promise<{ success: boolean; error?: string }>
    onChanged: (callback: (workspace: { path: string; name: string }) => void) => () => void
    analyzeArchitecture: () => Promise<{
      success: boolean
      data?: {
        repository: { path: string; name: string; branch: string; head: string }
        changeset: { mode: 'working-tree' | 'latest-commit'; label: string; subject?: string }
        summary: { changedFiles: number; changedModules: number; affectedModules: number; untestedFiles: number }
        modules: Array<{
          id: string
          label: string
          state: 'changed' | 'affected'
          testStatus: 'changed' | 'existing' | 'missing' | 'not-applicable'
          evidence: Array<{ kind: 'static'; text: string }>
          files: Array<{
            path: string
            status: string
            untracked: boolean
            added: number
            deleted: number
            tests: string[]
            testStatus: 'changed' | 'existing' | 'missing' | 'not-applicable'
          }>
        }>
        edges: Array<{ from: string; to: string; label: string; evidence: string; kind: 'static' }>
      }
      error?: string
    }>
  }
  security: {
    analyze: (command: string) => Promise<{
      safe: boolean
      riskScore: number
      riskLevel: string
      message: string
      patterns: any[]
      blastRadius?: string
      suggestions?: string[]
    }>
  }
  task: {
    confirm: (params: { taskId: string; confirmed: boolean }) => Promise<any>
    cancel: (params: { taskId: string }) => Promise<any>
    status: (params: { taskId: string }) => Promise<any>
    pause: (params: { taskId: string }) => Promise<any>
    resume: (params: { taskId: string; modifiedSteps?: any[] }) => Promise<any>
    intervene: (params: { taskId: string; message: string }) => Promise<{ success: boolean; error?: string }>
    execute: (taskPlan: { steps: any[]; needConfirm?: boolean; summary?: string }) => Promise<any>
    getUnfinished: () => Promise<{ success: boolean; data: Array<{
      id: string; originalInput: string; taskName: string; status: string;
      pauseReason: string | null; stepCount: number; completedSteps: number;
      currentStepIndex: number; createdAt: number; updatedAt: number
    }> }>
    clearUnfinished: (taskId: string) => Promise<{ success: boolean }>
    clearAllUnfinished: () => Promise<{ success: boolean; cleared?: number }>
    getHistory: (limit?: number) => Promise<{ success: boolean; data: any[] }>
    getScreenshot: (filename: string) => Promise<{ success: boolean; data?: string; mimeType?: string; fullPath?: string; error?: string }>
    openInFolder: (filename: string) => Promise<{ success: boolean; error?: string }>
    confirmPlan: (data: { taskId: string; confirmed: boolean; modifiedPlan?: any }) => void
    cancelPlan: (data: { taskId: string; confirmed: boolean }) => void
    onPlanning: (callback: (data: { message: string; input?: string }) => void) => () => void
    onPlanReady: (callback: (data: any) => void) => () => void
    onTaskStart: (callback: (data: any) => void) => () => void
    onStepStart: (callback: (data: any) => void) => () => void
    onStepComplete: (callback: (data: any) => void) => () => void
    onNeedConfirm: (callback: (data: any) => void) => () => void
    onProgress: (callback: (data: any) => void) => () => void
    onComplete: (callback: (data: any) => void) => () => void
    onError: (callback: (data: any) => void) => () => void
    onPaused: (callback: (data: { taskId: string }) => void) => () => void
onStepRetry: (callback: (data: { stepId: number; stepDescription: string; currentRetry: number; maxRetries: number; error: string; strategy: string }) => void) => () => void
onMaxRetryReached: (callback: (data: { stepId: number; stepDescription: string; error: string; retryCount: number; maxRetries: number }) => void) => () => void
  }
}

export interface LearningNode {
  id: string
  parentId: string | null
  title: string
  status: 'unexplored' | 'learning' | 'understood' | 'verified'
  // 「已验证」的来源：手动标记还是章节验收通过；离开已验证后清空
  verifiedBy?: '' | 'manual' | 'quiz'
  summary: string
  evidence: string
  nextStep: string
  // 「活的书」章节正文（markdown，AI 生成或手写）
  content?: string
  // 圈选提问沉淀的问答
  qa?: LearningQA[]
  // 章节验收答题记录
  quiz?: LearningQuiz[]
  createdAt: string
  updatedAt: string
}

// 元数据视图：树/导图/看板用，不含章节正文
export interface LearningNodeMeta {
  id: string
  parentId: string | null
  title: string
  status: LearningNode['status']
  summary: string
  nextStep: string
  hasContent: boolean
  createdAt: string
  updatedAt: string
}

export interface LearningMapMeta extends Omit<LearningMap, 'nodes'> {
  nodes: LearningNodeMeta[]
}

export interface LearningQA {
  question: string
  selection: string
  answer: string
  createdAt: string
}

export interface LearningQuiz {
  items: { question: string; answer: string; pass: boolean; comment: string }[]
  // nodeId 是权威定位（标题会被改重名）；nodeTitle 仅用于展示
  guidance: { nodeId?: string; nodeTitle: string; reason: string }[]
  createdAt: string
}

export interface LearningPrefetchStatus {
  active: boolean
  current: { mapId: string; nodeId: string; title: string } | null
  queueLeft: number
  // 连续失败已放弃的章节数
  stalled: number
  enabled: boolean
  doneSession: number
}

export interface LearningSettings {
  prefetchEnabled: boolean
}

export interface LearningMap {
  id: string
  title: string
  description: string
  // 内置知识图谱（随应用注入，用户不可编辑来源）
  builtIn?: boolean
  currentNodeId: string
  nodes: LearningNode[]
  createdAt: string
  updatedAt: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}

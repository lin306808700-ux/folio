// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const { contextBridge, ipcRenderer } = require('electron')

// 暴露 Electron API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // Shell API - 通过 IPC 调用主进程的 shell
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath)
  },

  // 功能减法：Artifact 独立预览窗口（artifact:openWindow）已下线，内联卡片保留 DOM 全屏预览

  // Session 管理 API
  session: {
    getCurrent: () => ipcRenderer.invoke('session:getCurrent'),
    reset: () => ipcRenderer.invoke('session:reset')
  },

  // 应用设置（模型地址 / 密钥，持久化到 userData）
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },
  
  // 终端 API
  terminal: {
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (data) => ipcRenderer.send('terminal:write', data),
    resize: (size) => ipcRenderer.send('terminal:resize', size),
    onData: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('terminal:data', subscription)
      // 返回清理函数
      return () => ipcRenderer.removeListener('terminal:data', subscription)
    },
    // 新增：获取终端最近输出（用于 AI 分析执行结果）
    getRecentOutput: (limit) => ipcRenderer.invoke('terminal:getRecentOutput', { limit }),
    // 获取终端当前 cwd 下的文件列表（用于 @ 触发器）
    listCwdFiles: () => ipcRenderer.invoke('terminal:listCwdFiles')
  },
  
  // AI API - 通过 Main 进程调用，避免 CORS
  ai: {
    call: (params) => ipcRenderer.invoke('ai:call', params),
    // 流式调用（发起请求，数据通过事件推送）
    stream: (params) => ipcRenderer.invoke('ai:stream', params),
    // 中断流式响应
    abortStream: () => ipcRenderer.invoke('ai:abortStream'),
    greeting: () => ipcRenderer.invoke('ai:greeting'),
    onSearchStatus: (callback) => {
      const subscription = (_, status) => callback(status)
      ipcRenderer.on('ai:searchStatus', subscription)
      return () => ipcRenderer.removeListener('ai:searchStatus', subscription)
    },
    // 流式 chunk 事件监听
    onStreamChunk: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('ai:streamChunk', subscription)
      return () => ipcRenderer.removeListener('ai:streamChunk', subscription)
    },
    // followUp 进度事件监听
    onFollowUpProgress: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('ai:followUpProgress', subscription)
      return () => ipcRenderer.removeListener('ai:followUpProgress', subscription)
    },
    // 流式结束事件监听
    onStreamEnd: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('ai:streamEnd', subscription)
      return () => ipcRenderer.removeListener('ai:streamEnd', subscription)
    },
  },
  
  // 任务引擎 API
  task: {
    confirm: (params) => ipcRenderer.invoke('task:confirm', params),
    cancel: (params) => ipcRenderer.invoke('task:cancel', params),
    status: (params) => ipcRenderer.invoke('task:status', params),
    pause: (params) => ipcRenderer.invoke('task:pause', params),
    resume: (params) => ipcRenderer.invoke('task:resume', params),
    intervene: (params) => ipcRenderer.invoke('task:intervene', params),
    getScreenshot: (filename) => ipcRenderer.invoke('task:getScreenshot', filename),
    openInFolder: (filename) => ipcRenderer.invoke('task:openInFolder', filename),
    confirmPlan: (data) => {
      console.log('[preload] confirmPlan 调用, data:', data)
      ipcRenderer.send('task:planConfirm', data)
    },
    cancelPlan: (data) => {
      console.log('[preload] cancelPlan 调用, data:', data)
      ipcRenderer.send('task:planCancel', data)
    },
    getUnfinished: () => ipcRenderer.invoke('task:getUnfinished'),
    clearUnfinished: (taskId) => ipcRenderer.invoke('task:clearUnfinished', { taskId }),
    clearAllUnfinished: () => ipcRenderer.invoke('task:clearAllUnfinished'),
    getHistory: (limit) => ipcRenderer.invoke('task:getHistory', { limit }),
    onPlanning: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:planning', subscription)
      return () => ipcRenderer.removeListener('task:planning', subscription)
    },
    onPlanReady: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:planReady', subscription)
      return () => ipcRenderer.removeListener('task:planReady', subscription)
    },
    onTaskStart: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:start', subscription)
      return () => ipcRenderer.removeListener('task:start', subscription)
    },
    onStepStart: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:stepStart', subscription)
      return () => ipcRenderer.removeListener('task:stepStart', subscription)
    },
    onStepComplete: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:stepComplete', subscription)
      return () => ipcRenderer.removeListener('task:stepComplete', subscription)
    },
    onNeedConfirm: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:needConfirm', subscription)
      return () => ipcRenderer.removeListener('task:needConfirm', subscription)
    },
    onProgress: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:progress', subscription)
      return () => ipcRenderer.removeListener('task:progress', subscription)
    },
    onComplete: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:complete', subscription)
      return () => ipcRenderer.removeListener('task:complete', subscription)
    },
    onError: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:error', subscription)
      return () => ipcRenderer.removeListener('task:error', subscription)
    },
    onPaused: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:paused', subscription)
      return () => ipcRenderer.removeListener('task:paused', subscription)
    },
    onStepRetry: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:stepRetry', subscription)
      return () => ipcRenderer.removeListener('task:stepRetry', subscription)
    },
    onMaxRetryReached: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('task:maxRetryReached', subscription)
      return () => ipcRenderer.removeListener('task:maxRetryReached', subscription)
    }
  },
  
  // 数据库 API - 本地 JSON 存储
  db: {
    history: {
      getAll: () => ipcRenderer.invoke('db:history:getAll'),
      add: (item) => ipcRenderer.invoke('db:history:add', item),
      delete: (id) => ipcRenderer.invoke('db:history:delete', id),
      clearAll: () => ipcRenderer.invoke('db:history:clearAll')
    },
    memories: {
      getAll: () => ipcRenderer.invoke('db:memories:getAll'),
      add: (content) => ipcRenderer.invoke('db:memories:add', content),
      delete: (id) => ipcRenderer.invoke('db:memories:delete', id)
    },
    memorySummary: {
      getAll: () => ipcRenderer.invoke('db:memorySummary:getAll'),
      update: (id, item) => ipcRenderer.invoke('db:memorySummary:update', { id, item }),
      delete: (id) => ipcRenderer.invoke('db:memorySummary:delete', id)
    },
    ideas: {
      getAll: () => ipcRenderer.invoke('db:ideas:getAll'),
      add: (item) => ipcRenderer.invoke('db:ideas:add', item),
      delete: (id) => ipcRenderer.invoke('db:ideas:delete', id)
    },
    promptTemplates: {
      list: () => ipcRenderer.invoke('db:promptTemplates:list')
    },
    craft: {
      list: () => ipcRenderer.invoke('db:craft:list')
    }
  },
  
  // 脚本子进程执行事件
  script: {
    onExecuting: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:executing', subscription)
      return () => ipcRenderer.removeListener('script:executing', subscription)
    },
    onOutput: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:output', subscription)
      return () => ipcRenderer.removeListener('script:output', subscription)
    },
    onError: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:error', subscription)
      return () => ipcRenderer.removeListener('script:error', subscription)
    },
    onComplete: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:complete', subscription)
      return () => ipcRenderer.removeListener('script:complete', subscription)
    },
    onNeedAuth: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:needAuth', subscription)
      return () => ipcRenderer.removeListener('script:needAuth', subscription)
    },
    onRetrying: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:retrying', subscription)
      return () => ipcRenderer.removeListener('script:retrying', subscription)
    },
    onFollowUp: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('script:followUp', subscription)
      return () => ipcRenderer.removeListener('script:followUp', subscription)
    },
    authResponse: (data) => ipcRenderer.send('script:authResponse', data)
  },

  // 文件快照与回滚 API
  snapshot: {
    list: () => ipcRenderer.invoke('snapshot:list'),
    rollback: (params) => ipcRenderer.invoke('snapshot:rollback', params),
    rollbackOne: (params) => ipcRenderer.invoke('snapshot:rollbackOne', params),
    delete: (params) => ipcRenderer.invoke('snapshot:delete', params)
  },

  // 缪斯智能体 API
  muse: {
    learning: {
      list: () => ipcRenderer.invoke('muse:learning:list'),
      listMeta: () => ipcRenderer.invoke('muse:learning:listMeta'),
      get: (mapId) => ipcRenderer.invoke('muse:learning:get', { mapId }),
      getNode: (mapId, nodeId) => ipcRenderer.invoke('muse:learning:getNode', { mapId, nodeId }),
      create: (payload) => ipcRenderer.invoke('muse:learning:create', payload),
      updateMap: (payload) => ipcRenderer.invoke('muse:learning:updateMap', payload),
      deleteMap: (mapId) => ipcRenderer.invoke('muse:learning:deleteMap', { mapId }),
      addNode: (payload) => ipcRenderer.invoke('muse:learning:addNode', payload),
      deleteNode: (payload) => ipcRenderer.invoke('muse:learning:deleteNode', payload),
      updateNode: (payload) => ipcRenderer.invoke('muse:learning:updateNode', payload),
      setCurrent: (payload) => ipcRenderer.invoke('muse:learning:setCurrent', payload),
      // 活的书：AI 流式写章节/圈选提问/下钻衍生
      aiAsk: (payload) => ipcRenderer.invoke('muse:learning:aiAsk', payload),
      aiAbort: (requestId) => ipcRenderer.invoke('muse:learning:aiAbort', { requestId }),
      onAiChunk: (callback) => {
        const subscription = (_, data) => callback(data)
        ipcRenderer.on('muse:learning:aiChunk', subscription)
        return () => ipcRenderer.removeListener('muse:learning:aiChunk', subscription)
      },
      onAiEnd: (callback) => {
        const subscription = (_, data) => callback(data)
        ipcRenderer.on('muse:learning:aiEnd', subscription)
        return () => ipcRenderer.removeListener('muse:learning:aiEnd', subscription)
      },
      // 后台预生成（预制章节）
      prefetchStatus: () => ipcRenderer.invoke('muse:learning:prefetchStatus'),
      prefetchBump: (mapId, nodeId) => ipcRenderer.invoke('muse:learning:prefetchBump', { mapId, nodeId }),
      getSettings: () => ipcRenderer.invoke('muse:learning:getSettings'),
      setSettings: (patch) => ipcRenderer.invoke('muse:learning:setSettings', patch),
      onPrefetchStatus: (callback) => {
        const subscription = (_, data) => callback(data)
        ipcRenderer.on('muse:learning:prefetchStatus', subscription)
        return () => ipcRenderer.removeListener('muse:learning:prefetchStatus', subscription)
      }
    },
    getStatus: () => ipcRenderer.invoke('muse:getStatus'),
    executeCommand: (params) => ipcRenderer.invoke('muse:executeCommand', params || {}),
    // 静态文件服务 URL
    staticServerUrl: 'http://localhost:8766',
    // 工作空间
    openWorkspace: () => ipcRenderer.invoke('muse:openWorkspace'),
    getWorkspaceFiles: () => ipcRenderer.invoke('muse:getWorkspaceFiles'),
    onTaskProgress: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('muse:taskProgress', sub)
      return () => ipcRenderer.removeListener('muse:taskProgress', sub)
    },
    onLog: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('muse:log', sub)
      return () => ipcRenderer.removeListener('muse:log', sub)
    },
    // ========== 知识检索 ==========
    knowledge: {
      search: (keyword, limit) => ipcRenderer.invoke('muse:knowledge:search', { keyword, limit }),
      consolidate: () => ipcRenderer.invoke('muse:knowledge:consolidate'),
      retrieveRelevant: (taskCommand, limit) => ipcRenderer.invoke('muse:knowledge:retrieveRelevant', { taskCommand, limit })
    }
  },

  // ReAct 实时进度事件
  react: {
    onStart: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:start', sub)
      return () => ipcRenderer.removeListener('react:start', sub)
    },
    onStep: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:step', sub)
      return () => ipcRenderer.removeListener('react:step', sub)
    },
    onObservation: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:observation', sub)
      return () => ipcRenderer.removeListener('react:observation', sub)
    },
    onDone: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:done', sub)
      return () => ipcRenderer.removeListener('react:done', sub)
    },
    // 危险 shell 命令确认 — 回传复用 script.authResponse（{ authId, granted }）
    onNeedConfirm: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:needConfirm', sub)
      return () => ipcRenderer.removeListener('react:needConfirm', sub)
    },
    // Plan 进度更新 — 推送当前 plan 状态 [{id, desc, done}]
    onPlanUpdate: (callback) => {
      const sub = (_, data) => callback(data)
      ipcRenderer.on('react:planUpdate', sub)
      return () => ipcRenderer.removeListener('react:planUpdate', sub)
    },
  },

  // 创作产物 API
  artifacts: {
    getRecent: (limit) => ipcRenderer.invoke('artifacts:getRecent', { limit }),
    search: (keyword) => ipcRenderer.invoke('artifacts:search', { keyword }),
    getBySession: (sessionId) => ipcRenderer.invoke('artifacts:getBySession', { sessionId }),
  },

  // 安全分析 API
  security: {
    analyze: (command) => ipcRenderer.invoke('security:analyze', { command })
  },
  
  // 语义缓存 API
  cache: {
    getStats: () => ipcRenderer.invoke('cache:getStats'),
    getReport: () => ipcRenderer.invoke('cache:getReport'),
    cleanup: () => ipcRenderer.invoke('cache:cleanup'),
    reset: () => ipcRenderer.invoke('cache:reset'),
    testQuery: (query) => ipcRenderer.invoke('cache:testQuery', { query })
  },
  
  // 功能减法：内置浏览器视图 API（browser:*）已下线

  // Token 监控 API
  token: {
    onUpdate: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('token:update', subscription)
      return () => ipcRenderer.removeListener('token:update', subscription)
    }
  },

  // 上下文长度统计 API
  context: {
    onStats: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('context:stats', subscription)
      return () => ipcRenderer.removeListener('context:stats', subscription)
    }
  },

  // 系统状态 API
  system: {
    getStats: () => ipcRenderer.invoke('system:getStats')
  },

  // Workspace 管理 API
  workspace: {
    getCurrent: () => ipcRenderer.invoke('workspace:getCurrent'),
    openWorkspaceSelector: () => ipcRenderer.invoke('workspace:openWorkspaceSelector'),
    setWorkspace: (path) => ipcRenderer.invoke('workspace:setWorkspace', { path }),
    listWorkspaces: () => ipcRenderer.invoke('workspace:listWorkspaces'),
    listFiles: () => ipcRenderer.invoke('workspace:listFiles'),
    analyzeArchitecture: () => ipcRenderer.invoke('workspace:analyzeArchitecture'),
    listDir: (dirPath) => ipcRenderer.invoke('workspace:listDir', { dirPath }),
    listTasks: () => ipcRenderer.invoke('workspace:listTasks'),
    retryTask: (taskId) => ipcRenderer.invoke('workspace:retryTask', { taskId }),
    cancelTask: (taskId) => ipcRenderer.invoke('workspace:cancelTask', { taskId }),
    openInFolder: (path) => ipcRenderer.invoke('workspace:openInFolder', { path }),
    detectEnv: () => ipcRenderer.invoke('workspace:detectEnv'),
    detectEditors: () => ipcRenderer.invoke('workspace:detectEditors'),
    openInEditor: (editorId) => ipcRenderer.invoke('workspace:openInEditor', { editorId }),
    onChanged: (callback) => {
      const subscription = (_, data) => callback(data)
      ipcRenderer.on('workspace:changed', subscription)
      return () => ipcRenderer.removeListener('workspace:changed', subscription)
    }
  },

  // 系统信息
  platform: process.platform,
  
  // 环境判断
  isDev: process.env.NODE_ENV === 'development'
})

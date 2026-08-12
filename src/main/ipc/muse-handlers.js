'use strict'

const { ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const museAgent = require('../muse-agent')
const { Letters } = require('../database')
const { WORKSPACE_DIR } = require('../muse/config')
const staticServer = require('../muse/static-server')
const { ARCHIVE_DIR } = require('../muse/archive')
const artifactStore = require('../muse/artifact-store')
const goals = require('../muse/goals')
const knowledge = require('../muse/knowledge')
const autonomy = require('../muse/autonomy')
const learningMaps = require('../muse/learning-maps').store
const learningPrefetch = require('../muse/learning-prefetch')
const { callAIStream } = require('../../shared/ai-client')

let _mainWindow = null

/**
 * 注册缪斯智能体的 IPC handlers
 */
function registerMuseHandlers(mainWindow) {
  _mainWindow = mainWindow
  const learningResponse = action => {
    try {
      return { success: true, data: action() }
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  ipcMain.handle('muse:learning:list', () => learningResponse(() => learningMaps.list()))
  ipcMain.handle('muse:learning:get', (_event, { mapId }) => learningResponse(() => learningMaps.get(mapId)))
  ipcMain.handle('muse:learning:create', (_event, payload) => learningResponse(() => learningMaps.create(payload)))
  ipcMain.handle('muse:learning:addNode', (_event, { mapId, ...payload }) => learningResponse(() => learningMaps.addNode(mapId, payload)))
  ipcMain.handle('muse:learning:updateNode', (_event, { mapId, nodeId, updates }) => learningResponse(() => learningMaps.updateNode(mapId, nodeId, updates)))
  ipcMain.handle('muse:learning:setCurrent', (_event, { mapId, nodeId }) => learningResponse(() => learningMaps.setCurrent(mapId, nodeId)))

  // ========== 学习图谱 AI 流式通道（活的书：写章节/圈选提问/下钻衍生） ==========
  // 每个 requestId 一个 AbortController，支持中途停止
  const learningAiRequests = new Map()
  const { buildLearningPrompt } = require('../muse/learning-prompts')

  // 后台预生成管线：空闲时逐章预制，打开节点即可读
  learningPrefetch.start(() => _mainWindow)

  ipcMain.handle('muse:learning:prefetchStatus', () => ({ success: true, data: learningPrefetch.getStatus() }))
  ipcMain.handle('muse:learning:prefetchBump', (_event, { mapId, nodeId } = {}) => {
    learningPrefetch.bump(mapId, nodeId)
    return { success: true }
  })

  ipcMain.handle('muse:learning:aiAsk', (_event, payload) => {
    const { requestId } = payload || {}
    if (!requestId || learningAiRequests.has(requestId)) {
      return { success: false, error: '无效的请求 ID' }
    }
    // 交互式请求抢占后台预生成，避免用户排在章节生成后面等待
    learningPrefetch.preemptForInteractive()
    const controller = new AbortController()
    learningAiRequests.set(requestId, controller)
    const send = (channel, data) => {
      if (_mainWindow && !_mainWindow.isDestroyed()) _mainWindow.webContents.send(channel, data)
    }
    ;(async () => {
      try {
        const prompt = buildLearningPrompt(payload)
        const stream = callAIStream(prompt, { signal: controller.signal })
        let content = ''
        for await (const frame of stream) {
          content = frame.content || content
          if (frame.delta) send('muse:learning:aiChunk', { requestId, delta: frame.delta, content })
          if (frame.streamEnd) break
        }
        send('muse:learning:aiEnd', { requestId, success: true, content })
      } catch (error) {
        const aborted = controller.signal.aborted
        send('muse:learning:aiEnd', { requestId, success: !aborted, content: '', error: aborted ? '已停止生成' : (error.message || 'AI 调用失败') })
      } finally {
        learningAiRequests.delete(requestId)
      }
    })()
    return { success: true }
  })

  ipcMain.handle('muse:learning:aiAbort', (_event, { requestId } = {}) => {
    const controller = learningAiRequests.get(requestId)
    if (controller) controller.abort()
    return { success: true }
  })
  // 晊间回顾
  ipcMain.handle('muse:morningReview', async () => {
    return await museAgent.morningReview()
  })

  // 对话分析（后台静默执行，不阻塞主流程）
  ipcMain.handle('muse:analyzeConversation', async (_event, { query, aiResponse }) => {
    return await museAgent.analyzeConversation(query, aiResponse)
  })

  // 主动探索
  ipcMain.handle('muse:explore', async (_event, { topic } = {}) => {
    return await museAgent.proactiveExplore(topic)
  })

  // 执行直接指令
  ipcMain.handle('muse:executeCommand', async (_event, { command } = {}) => {
    return await museAgent.executeCommand(command)
  })

  // 获取缪斯状态
  ipcMain.handle('muse:getStatus', async () => {
    return museAgent.getStatus()
  })

  // 读取日志
  ipcMain.handle('muse:readJournal', async (_event, { filename }) => {
    const fs = require('fs')
    const path = require('path')
    const filepath = path.join(museAgent.JOURNAL_DIR, filename)
    try {
      return { success: true, content: fs.readFileSync(filepath, 'utf8') }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 读取洞察报告
  ipcMain.handle('muse:readInsight', async (_event, { filename }) => {
    const fs = require('fs')
    const path = require('path')
    const filepath = path.join(museAgent.INSIGHTS_DIR, filename)
    try {
      return { success: true, content: fs.readFileSync(filepath, 'utf8') }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 读取主人画像
  ipcMain.handle('muse:readProfile', async (_event, { section }) => {
    const fs = require('fs')
    const path = require('path')
    const filepath = path.join(museAgent.PROFILE_DIR, `${section}.md`)
    try {
      return { success: true, content: fs.readFileSync(filepath, 'utf8') }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 打开工作空间目录
  ipcMain.handle('muse:openWorkspace', async () => {
    try {
      await shell.openPath(WORKSPACE_DIR)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 获取工作空间文件列表（带 URL，递归扫描）
  ipcMain.handle('muse:getWorkspaceFiles', async () => {
    try {
      const allFiles = []
      
      // 忽略的目录名
      const IGNORED_DIRS = new Set([
        'node_modules', 'dist', 'build', '.git', '.svn',
        '__pycache__', '.cache', '.tmp', 'coverage',
        '.next', '.nuxt', '.output', 'vendor'
      ])

      // 递归扫描目录
      function scanDir(dir, baseDir = '') {
        const entries = fs.readdirSync(dir)
        
        for (const entry of entries) {
          // 跳过隐藏文件和忽略目录
          if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue
          
          const fullPath = path.join(dir, entry)
          const relativePath = baseDir ? path.join(baseDir, entry) : entry
          const stat = fs.statSync(fullPath)
          
          if (stat.isDirectory()) {
            // 递归扫描子目录
            scanDir(fullPath, relativePath)
          } else {
            // 添加文件
            allFiles.push({
              name: entry,
              path: relativePath,
              size: stat.size,
              modified: stat.mtime,
              isDirectory: false,
              url: `http://localhost:${staticServer.PORT}/workspace/${relativePath}`
            })
          }
        }
      }
      
      scanDir(WORKSPACE_DIR)
      
      // 排序：HTML 文件优先，然后按修改时间倒序
      const htmlExtensions = ['.html', '.htm']
      allFiles.sort((a, b) => {
        const aIsHtml = htmlExtensions.includes(path.extname(a.path).toLowerCase())
        const bIsHtml = htmlExtensions.includes(path.extname(b.path).toLowerCase())
        
        // HTML 文件排在前面
        if (aIsHtml && !bIsHtml) return -1
        if (!aIsHtml && bIsHtml) return 1
        
        // 同类文件按修改时间倒序
        return new Date(b.modified) - new Date(a.modified)
      })
      
      return { success: true, files: allFiles }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // ========== 缪斯信箱 ==========

  // 获取所有信封
  ipcMain.handle('muse:getLetters', async () => {
    return Letters.getAll()
  })

  // 获取未读数
  ipcMain.handle('muse:getUnreadCount', async () => {
    return Letters.getUnreadCount()
  })

  // 获取任务列表
  ipcMain.handle('muse:getTasks', async () => {
    return museAgent.loadTasks()
  })

  // 更新任务
  ipcMain.handle('muse:updateTask', async (_event, { id, updates }) => {
    return museAgent.updateTaskStatus(id, updates)
  })

  // 添加子任务
  ipcMain.handle('muse:addSubtask', async (_event, { parentId, command, priority }) => {
    const subtask = museAgent.addSubtask(parentId, command, { priority: priority || 'normal' })
    return subtask ? { success: true, subtask } : { success: false, error: '父任务不存在或不允许添加子任务' }
  })

  // 获取归档任务列表
  ipcMain.handle('muse:getArchivedTasks', async () => {
    try {
      if (!fs.existsSync(ARCHIVE_DIR)) return { success: true, tasks: [] }
      
      const allTasks = []
      const files = fs.readdirSync(ARCHIVE_DIR)
        .filter(f => f.startsWith('tasks-') && f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)) // 最新的在前

      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8'))
          allTasks.push(...data)
        } catch {}
      }

      return { success: true, tasks: allTasks }
    } catch (err) {
      return { success: false, error: err.message, tasks: [] }
    }
  })

  // 删除任务
  ipcMain.handle('muse:deleteTask', async (_event, { id }) => {
    const tasks = museAgent.loadTasks()
    const task = tasks.find(t => t.id === id)
    if (!task) return false
    
    let filteredTasks
    // 如果是父任务，删除所有层级的子任务
    if (!task.parentId) {
      // 收集所有需要删除的 ID
      const idsToDelete = new Set([id])
      
      // 递归收集所有子任务 ID
      const collectSubtasks = (parentId) => {
        tasks.filter(t => t.parentId === parentId).forEach(st => {
          idsToDelete.add(st.id)
          collectSubtasks(st.id) // 递归收集更深层次的子任务
        })
      }
      collectSubtasks(id)
      
      // 过滤掉所有相关任务
      filteredTasks = tasks.filter(t => !idsToDelete.has(t.id))
    } else {
      // 删除子任务（包括它的子任务）
      const idsToDelete = new Set([id])
      const collectSubtasks = (parentId) => {
        tasks.filter(t => t.parentId === parentId).forEach(st => {
          idsToDelete.add(st.id)
          collectSubtasks(st.id)
        })
      }
      collectSubtasks(id)
      filteredTasks = tasks.filter(t => !idsToDelete.has(t.id))
    }
    
    // 使用 museAgent 的路径保存
    const fs = require('fs')
    const path = require('path')
    const tasksFile = path.join(process.env.HOME, '.ai-terminal/muse/tasks.json')
    fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2))
    
    return true
  })

  // 暂停心跳
  ipcMain.handle('muse:pauseHeartbeat', async () => {
    return museAgent.pauseHeartbeat()
  })

  // 重启心跳
  ipcMain.handle('muse:restartHeartbeat', async () => {
    return museAgent.restartHeartbeat()
  })

  // 获取心跳状态
  ipcMain.handle('muse:getHeartbeatStatus', async () => {
    return museAgent.getHeartbeatStatus()
  })

  // 标记已读
  ipcMain.handle('muse:markRead', async (_event, { id }) => {
    const result = Letters.markRead(id)
    
    // 推送未读数更新事件
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      const unreadCount = Letters.getUnreadCount()
      _mainWindow.webContents.send('muse:unreadCountUpdated', unreadCount)
    }
    
    return result
  })

  // 主人回复信件
  ipcMain.handle('muse:replyLetter', async (_event, { id, content }) => {
    const letter = Letters.reply(id, content)
    if (!letter) return { success: false, error: '信件不存在' }
    // 触发 Muse 感知反馈闭环
    setImmediate(() => {
      museAgent.processReply(id, content).catch(err => {
        console.warn('[Muse] 反馈处理异常:', err.message)
      })
    })
    return { success: true, letter }
  })


  // 删除信封
  ipcMain.handle('muse:deleteLetter', async (_event, { id }) => {
    return Letters.delete(id)
  })

  // ========== 创作产物 API ==========
  ipcMain.handle('artifacts:getRecent', async (_event, { limit } = {}) => {
    return artifactStore.getRecent(limit || 50)
  })

  ipcMain.handle('artifacts:search', async (_event, { keyword } = {}) => {
    return artifactStore.search(keyword || '', 20)
  })

  ipcMain.handle('artifacts:getBySession', async (_event, { sessionId } = {}) => {
    return artifactStore.getBySession(sessionId || '')
  })

  // ========== 目标管理 API ==========
  ipcMain.handle('muse:goal:create', async (_event, { title, description, direction }) => {
    return goals.createGoal(title, description, direction)
  })

  ipcMain.handle('muse:goal:list', async () => {
    return goals.loadGoals()
  })

  ipcMain.handle('muse:goal:getActive', async () => {
    return goals.getActiveGoals()
  })

  ipcMain.handle('muse:goal:update', async (_event, { id, updates }) => {
    return goals.updateGoal(id, updates)
  })

  ipcMain.handle('muse:goal:delete', async (_event, { id }) => {
    return goals.deleteGoal(id)
  })

  ipcMain.handle('muse:goal:complete', async (_event, { id }) => {
    return goals.completeGoal(id)
  })

  ipcMain.handle('muse:goal:addStep', async (_event, { goalId, topic }) => {
    return goals.addExploreStep(goalId, topic)
  })

  ipcMain.handle('muse:goal:progress', async (_event, { id }) => {
    return goals.getGoalProgress(id)
  })

  // ========== 知识检索 API ==========
  ipcMain.handle('muse:knowledge:search', async (_event, { keyword, limit } = {}) => {
    return knowledge.searchKnowledge(keyword || '', limit || 20)
  })

  ipcMain.handle('muse:knowledge:consolidate', async () => {
    return await knowledge.consolidateMemories()
  })

  ipcMain.handle('muse:knowledge:retrieveRelevant', async (_event, { taskCommand, limit } = {}) => {
    const result = knowledge.retrieveRelevant(taskCommand, limit || 5)
    return { experience: result }
  })

  // ========== 自主等级 API ==========
  ipcMain.handle('muse:autonomy:getState', async () => {
    return autonomy.getState()
  })

  ipcMain.handle('muse:autonomy:getLevel', async () => {
    return { level: autonomy.getLevel() }
  })

  ipcMain.handle('muse:autonomy:evaluate', async () => {
    return autonomy.evaluateLevel()
  })

  console.log('[Muse] IPC handlers 已注册')
}

/**
 * 应用启动时触发晨间回顾（延迟执行，不阻塞启动）
 */
function triggerMorningReviewOnStartup() {
  // 检查今天是否已经做过晨间回顾
  const fs = require('fs')
  const path = require('path')
  const today = new Date().toISOString().slice(0, 10)
  const morningJournal = path.join(museAgent.JOURNAL_DIR, `morning_${today}.md`)

  if (fs.existsSync(morningJournal)) {
    console.log('[Muse] 今日晨间回顾已完成，跳过')
    return
  }

  // 晨间回顾默认关闭，需手动在 Muse 页面触发
  console.log('[Muse] 晨间回顾自动触发已禁用')
}

module.exports = { registerMuseHandlers, triggerMorningReviewOnStartup }

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

// 延迟初始化：app.getPath 必须在 app ready 之后才能调用
let DATA_DIR = null
let FILES = null

function ensureInit() {
  if (DATA_DIR) return
  DATA_DIR = path.join(app.getPath('userData'), 'data')
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
  FILES = {
    history: path.join(DATA_DIR, 'history.json'),
    memories: path.join(DATA_DIR, 'memories.json'),
    memorySummary: path.join(DATA_DIR, 'memory-summary.json'),
    ideas: path.join(DATA_DIR, 'ideas.json'),
    letters: path.join(DATA_DIR, 'letters.json')
  }
}

// 读取 JSON 文件
function readJSON(file) {
  try {
    if (!fs.existsSync(file)) {
      return []
    }
    const data = fs.readFileSync(file, 'utf-8')
    return JSON.parse(data)
  } catch (e) {
    console.error(`[DB] 读取失败 ${file}:`, e)
    return []
  }
}

// 写入 JSON 文件
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error(`[DB] 写入失败 ${file}:`, e)
    return false
  }
}

// ========== 对话历史 ==========
const History = {
  getAll() {
    ensureInit()
    return readJSON(FILES.history)
  },
  
  add(item) {
    ensureInit()
    const list = this.getAll()
    const newItem = {
      id: Date.now().toString(),
      query: item.query,
      result: { content: item.content },
      messages: item.messages || [],
      created_at: new Date().toISOString(),
      ...item
    }
    list.unshift(newItem)  // 最新的在前面
    writeJSON(FILES.history, list)
    return newItem
  },
  
  delete(id) {
    ensureInit()
    const list = this.getAll().filter(item => item.id !== id)
    return writeJSON(FILES.history, list)
  },
  
  clearAll() {
    ensureInit()
    return writeJSON(FILES.history, [])
  },

  /**
   * 搜索历史对话（关键词匹配 query 和 result.content）
   * @param {string} keyword - 搜索关键词
   * @param {number} [limit=5] - 最多返回条数
   * @returns {Array} 匹配的历史记录（按相关度排序）
   */
  search(keyword, limit = 5) {
    ensureInit()
    if (!keyword || typeof keyword !== 'string') return []
    
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) return []

    const allRecords = this.getAll()
    const scored = []

    for (const record of allRecords) {
      const queryText = (record.query || '').toLowerCase()
      const contentText = (record.result?.content || record.content || '').toLowerCase()
      const combinedText = queryText + ' ' + contentText

      let score = 0
      for (const kw of keywords) {
        if (queryText.includes(kw)) score += 3
        if (contentText.includes(kw)) score += 1
      }
      if (score > 0) {
        scored.push({ ...record, _score: score })
      }
    }

    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit).map(({ _score, ...record }) => record)
  }
}

// ========== 整合强度计算 ==========

/**
 * USTU 启发的记忆整合强度系统
 * 每条记忆携带四维评分，检索时按 语义相似度 × 整合强度 排序
 * 
 * 四维评分：
 * - activation: 被引用/使用时产生的推理链强度 (0-1)
 * - integration: 与其他记忆/任务产生的关联密度 (0-1)  
 * - intent: 是否对应未完成的任务/目标 (0-1)
 * - recency: 时间衰减权重 (0-1, 按指数衰减)
 */
function calculateIntegrationScore(memory) {
  const now = Date.now()
  const createdAt = memory.created_at ? new Date(memory.created_at).getTime() : now
  // 防御 NaN：invalid date 会导致 getTime() 返回 NaN
  const ageHours = Number.isFinite(createdAt) ? (now - createdAt) / (1000 * 60 * 60) : 0
  
  // 时间衰减：半衰期 72 小时（3天）
  const recency = Math.exp(-0.693 * ageHours / 72)
  
  const activation = Number.isFinite(memory.activation) ? memory.activation : 0
  const integration = Number.isFinite(memory.integration) ? memory.integration : 0
  const intent = Number.isFinite(memory.intent) ? memory.intent : 0
  
  // 整合强度 = 加权组合，activation 和 intent 权重更高
  const score = (
    activation * 0.35 +
    integration * 0.2 +
    intent * 0.3 +
    recency * 0.15
  )
  
  return Math.min(1, Math.max(0, score))
}

/**
 * 批量衰减：对所有记忆执行时间衰减（定期调用）
 */
function decayAllMemories(memories) {
  const now = Date.now()
  for (const memory of memories) {
    if (memory.status === 'archived') continue
    const createdAt = memory.created_at ? new Date(memory.created_at).getTime() : now
    if (!Number.isFinite(createdAt)) continue
    const ageHours = (now - createdAt) / (1000 * 60 * 60)
    // 超过 7 天且整合强度极低的自动归档
    if (ageHours > 168 && calculateIntegrationScore(memory) < 0.1) {
      memory.status = 'archived'
    }
  }
  return memories
}

// ========== 记忆中心 ==========
const Memories = {
  getAll() {
    ensureInit()
    return readJSON(FILES.memories)
  },

  // 只返回 active 状态的记忆（旧数据无 status 字段视为 active）
  getActive() {
    const list = this.getAll()
    return list.filter(m => !m.status || m.status === 'active')
  },

  /**
   * 按整合强度排序检索记忆
   * 高整合强度的记忆优先返回（重要的事记得更清楚）
   */
  getByIntegrationScore(limit = 20) {
    const actives = this.getActive()
    const scored = actives.map(m => ({
      ...m,
      _score: calculateIntegrationScore(m)
    }))
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  },

  /**
   * 语义关键词 + 整合强度混合检索
   * relevance = 关键词匹配度 × 0.6 + 整合强度 × 0.4
   */
  searchWithIntegration(keyword, limit = 10) {
    if (!keyword || typeof keyword !== 'string') return []
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) return []

    const actives = this.getActive()
    const scored = []

    for (const memory of actives) {
      const text = (memory.content || '').toLowerCase()
      let matchScore = 0
      for (const kw of keywords) {
        if (text.includes(kw)) matchScore += 1
      }
      if (matchScore === 0) continue

      const relevance = Math.min(1, matchScore / keywords.length)
      const integrationScore = calculateIntegrationScore(memory)
      const finalScore = relevance * 0.6 + integrationScore * 0.4

      scored.push({ ...memory, _score: finalScore, _integrationScore: integrationScore })
    }

    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  },
  
  /**
   * 添加记忆
   * @param {string|object} content - 字符串或 { content, activation, integration, intent }
   *   - content: 记忆内容（必须）
   *   - activation: 初始激活强度 (0-1)，默认 0.1
   *   - integration: 初始关联密度 (0-1)，默认 0
   *   - intent: 意图强度 (0-1)，默认 0（由调用方根据是否关联未完成任务来设置）
   */
  add(content) {
    ensureInit()
    let actualContent, initialActivation, initialIntegration, initialIntent

    if (typeof content === 'object' && content !== null) {
      actualContent = content.content
      initialActivation = content.activation
      initialIntegration = content.integration
      initialIntent = content.intent
    } else {
      actualContent = content
    }

    const list = this.getAll()
    const newItem = {
      id: Date.now().toString(),
      content: actualContent,
      status: 'active',
      activation: typeof initialActivation === 'number' ? Math.min(1, Math.max(0, initialActivation)) : 0.1,
      integration: typeof initialIntegration === 'number' ? Math.min(1, Math.max(0, initialIntegration)) : 0,
      intent: typeof initialIntent === 'number' ? Math.min(1, Math.max(0, initialIntent)) : 0,
      created_at: new Date().toISOString()
    }
    list.unshift(newItem)
    writeJSON(FILES.memories, list)

    // 检查是否达到自动归纳阈值（5条）
    const activeMemories = list.filter(m => m.status === 'active')
    if (activeMemories.length >= 5) {
      return { ...newItem, shouldConsolidate: true }
    }

    return newItem
  },

  /**
   * 提升记忆的整合强度（当记忆被引用/使用时调用）
   * @param {string} id - 记忆ID
   * @param {object} boost - { activation, integration, intent } 增量
   */
  boostIntegration(id, boost = {}) {
    ensureInit()
    const list = this.getAll()
    const item = list.find(m => m.id === id)
    if (!item) return false

    // 累加激活强度（上限 1.0）
    if (boost.activation) {
      item.activation = Math.min(1, (item.activation || 0) + boost.activation)
    }
    // 累加关联密度
    if (boost.integration) {
      item.integration = Math.min(1, (item.integration || 0) + boost.integration)
    }
    // 更新意图强度（完成任务后降低）
    if (boost.intent !== undefined) {
      item.intent = Math.max(0, Math.min(1, boost.intent))
    }
    
    item.last_accessed = new Date().toISOString()
    writeJSON(FILES.memories, list)
    return true
  },

  /**
   * 执行全局衰减（应由定时任务调用，如每小时一次）
   * 低整合强度 + 超过 7 天的记忆自动归档
   */
  runDecay() {
    ensureInit()
    const list = this.getAll()
    const before = list.filter(m => m.status === 'active').length
    const decayed = decayAllMemories(list)
    const after = decayed.filter(m => m.status === 'active').length
    if (before !== after) {
      writeJSON(FILES.memories, decayed)
      console.log(`[Memory] 衰减归档: ${before - after} 条低整合记忆`)
    }
    return { archived: before - after }
  },

  // 将指定记忆标记为 archived
  archive(id) {
    ensureInit()
    const list = this.getAll()
    const item = list.find(m => m.id === id)
    if (!item) return false
    item.status = 'archived'
    return writeJSON(FILES.memories, list)
  },

  // 按关键词模糊匹配，批量归档相关记忆
  archiveByKeyword(keyword) {
    ensureInit()
    if (!keyword || typeof keyword !== 'string') return { count: 0 }

    const kw = keyword.trim().toLowerCase()
    if (kw.length < 2) return { count: 0 }

    const tooGeneric = ['的', '了', '是', '在', '有', '项目', '代码', '问题', '工作', '完成', '任务', '调试', '测试', '开发', '部署']
    if (tooGeneric.includes(kw)) return { count: 0 }

    const list = this.getAll()
    const MAX_ARCHIVE = 5
    let count = 0
    list.forEach(m => {
      if (count >= MAX_ARCHIVE) return
      if (m.status === 'archived') return
      const text = typeof m.content === 'string' ? m.content : ''
      if (text.toLowerCase().includes(kw)) {
        m.status = 'archived'
        count++
      }
    })
    if (count > 0) writeJSON(FILES.memories, list)
    return { count }
  },
  
  delete(id) {
    ensureInit()
    const list = this.getAll().filter(item => item.id !== id)
    return writeJSON(FILES.memories, list)
  },

  clear() {
    ensureInit()
    return writeJSON(FILES.memories, [])
  }
}

// ========== 记忆总结 ==========

const MemorySummary = {
  // 获取所有总结（自动补充 status 字段，向后兼容）
  getAll() {
    ensureInit()
    const list = readJSON(FILES.memorySummary)
    // 向后兼容：旧数据没有 status 字段，自动补充为 'active'
    return list.map(item => ({
      ...item,
      status: item.status || 'active'
    }))
  },

  // 只返回 active 状态的总结（用于 prompt 注入）
  getActive() {
    return this.getAll().filter(s => s.status === 'active')
  },

  add(item) {
    ensureInit()
    const list = this.getAll()
    const newItem = {
      id: Date.now().toString(),
      summary: item.summary,
      sourceCount: item.sourceCount || 0,
      status: 'active',
      created_at: new Date().toISOString()
    }
    list.unshift(newItem)
    writeJSON(FILES.memorySummary, list)

    return newItem
  },

  update(id, item) {
    ensureInit()
    const list = this.getAll()
    const index = list.findIndex(s => s.id === id)
    if (index === -1) return null
    list[index] = {
      ...list[index],
      summary: item.summary,
      updated_at: new Date().toISOString()
    }
    writeJSON(FILES.memorySummary, list)
    return list[index]
  },

  // 批量归档指定的记忆碎片 ID（操作 Memories 表）
  archiveByIds(ids) {
    ensureInit()
    const list = Memories.getAll()
    let count = 0
    list.forEach(m => {
      if (ids.includes(m.id) && m.status === 'active') {
        m.status = 'archived'
        count++
      }
    })
    if (count > 0) writeJSON(FILES.memories, list)
    return { count }
  },

  // 批量归档指定的总结 ID（操作 MemorySummary 表，用于二级压缩）
  archiveSummaryByIds(ids) {
    ensureInit()
    const list = this.getAll()
    let count = 0
    list.forEach(s => {
      if (ids.includes(s.id) && s.status === 'active') {
        s.status = 'archived'
        count++
      }
    })
    if (count > 0) writeJSON(FILES.memorySummary, list)
    console.log(`[Memory] 已归档 ${count} 条旧总结`)
    return { count }
  },

  delete(id) {
    ensureInit()
    const list = this.getAll().filter(item => item.id !== id)
    return writeJSON(FILES.memorySummary, list)
  }
}

// ========== 灵感采集 ==========
const Ideas = {
  getAll() {
    ensureInit()
    return readJSON(FILES.ideas)
  },
  
  add(item) {
    ensureInit()
    const list = this.getAll()
    const newItem = {
      id: Date.now().toString(),
      title: item.title || '无标题',
      content: item.content,
      created_at: new Date().toISOString()
    }
    list.unshift(newItem)
    writeJSON(FILES.ideas, list)
    return newItem
  },
  
  delete(id) {
    ensureInit()
    const list = this.getAll().filter(item => item.id !== id)
    return writeJSON(FILES.ideas, list)
  }
}

// ========== 缪斯信箱 ==========
const Letters = {
  getAll() {
    ensureInit()
    return readJSON(FILES.letters)
  },

  getUnread() {
    return this.getAll().filter(l => l.status === 'unread')
  },

  getUnreadCount() {
    return this.getUnread().length
  },

  create(item) {
    ensureInit()
    const list = this.getAll()
    const letter = {
      id: `letter_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: item.title || '缪斯来信',
      content: item.content || '',
      priority: item.priority || 'normal',
      status: 'unread',
      reply: null,
      reply_at: null,
      source: item.source || 'heartbeat',
      taskId: item.taskId || null, // 关联的任务 ID
      created_at: new Date().toISOString()
    }
    list.unshift(letter)
    writeJSON(FILES.letters, list)
    return letter
  },

  getById(id) {
    return this.getAll().find(l => l.id === id) || null
  },

  markRead(id) {
    ensureInit()
    const list = this.getAll()
    const item = list.find(l => l.id === id)
    if (!item) return false
    if (item.status === 'unread') item.status = 'read'
    return writeJSON(FILES.letters, list)
  },

  reply(id, content) {
    ensureInit()
    const list = this.getAll()
    const item = list.find(l => l.id === id)
    if (!item) return null
    item.status = 'replied'
    item.reply = content
    item.reply_at = new Date().toISOString()
    writeJSON(FILES.letters, list)
    return item
  },

  delete(id) {
    ensureInit()
    const list = this.getAll().filter(l => l.id !== id)
    return writeJSON(FILES.letters, list)
  }
}

module.exports = {
  History,
  Memories,
  MemorySummary,
  Ideas,
  Letters
}

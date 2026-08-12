const fs = require('fs')
const path = require('path')
const os = require('os')
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

// ========== 技能矩阵（纯文件操作） ==========

// Skills 缓存变量
let _skillsCache = null;
let _skillsCacheTime = null;
const SKILLS_CACHE_TTL = 60000; // 60秒过期

// Skills 目录监听
let _skillsWatcher = null;
let _skillsChangeCallback = null;
let _skillsChangeDebounce = null;

const Skills = {
  // 注册目录变化回调（由 index.js 启动时调用）
  onChanged(callback) {
    _skillsChangeCallback = callback
  },

  // 启动 skills 目录监听
  watchDir() {
    const skillsDir = this._ensureSkillsDir()
    if (_skillsWatcher) return

    try {
      _skillsWatcher = fs.watch(skillsDir, { recursive: true }, (eventType, filename) => {
        // 忽略非 SKILL.md 的变化和隐藏文件
        if (!filename || filename.startsWith('.')) return

        // 防抖：500ms 内多次变化只触发一次
        if (_skillsChangeDebounce) clearTimeout(_skillsChangeDebounce)
        _skillsChangeDebounce = setTimeout(() => {
          console.log(`[DB Skills] 检测到目录变化: ${eventType} ${filename}`)
          this.invalidateCache()
          if (_skillsChangeCallback) _skillsChangeCallback()
        }, 500)
      })
      console.log('[DB Skills] 已启动 skills 目录监听:', skillsDir)
    } catch (e) {
      console.warn('[DB Skills] 启动目录监听失败:', e.message)
    }
  },

  // 停止监听
  stopWatch() {
    if (_skillsWatcher) {
      _skillsWatcher.close()
      _skillsWatcher = null
    }
  },

  // 确保技能目录存在
  _ensureSkillsDir() {
    // 使用用户主目录下的 ~/.ai-terminal/skills，跨机器通用
    const skillsDir = path.join(os.homedir(), '.ai-terminal', 'skills')
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true })
    }
    return skillsDir
  },

  // 获取所有技能（带缓存）
  getAll() {
    const now = Date.now();
    if (_skillsCache && _skillsCacheTime && (now - _skillsCacheTime) < SKILLS_CACHE_TTL) {
      return _skillsCache;
    }
    _skillsCache = this.getAllFiles();
    _skillsCacheTime = now;
    return _skillsCache;
  },

  // 使缓存失效
  invalidateCache() {
    _skillsCache = null;
    _skillsCacheTime = null;
  },

  // 从文件系统加载所有技能（目录式）
  getAllFiles() {
    const skillsDir = this._ensureSkillsDir()

    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      const skills = []

      for (const entry of entries) {
        // 忽略非目录、.skills_store_lock.json 等
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue

        // 检查子目录内是否包含 SKILL.md
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        const skill = this.loadFromDir(entry.name)
        if (skill) {
          skills.push(skill)
        }
      }


      // 按技能名称字母顺序排序
      skills.sort((a, b) => {
        const nameA = a.name.toLowerCase()
        const nameB = b.name.toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
      })
      console.log(`[DB Skills] 从目录加载了 ${skills.length} 个技能`)
      return skills
    } catch (e) {
      console.error('[DB Skills] 加载技能目录列表失败:', e.message)
      return []
    }
  },

  // 从目录加载技能（读取 SKILL.md）
  loadFromDir(dirName) {
    if (!dirName) return null

    const skillsDir = this._ensureSkillsDir()
    const skillMdPath = path.join(skillsDir, dirName, 'SKILL.md')

    try {
      if (!fs.existsSync(skillMdPath)) {
        console.warn(`[DB Skills] 技能文件不存在: ${skillMdPath}`)
        return null
      }

      const fileContent = fs.readFileSync(skillMdPath, 'utf-8')

      // 解析 YAML frontmatter（支持嵌套 Schema 字段）
      const { parseFrontmatter, validateSchema } = require('./skill-schema')
      const { meta, content: parsedContent } = parseFrontmatter(fileContent)

      let name = meta.name || ''
      let description = meta.description || ''
      let autoExecute = meta.autoExecute === true || meta.autoExecute === 'true'
      let content = parsedContent

      // Schema 扩展字段
      const version = meta.version || null
      const triggers = Array.isArray(meta.triggers) ? meta.triggers : null
      const inputs = (meta.inputs && typeof meta.inputs === 'object') ? meta.inputs : null
      const sideEffects = Array.isArray(meta.sideEffects) ? meta.sideEffects : null
      const dangerous = meta.dangerous === true || meta.dangerous === 'true'
      const rollback = meta.rollback || null
      const onError = meta.onError || null
      const enabled = meta.enabled !== false  // 默认启用，仅显式设为 false 才禁用
      const priority = typeof meta.priority === 'number' ? meta.priority : 0

      // Schema 验证（仅警告，不阻断加载）
      if (version || triggers || inputs) {
        const validation = validateSchema(meta)
        if (!validation.valid) {
          console.warn(`[DB Skills] Schema 验证警告 (${dirName}):`, validation.errors)
        }
      }

      // 如果没有 frontmatter，尝试从 # 标题 提取 name
      if (!name) {
        const titleMatch = content.match(/^#\s+(.+)$/m)
        if (titleMatch) {
          name = titleMatch[1].trim()
        } else {
          name = dirName // fallback 用目录名
        }
      }

      // 解析 steps 代码块（```steps ... ``` 格式的 JSON 数组）
      let steps = null
      const stepsMatch = content.match(/```steps\s*\n([\s\S]*?)```/)
      if (stepsMatch) {
        try {
          steps = JSON.parse(stepsMatch[1].trim())
        } catch (e) {
          console.error(`[DB Skills] 解析 steps 代码块失败:`, e.message)
        }
      }

      // 检测技能目录下是否有关联的脚本文件
      let scriptFile = null
      const dirPath = path.join(skillsDir, dirName)
      const scriptExts = ['.py', '.js', '.sh', '.rb']

      // 优先检测根目录下的 script.* 文件
      for (const ext of scriptExts) {
        const candidate = path.join(dirPath, `script${ext}`)
        if (fs.existsSync(candidate)) {
          scriptFile = candidate
          break
        }
      }

      // 如果根目录没有 script.*，检测 scripts/ 子目录下的主入口脚本
      if (!scriptFile) {
        const scriptsSubDir = path.join(dirPath, 'scripts')
        if (fs.existsSync(scriptsSubDir) && fs.statSync(scriptsSubDir).isDirectory()) {
          // 按优先级查找主入口脚本：先找与技能同名的，再找通用名称
          const mainScriptCandidates = [
            `${dirName.replace(/-/g, '_')}.py`,  // wap-platform → wap_platform.py
            `${dirName}.py`,
            'main.py', 'main.js', 'main.sh',
            'index.js', 'index.py',
          ]
          // 也查找 *_client.py 等常见命名
          try {
            const scriptFiles = fs.readdirSync(scriptsSubDir)
            const clientScript = scriptFiles.find(f => f.endsWith('_client.py') || f.endsWith('_cli.py'))
            if (clientScript) mainScriptCandidates.unshift(clientScript)
          } catch (_) { /* ignore */ }

          for (const candidate of mainScriptCandidates) {
            const candidatePath = path.join(scriptsSubDir, candidate)
            if (fs.existsSync(candidatePath)) {
              scriptFile = candidatePath
              break
            }
          }
        }
      }

      // 有关联脚本但 SKILL.md 中未内嵌代码块时，自动读取脚本注入到 content
      // 这样 SKILL.md 只需保留描述信息，脚本实体单独维护在 script.* 文件中
      if (scriptFile) {
        const hasCodeBlock = /```(node|python|sh|bash|ruby|js)\s*\n/.test(content)
        if (!hasCodeBlock) {
          const scriptExt = path.extname(scriptFile).slice(1)
          const langMap = { js: 'node', py: 'python', sh: 'bash', rb: 'ruby' }
          const lang = langMap[scriptExt] || scriptExt
          const scriptBody = fs.readFileSync(scriptFile, 'utf-8')
          content += `\n\n\`\`\`${lang}\n${scriptBody}\n\`\`\``
        }
      }

      // 扫描 references/ 子目录，收集参考文档路径（内容在激活时按需加载）
      let references = []
      const refsDir = path.join(dirPath, 'references')
      if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
        try {
          const refFiles = fs.readdirSync(refsDir).filter(f => !f.startsWith('.'))
          references = refFiles.map(f => ({
            name: f,
            path: path.join(refsDir, f)
          }))
        } catch (_) { /* ignore */ }
      }

      // 技能根目录路径（用于 SKILL_FILE_PATH 和 cd 操作）
      const skillDir = dirPath

      // 依赖技能声明（frontmatter depends 字段，数组形式）
      const depends = Array.isArray(meta.depends) ? meta.depends : null

      const skill = {
        id: dirName,
        name,
        description,
        content,
        source: 'file',
        autoExecute,
        steps,
        scriptFile,
        skillDir,
        references,
        depends,
        // Schema 扩展字段
        version,
        triggers,
        inputs,
        sideEffects,
        dangerous,
        rollback,
        onError,
        // 生命周期字段
        enabled,
        priority
      }

      return skill
    } catch (e) {
      console.error(`[DB Skills] 加载技能目录失败: ${dirName}`, e.message)
      return null
    }
  },

  // 兼容旧调用，filename 视为目录名
  loadFromFile(filename) {
    const dirName = filename.replace('.md', '')
    return this.loadFromDir(dirName)
  },

  // 新增技能（写入目录式 SKILL.md）
  add(item) {
    const id = item.name // 用技能名做目录名
    const skill = {
      id,
      name: item.name,
      description: item.description || '',
      content: item.content || '',
      source: 'file',
      created_at: new Date().toISOString()
    }

    this.saveToDir(skill)
    this.invalidateCache()
    console.log(`[DB Skills] 新增技能: ${skill.name}`)
    return skill
  },

  // 更新技能（重写目录式 SKILL.md）
  update(id, item) {
    console.log('[DB Skills] 更新技能, ID:', id, '数据:', item)

    // 加载现有技能
    const existingSkill = this.loadFromDir(id)
    if (!existingSkill) {
      console.error('[DB Skills] 未找到技能目录, ID:', id)
      return null
    }

    // 合并更新字段
    const updated = {
      id,
      name: item.name !== undefined ? item.name : existingSkill.name,
      description: item.description !== undefined ? item.description : existingSkill.description,
      content: item.content !== undefined ? item.content : existingSkill.content,
      source: 'file',
      updated_at: new Date().toISOString()
    }

    // 保留原有的脚本文件引用
    if (existingSkill.scriptFile) {
      updated.scriptFile = existingSkill.scriptFile;
    }

    this.saveToDir(updated)
    this.invalidateCache()
    console.log('[DB Skills] 更新完成:', updated.name)
    return updated
  },

  // 删除技能（删除整个目录）
  delete(id) {
    const skillsDir = this._ensureSkillsDir()
    const dirPath = path.join(skillsDir, id)

    if (!fs.existsSync(dirPath)) {
      console.warn('[DB Skills] 未找到要删除的技能目录, ID:', id)
      return false
    }

    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      this.invalidateCache()
      console.log('[DB Skills] 已删除技能目录:', id)
      return true
    } catch (e) {
      console.error('[DB Skills] 删除技能目录失败:', e.message)
      return false
    }
  },

  // 启用/禁用技能（不删除，仅修改 frontmatter 的 enabled 字段）
  setEnabled(id, enabled) {
    const skillMdPath = path.join(this._ensureSkillsDir(), id, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) {
      return { success: false, error: '技能文件不存在' }
    }

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      // 检查是否有 frontmatter
      if (content.startsWith('---')) {
        const endIdx = content.indexOf('---', 3)
        if (endIdx !== -1) {
          let frontmatter = content.substring(3, endIdx)
          const body = content.substring(endIdx + 3)

          // 检查是否已有 enabled 字段
          if (/^enabled:/m.test(frontmatter)) {
            frontmatter = frontmatter.replace(/^enabled:.*$/m, `enabled: ${enabled}`)
          } else {
            frontmatter = frontmatter.trimEnd() + `\nenabled: ${enabled}\n`
          }

          fs.writeFileSync(skillMdPath, `---${frontmatter}---${body}`, 'utf-8')
        }
      } else {
        // 无 frontmatter，创建一个
        fs.writeFileSync(skillMdPath, `---\nenabled: ${enabled}\n---\n\n${content}`, 'utf-8')
      }

      this.invalidateCache()
      console.log(`[DB Skills] 技能 ${id} 已${enabled ? '启用' : '禁用'}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  },

  // 技能健康检查（基于使用统计评估技能状态）
  healthCheck(skillId) {
    try {
      const { getSkillStats } = require('./muse/skill-creator')
      const stats = getSkillStats(skillId)
      const issues = []

      if (stats.activations === 0) {
        return {
          status: 'idle',
          issues: ['该技能从未被激活'],
          stats,
        }
      }

      const successRate = stats.activations > 0 ? stats.successes / stats.activations : 0
      const failureRate = stats.activations > 0 ? stats.failures / stats.activations : 0

      if (failureRate > 0.5) {
        issues.push(`失败率过高: ${Math.round(failureRate * 100)}%（${stats.failures}/${stats.activations}）`)
      }

      if (successRate > 0.95 && stats.activations > 10) {
        return {
          status: 'healthy',
          issues: [],
          stats,
          message: '技能运行良好',
        }
      }

      return {
        status: issues.length > 0 ? 'warning' : 'ok',
        issues,
        stats,
      }
    } catch (e) {
      return { status: 'error', issues: [e.message], stats: null }
    }
  },

  // 获取所有技能的健康报告
  healthReport() {
    const skills = this.getAll()
    return skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      ...this.healthCheck(skill.id),
    }))
  },

  // 保存技能到目录（写入 SKILL.md）
  saveToDir(skill) {
    try {
      const skillsDir = this._ensureSkillsDir()
      const dirPath = path.join(skillsDir, skill.id)

      // 创建目录（如不存在）
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      // 构建 SKILL.md 内容（带 YAML frontmatter）
      let markdown = '---\n'
      markdown += `name: ${skill.name}\n`
      markdown += `description: "${skill.description || ''}"\n`
      markdown += '---\n\n'
      markdown += skill.content || ''

      const filePath = path.join(dirPath, 'SKILL.md')
      fs.writeFileSync(filePath, markdown, 'utf-8')
      this.invalidateCache()
      console.log(`[DB Skills] 技能已保存到目录: ${filePath}`)
      return true
    } catch (e) {
      console.warn(`[DB Skills] 保存技能到目录失败: ${e.message}`)
      return false
    }
  }
}

module.exports = {
  History,
  Memories,
  MemorySummary,
  Ideas,
  Letters,
  Skills
}

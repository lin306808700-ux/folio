'use strict'

const fs = require('fs')
const path = require('path')
const { MUSE_HOME } = require('./config')

const LEARNING_MAPS_FILE = path.join(MUSE_HOME, 'learning-maps.json')
const NODE_STATUSES = new Set(['unexplored', 'learning', 'understood', 'verified'])

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value, maxLength = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function createLearningMapStore(filePath = LEARNING_MAPS_FILE) {
  function load() {
    try {
      if (!fs.existsSync(filePath)) return []
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.warn('[Muse] 加载学习图谱失败:', error.message)
      return []
    }
  }

  // 幂等播种：内置图谱按 id 判重，缺失才写入（用户删掉后不会复活）
  // 已存在的内置图谱做节点级正文回填：本地无正文且种子有正文才补，不覆盖用户已有内容与问答
  // deprecatedIds：被新版替代的旧内置图谱，仅移除内置 id，不碰用户自建
  function seedBuiltinMaps(seeds, deprecatedIds = []) {
    if (!Array.isArray(seeds) || seeds.length === 0) return
    let maps = load()
    const removed = maps.filter(map => deprecatedIds.includes(map.id) && map.builtIn)
    if (removed.length > 0) {
      maps = maps.filter(map => !removed.some(r => r.id === map.id))
      console.log(`[Muse] 已移除废弃内置图谱: ${removed.map(m => m.title).join('、')}`)
    }
    const missing = seeds.filter(seed => !maps.some(map => map.id === seed.id))
    let backfilled = 0
    for (const seed of seeds) {
      const map = maps.find(m => m.id === seed.id)
      if (!map || !Array.isArray(map.nodes)) continue
      const seedNodes = new Map(seed.nodes.map(n => [n.id, n]))
      for (const node of map.nodes) {
        const seedNode = seedNodes.get(node.id)
        if (seedNode && !(node.content && node.content.trim()) && seedNode.content) {
          node.content = seedNode.content
          backfilled += 1
        }
        seedNodes.delete(node.id)
      }
      // 种子新增的节点（下钻扩展过的结构更新）整体补入
      if (seedNodes.size > 0) {
        map.nodes.push(...seedNodes.values())
        backfilled += seedNodes.size
      }
    }
    if (missing.length === 0 && removed.length === 0 && backfilled === 0) return
    // 内置图谱排在用户图谱之后
    save([...maps, ...missing])
    if (missing.length > 0) {
      console.log(`[Muse] 已注入内置学习图谱: ${missing.map(m => m.title).join('、')}`)
    }
    if (backfilled > 0) {
      console.log(`[Muse] 内置图谱正文回填 ${backfilled} 个节点`)
    }
  }

  function save(maps) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporaryFile = `${filePath}.tmp`
    fs.writeFileSync(temporaryFile, JSON.stringify(maps, null, 2), 'utf8')
    fs.renameSync(temporaryFile, filePath)
  }

  function list() {
    return load().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  function get(mapId) {
    return load().find(map => map.id === mapId) || null
  }

  function create({ title, description = '' }) {
    const cleanTitle = cleanText(title, 120)
    if (!cleanTitle) throw new Error('学习主题不能为空')

    const now = new Date().toISOString()
    const rootId = makeId('learn_node')
    const map = {
      id: makeId('learn_map'),
      title: cleanTitle,
      description: cleanText(description, 500),
      currentNodeId: rootId,
      nodes: [{
        id: rootId,
        parentId: null,
        title: cleanTitle,
        status: 'learning',
        summary: '',
        evidence: '',
        nextStep: '',
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }
    const maps = load()
    maps.unshift(map)
    save(maps)
    return map
  }

  function addNode(mapId, { parentId, title, summary = '', status }) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    if (!map.nodes.some(node => node.id === parentId)) throw new Error('父节点不存在')

    const cleanTitle = cleanText(title, 120)
    if (!cleanTitle) throw new Error('知识点名称不能为空')
    const now = new Date().toISOString()
    const node = {
      id: makeId('learn_node'),
      parentId,
      title: cleanTitle,
      status: NODE_STATUSES.has(status) ? status : 'unexplored',
      summary: cleanText(summary),
      evidence: '',
      nextStep: '',
      createdAt: now,
      updatedAt: now,
    }
    map.nodes.push(node)
    map.updatedAt = now
    save(maps)
    return node
  }

  function updateNode(mapId, nodeId, updates) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    const node = map.nodes.find(item => item.id === nodeId)
    if (!node) throw new Error('知识节点不存在')

    if (updates.status !== undefined) {
      if (!NODE_STATUSES.has(updates.status)) throw new Error('无效的掌握状态')
      node.status = updates.status
    }
    if (updates.title !== undefined) {
      const title = cleanText(updates.title, 120)
      if (!title) throw new Error('知识点名称不能为空')
      node.title = title
    }
    if (updates.summary !== undefined) node.summary = cleanText(updates.summary)
    if (updates.evidence !== undefined) node.evidence = cleanText(updates.evidence)
    if (updates.nextStep !== undefined) node.nextStep = cleanText(updates.nextStep, 1000)
    // 「活的书」章节正文（markdown）：AI 生成或手写，长度放宽
    if (updates.content !== undefined) node.content = cleanText(updates.content, 80000)
    // 圈选提问沉淀的问答列表，只接受合法形状，上限 30 条
    if (updates.qa !== undefined) {
      node.qa = (Array.isArray(updates.qa) ? updates.qa : [])
        .filter(item => item && typeof item.question === 'string' && typeof item.answer === 'string')
        .slice(0, 30)
        .map(item => ({
          question: cleanText(item.question, 2000),
          selection: cleanText(item.selection, 2000),
          answer: cleanText(item.answer, 40000),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }))
    }
    // 章节验收答题记录，只接受合法形状，上限 10 次
    if (updates.quiz !== undefined) {
      node.quiz = (Array.isArray(updates.quiz) ? updates.quiz : [])
        .filter(item => item && Array.isArray(item.items) && item.items.length > 0)
        .slice(0, 10)
        .map(item => ({
          items: item.items.slice(0, 10).map(q => ({
            question: cleanText(q.question, 2000),
            answer: cleanText(q.answer, 2000),
            pass: Boolean(q.pass),
            comment: cleanText(q.comment, 500),
          })),
          guidance: (Array.isArray(item.guidance) ? item.guidance : [])
            .filter(g => g && typeof g.nodeTitle === 'string')
            .slice(0, 5)
            .map(g => ({ nodeTitle: cleanText(g.nodeTitle, 120), reason: cleanText(g.reason, 300) })),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }))
    }

    const now = new Date().toISOString()
    node.updatedAt = now
    map.updatedAt = now
    save(maps)
    return node
  }

  function setCurrent(mapId, nodeId) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    if (!map.nodes.some(node => node.id === nodeId)) throw new Error('知识节点不存在')

    map.currentNodeId = nodeId
    map.updatedAt = new Date().toISOString()
    save(maps)
    return map
  }

  return { list, get, create, addNode, updateNode, setCurrent, seedBuiltinMaps }
}

const defaultStore = createLearningMapStore()
// 应用启动即注入内置知识图谱（前端/服务端），提供「看书学」的开箱路径
try {
  const { BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS } = require('./learning-seeds')
  defaultStore.seedBuiltinMaps(BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS)
} catch (error) {
  console.warn('[Muse] 内置学习图谱注入失败:', error.message)
}

module.exports = {
  LEARNING_MAPS_FILE,
  NODE_STATUSES,
  createLearningMapStore,
  store: defaultStore,
}

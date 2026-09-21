// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const fs = require('fs')
const path = require('path')
const { MUSE_HOME } = require('./config')

const LEARNING_MAPS_FILE = path.join(MUSE_HOME, 'learning-maps.json')
const NODE_STATUSES = new Set(['unexplored', 'learning', 'understood', 'verified'])
// 「已验证」的来源：手动标记 还是 章节验收通过
const VERIFY_SOURCES = new Set(['manual', 'quiz'])

const QA_LIMIT = 30
const QUIZ_LIMIT = 10
// 单个节点最多保留的连接边（前置/同类/门户），防止 AI 反复展开把节点撑爆
const EDGE_LIMIT = 20
// 一次批量插入的上限：领域骨架一次约 25-50 个节点
const BATCH_NODE_LIMIT = 120

// 节点来源：骨架由 AI 铺出（是领域的分母），其余是用户自己长出来的
const NODE_ORIGINS = new Set(['canon', 'user'])
// 树边之外的第二种边：parentId 只能表达「属于」，表达不了「相关」
const EDGE_TYPES = new Set(['prereq', 'peer', 'portal'])

// 掌握度权重：把四个离散状态折成可累加的分数
const STATUS_WEIGHT = { unexplored: 0, learning: 0.35, understood: 0.7, verified: 1 }
// 记忆衰减：半衰期 60 天，最多打五折。不衰减的色块是骗人的。
const DECAY_HALF_LIFE_DAYS = 60
const DECAY_FLOOR = 0.5
// 有效分数低于权重的 85% 即视为「该复习了」
const STALE_RATIO = 0.85

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value, maxLength = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeEdge(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = EDGE_TYPES.has(raw.type) ? raw.type : ''
  if (!type) return null
  const edge = {
    type,
    targetNodeId: cleanText(raw.targetNodeId, 120),
    targetMapId: cleanText(raw.targetMapId, 120),
    targetTitle: cleanText(raw.targetTitle, 120),
    note: cleanText(raw.note, 300),
  }
  // 门户的目标图谱可能还没建，所以只要有标题也算合法目标
  if (!edge.targetNodeId && !edge.targetMapId && !edge.targetTitle) return null
  return edge
}

function edgeTargetKey(edge) {
  return edge.targetNodeId || edge.targetMapId || edge.targetTitle
}

function normalizeEdges(list) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const edge = normalizeEdge(raw)
    if (!edge) continue
    const key = `${edge.type}:${edgeTargetKey(edge)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
    if (out.length >= EDGE_LIMIT) break
  }
  return out
}

// 老数据没有 origin / edges / lastReviewedAt，读取时就地补默认值：
// 不做破坏性迁移，下次写入自然落盘。
function normalizeNode(node) {
  if (!node || typeof node !== 'object') return node
  if (!NODE_ORIGINS.has(node.origin)) node.origin = 'user'
  if (!Array.isArray(node.edges)) node.edges = []
  else if (node.edges.length > 0) node.edges = normalizeEdges(node.edges)
  if (typeof node.lastReviewedAt !== 'string') node.lastReviewedAt = ''
  return node
}

function normalizeMap(map) {
  if (!map || typeof map !== 'object') return map
  const canon = map.canon && typeof map.canon === 'object' ? map.canon : {}
  map.canon = {
    generatedAt: cleanText(canon.generatedAt, 40),
    scaleEstimate: Number.isFinite(canon.scaleEstimate) ? canon.scaleEstimate : 0,
    source: cleanText(canon.source, 40),
  }
  if (Array.isArray(map.nodes)) map.nodes.forEach(normalizeNode)
  return map
}

// 衰减系数：无复习记录不衰减（历史数据不被凭空打折）
function decayFactor(lastReviewedAt, nowMs) {
  if (!lastReviewedAt) return 1
  const reviewed = Date.parse(lastReviewedAt)
  if (!Number.isFinite(reviewed)) return 1
  const days = (nowMs - reviewed) / 86400000
  if (days <= 0) return 1
  return Math.max(DECAY_FLOOR, Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS))
}

function scoreNode(node, nowMs) {
  const weight = STATUS_WEIGHT[node.status] || 0
  if (weight === 0) return { weight: 0, decay: 1, score: 0, stale: false }
  const decay = decayFactor(node.lastReviewedAt, nowMs)
  const score = weight * decay
  return { weight, decay, score, stale: score < weight * STALE_RATIO }
}

/**
 * 派生的双指标进度。
 * 覆盖度回答「这领域有多大、我走到哪」；掌握度回答「我真的会了多少」。
 * 两者的差值就是「看过但没吃透」的量。
 * 分母优先生效的骨架节点（外部事实）；没有骨架的老图谱退化为已建节点数。
 */
function computeProgress(map, nowMs = Date.now()) {
  const nodes = Array.isArray(map && map.nodes) ? map.nodes : []
  const canonNodes = nodes.filter(node => node.origin === 'canon')
  const basedOn = canonNodes.length > 0 ? 'canon' : 'graph'
  const scope = basedOn === 'canon' ? canonNodes : nodes
  const denominator = scope.length

  const byStatus = { unexplored: 0, learning: 0, understood: 0, verified: 0 }
  let entered = 0
  let stale = 0
  let scoreSum = 0
  for (const node of scope) {
    const status = byStatus[node.status] === undefined ? 'unexplored' : node.status
    byStatus[status] += 1
    // 「进入过」只认状态：后台预生成会给未学习节点写正文，用正文判定会让覆盖度虚高
    if (status !== 'unexplored') entered += 1
    const scored = scoreNode(node, nowMs)
    scoreSum += scored.score
    if (scored.stale) stale += 1
  }

  const safe = denominator || 1
  const coverage = denominator ? entered / safe : 0
  const mastery = denominator ? scoreSum / safe : 0
  return {
    basedOn,
    denominator,
    entered,
    byStatus,
    coverage,
    mastery,
    // 看过但没吃透：进入过却没拿到相应分数的量
    gap: Math.max(0, coverage - mastery),
    stale,
  }
}

// 沉淀型记录（问答/验收）统一「保留最新 N 条」：先按 createdAt 倒序再截断，
// 这样调用方无论前插还是追加，被截掉的永远是更旧的那条。
function normalizeRecords(list, limit, mapItem) {
  return (Array.isArray(list) ? list : [])
    .map(mapItem)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit)
}

function createLearningMapStore(filePath = LEARNING_MAPS_FILE) {
  // 读写缓存：正文单节点上限 8 万字符，整本书可达 MB 级，
  // 而 list/get/updateNode 在交互里被高频调用，不能每次都全量 parse。
  let _cache = null
  let _cacheStamp = null

  function fileStamp() {
    try {
      const stat = fs.statSync(filePath)
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return 'missing'
    }
  }

  function load() {
    const stamp = fileStamp()
    if (_cache && _cacheStamp === stamp) return _cache
    let parsed = []
    try {
      if (stamp !== 'missing') {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (Array.isArray(content)) parsed = content
      }
    } catch (error) {
      console.warn('[Muse] 加载学习图谱失败:', error.message)
      parsed = []
    }
    parsed.forEach(normalizeMap)
    _cache = parsed
    _cacheStamp = stamp
    return _cache
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
    // 自己写的直接进缓存，省掉一次全量 parse
    _cache = maps
    _cacheStamp = fileStamp()
  }

  function list() {
    return [...load()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  }

  // 元数据视图：批量场景（知识树/导图/看板/预生成队列）不需要章节正文，
  // 正文按需用 getNode 单取，避免每次交互都把整本书塞进 IPC。
  // 同时附带派生进度：覆盖度与掌握度的计算口径只在主进程实现一份，渲染层不重复算。
  function listMeta() {
    const nowMs = Date.now()
    return list().map(map => ({
      ...map,
      canon: map.canon,
      progress: computeProgress(map, nowMs),
      nodes: (map.nodes || []).map(node => {
        const scored = scoreNode(node, nowMs)
        return {
          id: node.id,
          parentId: node.parentId,
          title: node.title,
          status: node.status,
          origin: node.origin,
          edges: node.edges || [],
          masteryScore: Number(scored.score.toFixed(3)),
          // 衰减到该复习了：热力色块据此变浅
          stale: scored.stale,
          summary: node.summary || '',
          nextStep: node.nextStep || '',
          hasContent: Boolean(node.content && node.content.trim()),
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
        }
      }),
    }))
  }

  function get(mapId) {
    return load().find(map => map.id === mapId) || null
  }

  function getNode(mapId, nodeId) {
    const map = get(mapId)
    if (!map) throw new Error('学习图谱不存在')
    const node = map.nodes.find(item => item.id === nodeId)
    if (!node) throw new Error('知识节点不存在')
    return node
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
      // 骨架留空：等 AI 铺出领域清单后才有分母
      canon: { generatedAt: '', scaleEstimate: 0, source: '' },
      nodes: [{
        id: rootId,
        parentId: null,
        title: cleanTitle,
        status: 'learning',
        origin: 'user',
        edges: [],
        lastReviewedAt: now,
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

  function updateMap(mapId, updates = {}) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')

    if (updates.title !== undefined) {
      const title = cleanText(updates.title, 120)
      if (!title) throw new Error('学习主题不能为空')
      map.title = title
    }
    if (updates.description !== undefined) map.description = cleanText(updates.description, 500)
    map.updatedAt = new Date().toISOString()
    save(maps)
    return map
  }

  function deleteMap(mapId) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    save(maps.filter(item => item.id !== mapId))
    return { id: mapId, title: map.title, removedNodes: (map.nodes || []).length }
  }

  function addNode(mapId, { parentId, title, summary = '', status, origin }) {
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
      origin: NODE_ORIGINS.has(origin) ? origin : 'user',
      edges: [],
      lastReviewedAt: '',
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

  // 批量插入：领域骨架一次几十个节点，逐个走 IPC 会把通道打爆
  function addNodes(mapId, items) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')

    const list = (Array.isArray(items) ? items : []).slice(0, BATCH_NODE_LIMIT)
    const now = new Date().toISOString()
    const created = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (!map.nodes.some(node => node.id === item.parentId)) continue
      const title = cleanText(item.title, 120)
      if (!title) continue
      const node = {
        id: makeId('learn_node'),
        parentId: item.parentId,
        title,
        status: NODE_STATUSES.has(item.status) ? item.status : 'unexplored',
        origin: NODE_ORIGINS.has(item.origin) ? item.origin : 'user',
        edges: [],
        lastReviewedAt: '',
        summary: cleanText(item.summary),
        evidence: '',
        nextStep: '',
        createdAt: now,
        updatedAt: now,
      }
      map.nodes.push(node)
      created.push(node)
    }
    if (created.length === 0) throw new Error('没有可添加的知识点')
    map.updatedAt = now
    save(maps)
    return created
  }

  // 删除节点及其整棵子树；唯一根节点不允许直接删，提示改为删除整个图谱
  function deleteNode(mapId, nodeId) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    const target = map.nodes.find(item => item.id === nodeId)
    if (!target) throw new Error('知识节点不存在')

    if (!target.parentId && map.nodes.filter(node => !node.parentId).length <= 1) {
      throw new Error('这是图谱的根节点，请直接删除整个图谱')
    }

    const doomed = new Set([nodeId])
    let grew = true
    while (grew) {
      grew = false
      for (const node of map.nodes) {
        if (!doomed.has(node.id) && node.parentId && doomed.has(node.parentId)) {
          doomed.add(node.id)
          grew = true
        }
      }
    }

    map.nodes = map.nodes.filter(node => !doomed.has(node.id))
    // 顺手剪掉指向已删节点的边，避免留下悬空连接
    for (const node of map.nodes) {
      if (!Array.isArray(node.edges) || node.edges.length === 0) continue
      const kept = node.edges.filter(edge => !doomed.has(edge.targetNodeId))
      if (kept.length !== node.edges.length) node.edges = kept
    }
    // 当前位置被删掉时回退到父节点，再兜底到第一个根节点
    if (doomed.has(map.currentNodeId)) {
      const parentAlive = target.parentId && map.nodes.some(node => node.id === target.parentId)
      const fallback = parentAlive ? target.parentId : (map.nodes.find(node => !node.parentId) || map.nodes[0] || {}).id
      map.currentNodeId = fallback
    }
    map.updatedAt = new Date().toISOString()
    save(maps)
    return { map, removed: [...doomed] }
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
      // 离开「已验证」时清掉来源标记，避免留下过期归因
      node.verifiedBy = updates.status === 'verified'
        ? (VERIFY_SOURCES.has(updates.verifiedBy) ? updates.verifiedBy : (node.verifiedBy || 'manual'))
        : ''
      // 状态变更即一次复习事件，重置衰减计时
      node.lastReviewedAt = new Date().toISOString()
    }
    if (updates.origin !== undefined && NODE_ORIGINS.has(updates.origin)) node.origin = updates.origin
    if (updates.edges !== undefined) node.edges = normalizeEdges(updates.edges)
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
    // 圈选提问沉淀的问答列表，只接受合法形状，保留最新 30 条
    if (updates.qa !== undefined) {
      node.qa = normalizeRecords(updates.qa, QA_LIMIT, item => {
        if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') return null
        return {
          question: cleanText(item.question, 2000),
          selection: cleanText(item.selection, 2000),
          answer: cleanText(item.answer, 40000),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }
      })
    }
    // 章节验收答题记录，只接受合法形状，保留最新 10 次
    if (updates.quiz !== undefined) {
      node.quiz = normalizeRecords(updates.quiz, QUIZ_LIMIT, item => {
        if (!item || !Array.isArray(item.items) || item.items.length === 0) return null
        return {
          items: item.items.slice(0, 10).map(q => ({
            question: cleanText(q.question, 2000),
            answer: cleanText(q.answer, 2000),
            pass: Boolean(q.pass),
            comment: cleanText(q.comment, 500),
          })),
          guidance: (Array.isArray(item.guidance) ? item.guidance : [])
            .filter(g => g && typeof g.nodeTitle === 'string')
            .slice(0, 5)
            .map(g => ({
              nodeId: cleanText(g.nodeId, 120),
              nodeTitle: cleanText(g.nodeTitle, 120),
              reason: cleanText(g.reason, 300),
            })),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }
      })
      // 交一次验收也是一次复习事件
      node.lastReviewedAt = new Date().toISOString()
    }

    const now = new Date().toISOString()
    node.updatedAt = now
    map.updatedAt = now
    save(maps)
    return node
  }

  // 第 2 层：树边之外的连接边。跨域门户不新建图谱，只在当前节点上记一条边，
  // 这样「领域的墙」可以在不污染当前图谱结构的前提下被标注出来。
  function addEdge(mapId, nodeId, rawEdge) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    const node = map.nodes.find(item => item.id === nodeId)
    if (!node) throw new Error('知识节点不存在')

    const edge = normalizeEdge(rawEdge)
    if (!edge) throw new Error('无效的连接类型或目标')
    node.edges = normalizeEdges([...(node.edges || []), edge])

    const now = new Date().toISOString()
    node.updatedAt = now
    map.updatedAt = now
    save(maps)
    return node
  }

  // target 给 type 即清空该类型全部边；给目标标识则只删那一条
  function removeEdge(mapId, nodeId, target = {}) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')
    const node = map.nodes.find(item => item.id === nodeId)
    if (!node) throw new Error('知识节点不存在')

    const type = EDGE_TYPES.has(target.type) ? target.type : ''
    const key = cleanText(target.targetNodeId, 120) || cleanText(target.targetMapId, 120) || cleanText(target.targetTitle, 120)
    const before = (node.edges || []).length
    node.edges = (node.edges || []).filter(edge => {
      if (type && edge.type !== type) return true
      if (key && edgeTargetKey(edge) !== key) return true
      return false
    })
    if (node.edges.length === before) return node

    const now = new Date().toISOString()
    node.updatedAt = now
    map.updatedAt = now
    save(maps)
    return node
  }

  // 骨架生成记录：给这张图谱一个分母
  function setCanon(mapId, canon = {}) {
    const maps = load()
    const map = maps.find(item => item.id === mapId)
    if (!map) throw new Error('学习图谱不存在')

    const now = new Date().toISOString()
    map.canon = {
      generatedAt: now,
      scaleEstimate: Number.isFinite(canon.scaleEstimate) ? Math.round(canon.scaleEstimate) : 0,
      source: cleanText(canon.source, 40) || 'ai',
    }
    map.updatedAt = now
    save(maps)
    return map.canon
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

  return {
    list,
    listMeta,
    get,
    getNode,
    create,
    updateMap,
    deleteMap,
    addNode,
    deleteNode,
    updateNode,
    addNodes,
    addEdge,
    removeEdge,
    setCanon,
    setCurrent,
    seedBuiltinMaps,
  }
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
  NODE_ORIGINS,
  EDGE_TYPES,
  STATUS_WEIGHT,
  QA_LIMIT,
  QUIZ_LIMIT,
  EDGE_LIMIT,
  BATCH_NODE_LIMIT,
  computeProgress,
  scoreNode,
  createLearningMapStore,
  store: defaultStore,
}

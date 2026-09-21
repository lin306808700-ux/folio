#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 合成内置示例图谱「AI Agent 实现原理（三个月完全体）」→ src/main/muse/builtin-learning-maps.demo.json
//
// 用法：node scripts/generate-builtin-3month-demo.js
//
// 数据来源三处：
//   1. 现有 demo json —— 复用第一批 17 个节点的正文，不重写已有内容
//   2. scripts/builtin-agent-3month/outline.js  —— 节点树、状态、时间线、连接边
//   3. scripts/builtin-agent-3month/chapters.md —— 新增章节正文
//      scripts/builtin-agent-3month/dialogue.js —— 圈选问答与验收记录
//
// 时间是相对的（createdDaysAgo / reviewedDaysAgo），由 learning-seeds.js 在注入时物化：
// 否则一份展示「衰减与复习提醒」的示例图谱会随着日历腐烂。
//
// 脚本可重复执行：复用来源包含自己产出的文件，重跑结果一致。

const fs = require('fs')
const path = require('path')

const { MAP, USER_TRUNK, CANON, USER_ADDED, EDGES } = require('./builtin-agent-3month/outline')
const { QA, QUIZ } = require('./builtin-agent-3month/dialogue')

const TARGET = path.join(__dirname, '../src/main/muse/builtin-learning-maps.demo.json')
const CHAPTER_FILE = path.join(__dirname, 'builtin-agent-3month/chapters.md')

// 章节正文放在 markdown 数据文件里，而不是 JS 模板字符串：
// 正文本身含大量代码围栏，写在模板字符串里需要转义反引号，维护成本高。
// 格式：<!-- node: 节点id --> 后紧跟该节点正文，直到下一个标记。
function loadChapters() {
  const parts = fs.readFileSync(CHAPTER_FILE, 'utf8').split(/^<!-- node: ([a-z0-9_]+) -->$/m)
  const chapters = new Map()
  for (let i = 1; i < parts.length; i += 2) chapters.set(parts[i], parts[i + 1].trim())
  return chapters
}

const CHAPTERS = loadChapters()

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function loadLegacyNodes() {
  const raw = JSON.parse(fs.readFileSync(TARGET, 'utf8'))
  const map = Array.isArray(raw) ? raw[0] : raw
  if (!map || !Array.isArray(map.nodes)) fail('现有 demo json 结构异常，无法复用正文')
  return new Map(map.nodes.map(node => [node.id, node]))
}

const legacy = loadLegacyNodes()

// 第一批节点的身份：正文与摘要都从现有文件继承，只替换状态与时间线
const LEGACY_IDS = new Set(USER_TRUNK.map(item => item.id))

const declared = [
  ...USER_TRUNK.map(item => ({ ...item, origin: 'user' })),
  ...CANON.map(item => ({ ...item, origin: 'canon' })),
  ...USER_ADDED.map(item => ({ ...item, origin: 'user' })),
]
const byId = new Map(declared.map(item => [item.id, item]))

// —— 校验：引用真实 ——
for (const item of declared) {
  if (item.parentId && !byId.has(item.parentId)) fail(`节点 ${item.id} 的父节点 ${item.parentId} 不存在`)
}
if (!LEGACY_IDS.has('agent_root')) fail('根节点必须在第一批里')
for (const id of LEGACY_IDS) {
  if (!legacy.has(id)) fail(`现有 demo json 缺少复用节点 ${id}`)
}
for (const id of CHAPTERS.keys()) {
  if (!byId.has(id)) fail(`章节 ${id} 在节点大纲里找不到`)
}
for (const id of CHAPTERS.keys()) {
  if (LEGACY_IDS.has(id)) fail(`章节 ${id} 属于第一批节点，正文应复用现有文件而不是手写`)
}

// —— 组装节点 ——
const edgesByNode = new Map()
for (const edge of EDGES) {
  if (!byId.has(edge.nodeId)) fail(`连接边的起点 ${edge.nodeId} 不存在`)
  if (edge.targetNodeId && !byId.has(edge.targetNodeId)) fail(`连接边的终点 ${edge.targetNodeId} 不存在`)
  if (!edge.targetNodeId && !edge.targetTitle) fail(`连接边 ${edge.nodeId} 缺少目标`)
  edgesByNode.set(edge.nodeId, [...(edgesByNode.get(edge.nodeId) || []), {
    type: edge.type,
    targetNodeId: edge.targetNodeId || '',
    targetMapId: '',
    targetTitle: edge.targetTitle || '',
    note: edge.note || '',
  }])
}

const nodes = declared.map(item => {
  // daysAgo 越小越新：排序后最新一条在前
  const byRecency = (a, b) => (a.daysAgo || 0) - (b.daysAgo || 0)
  const meta = LEGACY_IDS.has(item.id) ? legacy.get(item.id) : null
  const content = meta ? (meta.content || '') : (CHAPTERS.get(item.id) || '')
  const node = {
    id: item.id,
    parentId: item.parentId || null,
    title: item.title || (meta && meta.title) || '',
    status: item.status,
    origin: item.origin,
    createdDaysAgo: item.created,
    summary: item.summary || (meta && meta.summary) || '',
    nextStep: item.nextStep || (meta && meta.nextStep) || '',
    evidence: item.evidence || '',
    content,
    edges: edgesByNode.get(item.id) || [],
    // 沉淀型记录统一「最新在前」落盘，与 store 的 normalizeRecords 约定一致
    qa: [...(QA[item.id] || [])].sort(byRecency),
    quiz: [...(QUIZ[item.id] || [])].sort(byRecency),
  }
  if (!node.title) fail(`节点 ${item.id} 没有标题`)
  // 已进入过的骨架节点必须有正文，否则「读了但没内容」会自相矛盾
  if (node.origin === 'canon' && node.status !== 'unexplored' && !content.trim()) {
    fail(`骨架节点 ${item.id} 状态为 ${node.status} 却没有正文`)
  }
  if (node.status === 'verified') node.verifiedBy = item.verifiedBy || 'manual'
  if (node.status !== 'unexplored') node.reviewedDaysAgo = item.reviewed
  if (node.status !== 'unexplored' && item.reviewed === undefined) {
    fail(`节点 ${item.id} 已进入过却没有复习时间，无法计算衰减`)
  }
  return node
})

// —— 校验：圈选提问引用的原句必须真的在正文里 ——
for (const [nodeId, list] of Object.entries(QA)) {
  const node = nodes.find(item => item.id === nodeId)
  if (!node) fail(`问答挂在了不存在的节点 ${nodeId}`)
  for (const item of list) {
    if (item.selection && !node.content.includes(item.selection)) {
      fail(`${nodeId} 的圈选原句在正文里找不到：「${item.selection}」`)
    }
  }
}
for (const nodeId of Object.keys(QUIZ)) {
  if (!byId.has(nodeId)) fail(`验收记录挂在了不存在的节点 ${nodeId}`)
}

const map = {
  id: MAP.id,
  title: MAP.title,
  description: MAP.description,
  builtIn: true,
  currentNodeId: MAP.currentNodeId,
  canon: MAP.canon,
  createdDaysAgo: MAP.createdDaysAgo,
  updatedDaysAgo: MAP.updatedDaysAgo,
  nodes,
}

fs.writeFileSync(TARGET, `${JSON.stringify([map], null, 2)}\n`, 'utf8')

// —— 打印结构统计，便于人工核对 ——
const canonNodes = nodes.filter(node => node.origin === 'canon')
const enteredCanon = canonNodes.filter(node => node.status !== 'unexplored')
const withContent = nodes.filter(node => node.content.trim())
const qaCount = nodes.reduce((sum, node) => sum + node.qa.length, 0)
const quizCount = nodes.reduce((sum, node) => sum + node.quiz.length, 0)
const edgeCount = nodes.reduce((sum, node) => sum + node.edges.length, 0)

console.log(`已写入 ${path.relative(process.cwd(), TARGET)}`)
console.log(`  节点 ${nodes.length} 个：骨架 ${canonNodes.length} / 用户自建 ${nodes.length - canonNodes.length - 1} / 根 1`)
console.log(`  分母（骨架）${canonNodes.length}，其中进入过 ${enteredCanon.length} → 覆盖度约 ${(enteredCanon.length / canonNodes.length * 100).toFixed(1)}%`)
console.log(`  含正文 ${withContent.length} 章，连接边 ${edgeCount} 条，圈选问答 ${qaCount} 条，验收 ${quizCount} 次`)
console.log(`  文件大小 ${(fs.statSync(TARGET).size / 1024).toFixed(1)} KB`)

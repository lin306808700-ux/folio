#!/usr/bin/env node
'use strict'

// 从本地 ~/.folio/muse/learning-maps.json 导出已生成的内置图谱正文，
// 固化到 src/main/muse/builtin-learning-maps.json，新用户开箱即带完整内容，无需预生成。
// 导出时重置学习状态与个人痕迹（qa/evidence/时间戳），只保留知识结构 + 正文。

const fs = require('fs')
const path = require('path')

const SOURCE = path.join(process.env.HOME, '.folio/muse/learning-maps.json')
const TARGET = path.join(__dirname, '../src/main/muse/builtin-learning-maps.json')
const BUILTIN_IDS = ['learn_map_builtin_fe', 'learn_map_builtin_java']

const maps = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const exported = []

for (const id of BUILTIN_IDS) {
  const map = maps.find(m => m.id === id)
  if (!map) throw new Error(`源数据缺少内置图谱: ${id}`)
  const nodes = map.nodes.map(n => ({
    id: n.id,
    parentId: n.parentId || null,
    title: n.title,
    status: n.parentId ? 'unexplored' : 'learning',
    summary: n.summary || '',
    nextStep: n.nextStep || '',
    content: (n.content || '').trim(),
  }))
  const missing = nodes.filter(n => !n.content)
  if (missing.length > 0) {
    throw new Error(`${map.title} 存在 ${missing.length} 个无正文节点: ${missing.map(n => n.title).join('、')}`)
  }
  exported.push({
    id: map.id,
    title: map.title,
    description: map.description || '',
    builtIn: true,
    currentNodeId: nodes.find(n => !n.parentId)?.id || nodes[0].id,
    nodes,
  })
  console.log(`导出 ${map.title}: ${nodes.length} 节点全部含正文`)
}

fs.writeFileSync(TARGET, JSON.stringify(exported), 'utf8')
const size = fs.statSync(TARGET).size
console.log(`已写入 ${TARGET} (${(size / 1024 / 1024).toFixed(2)} MB)`)

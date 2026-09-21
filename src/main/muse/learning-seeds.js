// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 内置学习图谱：开箱即带完整正文的知识体系，新用户无需预生成即可直接阅读。
// 此处加载时补齐运行时字段（时间戳/evidence）。
//
// 两个数据源，按优先级依次尝试：
//   1. builtin-learning-maps.json      —— 完整内容，由 scripts/export-builtin-maps.js 从真实生成结果导出。
//                                         不对外发布（见 .gitignore），仅作者本机存在。
//   2. builtin-learning-maps.demo.json —— 随仓库发布的演示图谱，保证克隆后开箱可读。
// 两者都不可用时降级为空种子，内容走预生成。
//
// 种子可以描述三层模型（骨架 origin=canon / 连接边 edges / 圈选问答 qa / 验收 quiz），
// 格式与 learning-maps.js 的节点结构一致，缺失字段由 store 侧 normalizeNode 补默认值。

const fs = require('fs')
const path = require('path')

const DAY_MS = 86400000
// 种子既没写相对时间也没写绝对时间时的兜底时刻
const BUILTIN_SEED_TIME = '2026-08-01T00:00:00.000Z'

/**
 * 种子里的时间可以写成「N 天前」而不是绝对时刻，注入时再物化成 ISO 时间。
 * 这样做的原因：衰减与「该复习了」只有相对今天才成立 —— 写死绝对时间的话，
 * 一份展示「连续自学三个月」的示例图谱会随日历一起腐烂，半年后每个节点都成了灰块。
 * @param {unknown} value 相对天数（数字）
 * @param {unknown} fallback 绝对时间字符串
 * @param {string} whenMissing 两者都没有时的取值（复习时间传 '' 表示「从未复习，不衰减」）
 */
function seedTime(value, fallback, whenMissing = BUILTIN_SEED_TIME) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return new Date(Date.now() - value * DAY_MS).toISOString()
  }
  if (typeof fallback === 'string' && fallback) return fallback
  return whenMissing
}

// 圈选问答：只保留形状合法的记录，时间戳同样支持相对天数
function normalizeSeedQA(list, fallbackTime) {
  return (Array.isArray(list) ? list : [])
    .map(item => {
      if (!item || typeof item.question !== 'string' || typeof item.answer !== 'string') return null
      return {
        question: item.question,
        selection: item.selection || '',
        answer: item.answer,
        createdAt: seedTime(item.daysAgo, item.createdAt, fallbackTime),
      }
    })
    .filter(Boolean)
}

// 章节验收：题目、判分与阅读引导
function normalizeSeedQuiz(list, fallbackTime) {
  return (Array.isArray(list) ? list : [])
    .map(item => {
      if (!item || !Array.isArray(item.items) || item.items.length === 0) return null
      return {
        items: item.items.map(q => ({
          question: q.question || '',
          answer: q.answer || '',
          pass: Boolean(q.pass),
          comment: q.comment || '',
        })),
        guidance: (Array.isArray(item.guidance) ? item.guidance : []).map(g => ({
          nodeId: g.nodeId || '',
          nodeTitle: g.nodeTitle || '',
          reason: g.reason || '',
        })),
        createdAt: seedTime(item.daysAgo, item.createdAt, fallbackTime),
      }
    })
    .filter(Boolean)
}

function normalizeSeedNode(raw) {
  const createdAt = seedTime(raw.createdDaysAgo, raw.createdAt)
  return {
    id: raw.id,
    parentId: raw.parentId || null,
    title: raw.title,
    status: raw.status || 'unexplored',
    // 「已验证」的归因：手动标记还是章节验收通过
    verifiedBy: raw.status === 'verified' ? (raw.verifiedBy || 'manual') : '',
    // 骨架节点是领域的分母，用户自建节点是个人探索的产物
    origin: raw.origin === 'canon' ? 'canon' : 'user',
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    // 状态变更/复习的时间点。种子没写就是「从未复习」—— 不衰减，
    // 不能拿播种时刻当复习时刻，否则老图谱一开箱就集体过期。
    lastReviewedAt: raw.status && raw.status !== 'unexplored'
      ? seedTime(raw.reviewedDaysAgo, raw.lastReviewedAt, '')
      : '',
    summary: raw.summary || '',
    evidence: raw.evidence || '',
    nextStep: raw.nextStep || '',
    content: raw.content || '',
    qa: normalizeSeedQA(raw.qa, createdAt),
    quiz: normalizeSeedQuiz(raw.quiz, createdAt),
    createdAt,
    updatedAt: seedTime(raw.updatedDaysAgo, raw.updatedAt || createdAt),
  }
}

function normalizeSeed(raw) {
  const createdAt = seedTime(raw.createdDaysAgo, raw.createdAt)
  const canon = raw.canon && typeof raw.canon === 'object' ? raw.canon : null
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description || '',
    builtIn: true,
    currentNodeId: raw.currentNodeId,
    // 骨架生成记录：有它才有分母，覆盖度才算得出来
    canon: canon
      ? {
        generatedAt: seedTime(canon.generatedDaysAgo, canon.generatedAt, ''),
        scaleEstimate: Number(canon.scaleEstimate) || 0,
        source: canon.source || 'ai',
      }
      : { generatedAt: '', scaleEstimate: 0, source: '' },
    nodes: (raw.nodes || []).map(normalizeSeedNode),
    createdAt,
    updatedAt: seedTime(raw.updatedDaysAgo, raw.updatedAt || createdAt),
  }
}

// 按优先级尝试两个数据源，返回第一个可用的非空图谱数组
function loadBuiltinData() {
  const candidates = ['builtin-learning-maps.json', 'builtin-learning-maps.demo.json']
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'))
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // 该数据源不存在或无法解析，继续尝试下一个
    }
  }
  // 两个数据源都不可用：降级为空种子，内容走预生成
  return []
}

const BUILTIN_MAPS = loadBuiltinData().map(normalizeSeed)

// 被新版替代的旧内置图谱，启动时移除（仅限内置 id，不碰用户自建）。
// learn_map_builtin_agent：只有 17 个节点、没有骨架与连接边的初版演示图谱，
// 已被带完整三个月学习痕迹的 learn_map_builtin_agent_v2 取代。
const DEPRECATED_BUILTIN_IDS = [
  'learn_map_builtin_backend',
  'learn_map_builtin_frontend',
  'learn_map_builtin_agent',
]

module.exports = { BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS, normalizeSeed }

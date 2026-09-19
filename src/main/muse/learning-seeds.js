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

const fs = require('fs')
const path = require('path')

const BUILTIN_SEED_TIME = '2026-08-01T00:00:00.000Z'

function normalizeSeed(raw) {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description || '',
    builtIn: true,
    currentNodeId: raw.currentNodeId,
    createdAt: BUILTIN_SEED_TIME,
    updatedAt: BUILTIN_SEED_TIME,
    nodes: raw.nodes.map(n => ({
      id: n.id,
      parentId: n.parentId || null,
      title: n.title,
      status: n.status || 'unexplored',
      summary: n.summary || '',
      evidence: '',
      nextStep: n.nextStep || '',
      content: n.content || '',
      createdAt: BUILTIN_SEED_TIME,
      updatedAt: BUILTIN_SEED_TIME,
    })),
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

// 被新版替代的旧内置图谱，启动时移除（仅限内置 id，不碰用户自建）
const DEPRECATED_BUILTIN_IDS = ['learn_map_builtin_backend', 'learn_map_builtin_frontend']

module.exports = { BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS }

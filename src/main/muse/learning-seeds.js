'use strict'

// 内置学习图谱：开箱即带完整正文的「前端」「Java 服务端」知识体系。
// 数据源 builtin-learning-maps.json 由 scripts/export-builtin-maps.js 从真实生成结果导出，
// 新用户无需预生成即可直接阅读；此处加载时补齐运行时字段（时间戳/evidence）。
// 注意：该数据文件不对外发布（见 .gitignore），缺失时降级为空种子，内容走预生成。

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

function loadBuiltinData() {
  const dataFile = path.join(__dirname, 'builtin-learning-maps.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // 数据文件不对外发布：克隆仓库无此文件时降级为空种子
    return []
  }
}

const BUILTIN_MAPS = loadBuiltinData().map(normalizeSeed)

// 被新版替代的旧内置图谱，启动时移除（仅限内置 id，不碰用户自建）
const DEPRECATED_BUILTIN_IDS = ['learn_map_builtin_backend', 'learn_map_builtin_frontend']

module.exports = { BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS }

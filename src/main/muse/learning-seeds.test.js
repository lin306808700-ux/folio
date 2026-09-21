// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 内置种子加载契约：三层模型字段不能被丢掉，相对时间必须物化，
// 且**绝不允许**给没有复习记录的节点凭空安上衰减起点。

const assert = require('assert')
const { BUILTIN_MAPS, DEPRECATED_BUILTIN_IDS, normalizeSeed } = require('./learning-seeds')

const DAY = 86400000

function daysBetween(iso, now) {
  return (now - Date.parse(iso)) / DAY
}

function run() {
  // —— 真实种子：三层模型必须完整带进来 ——
  assert.ok(BUILTIN_MAPS.length > 0, '内置图谱种子不应为空')
  const map = BUILTIN_MAPS[0]
  assert.ok(map.nodes.length > 20, '示例图谱应是一份完整形态的图谱')

  const canonNodes = map.nodes.filter(node => node.origin === 'canon')
  assert.ok(canonNodes.length > 0, '骨架节点（分母）必须存在')
  assert.ok(map.canon.generatedAt, '骨架生成时间必须存在，否则覆盖度没有基准')
  assert.equal(map.canon.source, 'ai')

  const withEdges = map.nodes.filter(node => node.edges.length > 0)
  assert.ok(withEdges.length >= 5, '连接边（同类/前置/门户）必须存在')
  const edgeTypes = new Set(withEdges.flatMap(node => node.edges.map(edge => edge.type)))
  assert.deepStrictEqual([...edgeTypes].sort(), ['peer', 'portal', 'prereq'])

  const withQa = map.nodes.filter(node => node.qa.length > 0)
  assert.ok(withQa.length >= 5, '圈选问答必须存在')
  assert.ok(withQa.every(node => node.qa.every(item => item.question && item.answer)))
  const withQuiz = map.nodes.filter(node => node.quiz.length > 0)
  assert.ok(withQuiz.length >= 2, '章节验收记录必须存在')
  assert.ok(withQuiz.some(node => node.quiz.some(record => record.items.some(item => !item.pass))), '应保留未通过的验收记录')

  // 已验证节点必须有归因，否则界面上会显示「未记录依据」
  assert.ok(map.nodes.filter(node => node.status === 'verified').every(node => node.verifiedBy))

  // —— 正文必须齐全：示例要在完全无法调用 AI 的环境下可用 ——
  // 缺一章就意味着用户点开是空页、或一个必然失败的生成按钮。
  const withoutContent = map.nodes.filter(node => !(node.content && node.content.trim()))
  assert.equal(
    withoutContent.length,
    0,
    `内置示例存在没有正文的节点：${withoutContent.map(node => node.id).join(', ')}`,
  )
  // 但正文与状态解耦：未探索节点同样可以有正文，这是后台预生成的正常产物，
  // 也正是「不能用正文判定覆盖度」这条口径存在的原因。
  assert.ok(
    map.nodes.some(node => node.status === 'unexplored' && node.content.trim()),
    '应存在「有正文但未探索」的节点，与 computeProgress 的口径保持一致',
  )

  // —— 相对时间：必须物化成「距今 N 天」的真实时刻 ——
  const now = Date.now()
  for (const node of map.nodes) {
    const age = daysBetween(node.createdAt, now)
    assert.ok(age >= 0 && age < 400, `节点 ${node.id} 的创建时间不在合理区间: ${node.createdAt}`)
  }
  const reviewed = map.nodes.filter(node => node.lastReviewedAt)
  assert.ok(reviewed.length > 0, '应有复习记录用于计算衰减')
  assert.ok(reviewed.every(node => daysBetween(node.lastReviewedAt, now) >= 0), '复习时间不应出现在未来')

  // 未进入过的节点不带复习时间：否则一开箱就被判定「该复习了」
  for (const node of map.nodes.filter(item => item.status === 'unexplored')) {
    assert.equal(node.lastReviewedAt, '', `未探索节点 ${node.id} 不应有复习时间`)
  }

  // —— 老格式种子：缺字段就补默认值，且不凭空衰减 ——
  const legacy = normalizeSeed({
    id: 'legacy_map',
    title: '老图谱',
    currentNodeId: 'n1',
    nodes: [{ id: 'n1', parentId: null, title: '根', status: 'understood', content: '正文' }],
  })
  assert.equal(legacy.nodes[0].origin, 'user')
  assert.deepStrictEqual(legacy.nodes[0].edges, [])
  assert.equal(legacy.nodes[0].lastReviewedAt, '', '没有复习记录就不该有衰减起点')
  assert.deepStrictEqual(legacy.nodes[0].qa, [])
  assert.deepStrictEqual(legacy.canon, { generatedAt: '', scaleEstimate: 0, source: '' })

  // —— 相对天数物化：daysAgo 应换算成对应时刻 ——
  const relative = normalizeSeed({
    id: 'rel_map',
    title: '相对时间',
    createdDaysAgo: 30,
    nodes: [{
      id: 'n1',
      parentId: null,
      title: '根',
      status: 'verified',
      verifiedBy: 'quiz',
      reviewedDaysAgo: 7,
      qa: [{ question: '问题', answer: '回答', daysAgo: 3 }],
      quiz: [{ items: [{ question: 'q', answer: 'a', pass: true }] }],
    }],
  })
  assert.ok(Math.abs(daysBetween(relative.nodes[0].lastReviewedAt, now) - 7) < 0.01)
  assert.ok(Math.abs(daysBetween(relative.nodes[0].qa[0].createdAt, now) - 3) < 0.01)
  // 记录没写相对时间时，回落到所属节点的创建时间，而不是播种时刻
  assert.equal(relative.nodes[0].quiz[0].createdAt, relative.nodes[0].createdAt)
  assert.equal(relative.nodes[0].verifiedBy, 'quiz')

  // —— 废弃 id：旧演示图谱必须进入移除名单，否则用户看到的是两个同名图谱 ——
  assert.ok(DEPRECATED_BUILTIN_IDS.includes('learn_map_builtin_agent'))
  assert.ok(!DEPRECATED_BUILTIN_IDS.includes(map.id), '当前示例图谱不能被自己废弃掉')

  console.log('learning seed checks passed')
}

run()

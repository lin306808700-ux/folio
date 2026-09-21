// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLearningMapStore, computeProgress, QA_LIMIT, QUIZ_LIMIT } = require('./learning-maps')
const DAY = 86400000

function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-learning-'))
  const store = createLearningMapStore(path.join(tempDir, 'maps.json'))

  const map = store.create({ title: ' Java ', description: '体系化学习' })
  assert.equal(map.title, 'Java')
  assert.equal(map.nodes.length, 1)
  assert.equal(map.currentNodeId, map.nodes[0].id)

  const child = store.addNode(map.id, { parentId: map.nodes[0].id, title: '并发编程' })
  assert.equal(child.status, 'unexplored')

  const updated = store.updateNode(map.id, child.id, {
    status: 'verified',
    verifiedBy: 'quiz',
    summary: '能解释 happens-before。',
    evidence: '独立答对可见性问题。',
    nextStep: '学习 volatile。',
  })
  assert.equal(updated.status, 'verified')
  assert.equal(updated.verifiedBy, 'quiz')
  assert.match(updated.evidence, /独立答对/)

  store.setCurrent(map.id, child.id)
  const persisted = store.get(map.id)
  assert.equal(persisted.currentNodeId, child.id)
  assert.equal(store.list().length, 1)

  assert.throws(() => store.addNode(map.id, { parentId: 'missing', title: '无效' }), /父节点不存在/)
  assert.throws(() => store.updateNode(map.id, child.id, { status: 'done' }), /无效的掌握状态/)

  // 离开「已验证」时清掉来源标记，避免留下过期归因
  const downgraded = store.updateNode(map.id, child.id, { status: 'learning' })
  assert.equal(downgraded.verifiedBy, '')

  // getNode：正文按需单取
  store.updateNode(map.id, child.id, { content: '# 并发编程\n\n正文内容' })
  assert.match(store.getNode(map.id, child.id).content, /正文内容/)
  assert.throws(() => store.getNode(map.id, 'missing'), /知识节点不存在/)

  // listMeta：批量视图不带正文，只带 hasContent
  const meta = store.listMeta()[0]
  const metaChild = meta.nodes.find(node => node.id === child.id)
  assert.equal(metaChild.content, undefined)
  assert.equal(metaChild.hasContent, true)
  assert.equal(meta.nodes.find(node => node.id === map.nodes[0].id).hasContent, false)

  // 沉淀记录按「保留最新」截断：第 31 条问答必须留下，被挤掉的应是最旧那条
  const base = Date.parse('2026-08-01T00:00:00.000Z')
  const qa = Array.from({ length: QA_LIMIT + 1 }, (_, index) => ({
    question: `问题 ${index}`,
    selection: '',
    answer: `回答 ${index}`,
    createdAt: new Date(base + index * 1000).toISOString(),
  }))
  const trimmed = store.updateNode(map.id, child.id, { qa })
  assert.equal(trimmed.qa.length, QA_LIMIT)
  assert.equal(trimmed.qa[0].question, `问题 ${QA_LIMIT}`)
  assert.ok(!trimmed.qa.some(item => item.question === '问题 0'), '最旧的问答应被截断')

  const quiz = Array.from({ length: QUIZ_LIMIT + 1 }, (_, index) => ({
    items: [{ question: `题 ${index}`, answer: '答', pass: true, comment: '' }],
    guidance: [{ nodeId: map.nodes[0].id, nodeTitle: 'Java', reason: '补基础' }],
    createdAt: new Date(base + index * 1000).toISOString(),
  }))
  const trimmedQuiz = store.updateNode(map.id, child.id, { quiz })
  assert.equal(trimmedQuiz.quiz.length, QUIZ_LIMIT)
  assert.equal(trimmedQuiz.quiz[0].items[0].question, `题 ${QUIZ_LIMIT}`)
  assert.equal(trimmedQuiz.quiz[0].guidance[0].nodeId, map.nodes[0].id)

  // 删除子树：连同后代一起删，并把当前位置回退到父节点
  const grandChild = store.addNode(map.id, { parentId: child.id, title: 'JMM' })
  store.setCurrent(map.id, grandChild.id)
  const removed = store.deleteNode(map.id, child.id)
  assert.deepEqual(new Set(removed.removed), new Set([child.id, grandChild.id]))
  const afterDelete = store.get(map.id)
  assert.equal(afterDelete.nodes.length, 1)
  assert.equal(afterDelete.currentNodeId, map.nodes[0].id)
  assert.throws(() => store.deleteNode(map.id, grandChild.id), /知识节点不存在/)
  // 唯一根节点不允许单独删除
  assert.throws(() => store.deleteNode(map.id, map.nodes[0].id), /请直接删除整个图谱/)

  // 图谱级操作
  const renamed = store.updateMap(map.id, { title: ' Java 并发 ', description: '换了个目标' })
  assert.equal(renamed.title, 'Java 并发')
  assert.equal(renamed.description, '换了个目标')
  assert.throws(() => store.updateMap(map.id, { title: '   ' }), /学习主题不能为空/)

  const second = store.create({ title: 'React' })
  assert.equal(store.list().length, 2)
  const dropped = store.deleteMap(second.id)
  assert.equal(dropped.title, 'React')
  assert.equal(store.list().length, 1)
  assert.throws(() => store.deleteMap(second.id), /学习图谱不存在/)

  // 读缓存：外部改写文件后仍能读到新内容
  const filePath = path.join(tempDir, 'maps.json')
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  raw[0].title = '外部改名'
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8')
  assert.equal(store.list()[0].title, '外部改名')

  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('learning-maps tests passed')
}

run()

/**
 * 三层知识模型：骨架分母、双指标进度、连接边、衰减。
 * 这些语义横跨主进程与渲染层，改动容易静默漂移，单独守一遍。
 */
function runModelChecks() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-learning-model-'))
  const filePath = path.join(tempDir, 'maps.json')

  // 老数据没有 origin / edges / lastReviewedAt / canon，读取时就地补默认值
  fs.writeFileSync(filePath, JSON.stringify([{
    id: 'legacy',
    title: '旧图谱',
    description: '',
    currentNodeId: 'n1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes: [{
      id: 'n1', parentId: null, title: '根', status: 'understood',
      summary: '', evidence: '', nextStep: '',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  }], null, 2), 'utf8')

  const store = createLearningMapStore(filePath)
  const legacy = store.get('legacy')
  assert.equal(legacy.nodes[0].origin, 'user')
  assert.deepEqual(legacy.nodes[0].edges, [])
  assert.equal(legacy.nodes[0].lastReviewedAt, '')
  assert.equal(legacy.canon.source, '')
  // 没有骨架的旧图谱退化为按已建节点算分母，数字仍然可读
  assert.equal(store.listMeta()[0].progress.basedOn, 'graph')

  const map = store.create({ title: '分布式系统' })
  const rootId = map.nodes[0].id
  const nodes = store.addNodes(map.id, [
    { parentId: rootId, title: '共识', origin: 'canon' },
    { parentId: rootId, title: '复制', origin: 'canon' },
    { parentId: rootId, title: '分区容错', origin: 'canon' },
    { parentId: rootId, title: '我的笔记' },
  ])
  assert.equal(nodes.length, 4)
  assert.equal(nodes[0].origin, 'canon')
  assert.equal(nodes[3].origin, 'user', '未声明来源的节点算用户自建')
  assert.throws(() => store.addNodes(map.id, []), /没有可添加的知识点/)
  // 父节点不存在的条目被跳过，整批都无效时报错，不产生半截数据
  assert.throws(() => store.addNodes(map.id, [{ parentId: 'nope', title: '孤立' }]), /没有可添加的知识点/)
  assert.throws(() => store.addNodes('missing', [{ parentId: rootId, title: 'x' }]), /学习图谱不存在/)

  const canon = store.setCanon(map.id, { scaleEstimate: 42.6 })
  assert.equal(canon.scaleEstimate, 43)
  assert.equal(canon.source, 'ai')
  assert.ok(canon.generatedAt)
  assert.throws(() => store.setCanon('missing', {}), /学习图谱不存在/)

  store.updateNode(map.id, nodes[0].id, { status: 'verified', verifiedBy: 'quiz' })
  store.updateNode(map.id, nodes[1].id, { status: 'learning' })

  // 分母是骨架规模（3 个 canon 节点），用户自建的「我的笔记」不参与
  const progress = store.listMeta().find(item => item.id === map.id).progress
  assert.equal(progress.basedOn, 'canon')
  assert.equal(progress.denominator, 3)
  assert.equal(progress.entered, 2)
  assert.equal(progress.coverage, 2 / 3)
  assert.ok(Math.abs(progress.mastery - (1 + 0.35) / 3) < 1e-3)
  // 覆盖度与掌握度的差值就是「看过但没吃透」
  assert.ok(progress.gap > 0)
  assert.equal(progress.stale, 0)

  // 衰减：60 天后已验证节点折半，两个节点都属于「该复习了」
  const decayed = computeProgress(store.get(map.id), Date.now() + 60 * DAY)
  assert.ok(Math.abs(decayed.mastery - (0.5 + 0.175) / 3) < 1e-3)
  assert.equal(decayed.stale, 2)

  // 衰减有 0.5 下限：再放 60 天也不会继续掉，老数据不被归零
  const floored = computeProgress(store.get(map.id), Date.now() + 120 * DAY)
  assert.ok(Math.abs(floored.mastery - decayed.mastery) < 1e-6, '衰减应止步于五折')

  // 连接边：重复边去重，非法类型拒绝
  store.addEdge(map.id, nodes[0].id, { type: 'peer', targetNodeId: nodes[1].id, targetTitle: '复制' })
  store.addEdge(map.id, nodes[0].id, { type: 'peer', targetNodeId: nodes[1].id, targetTitle: '复制' })
  assert.equal(store.getNode(map.id, nodes[0].id).edges.length, 1)
  // 跨域门户的目标图谱可以还不存在，只要有领域名就算合法目标
  store.addEdge(map.id, nodes[0].id, { type: 'portal', targetTitle: '排队论', note: '共识的延迟模型' })
  assert.equal(store.getNode(map.id, nodes[0].id).edges.length, 2)
  assert.throws(() => store.addEdge(map.id, nodes[0].id, { type: 'friend', targetTitle: 'x' }), /无效的连接类型/)
  assert.throws(() => store.addEdge(map.id, nodes[0].id, { type: 'peer' }), /无效的连接类型/)

  store.removeEdge(map.id, nodes[0].id, { type: 'portal' })
  assert.equal(store.getNode(map.id, nodes[0].id).edges.length, 1)
  assert.equal(store.removeEdge(map.id, nodes[0].id, { type: 'portal' }).edges.length, 1, '删不存在的边应幂等')

  // 删节点要顺手剪掉指向它的悬空边
  store.addEdge(map.id, nodes[1].id, { type: 'prereq', targetNodeId: nodes[2].id, targetTitle: '分区容错' })
  assert.equal(store.getNode(map.id, nodes[1].id).edges.length, 1)
  store.deleteNode(map.id, nodes[2].id)
  assert.equal(store.getNode(map.id, nodes[1].id).edges.length, 0)

  const metaNode = store.listMeta().find(item => item.id === map.id).nodes.find(item => item.id === nodes[0].id)
  assert.equal(metaNode.origin, 'canon')
  assert.equal(metaNode.edges.length, 1)
  assert.ok(metaNode.masteryScore > 0 && metaNode.masteryScore <= 1)

  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('learning map model checks passed')
}

runModelChecks()

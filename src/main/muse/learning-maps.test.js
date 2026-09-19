// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLearningMapStore, QA_LIMIT, QUIZ_LIMIT } = require('./learning-maps')

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

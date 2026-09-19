// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLearningMapStore } = require('./learning-maps')

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
    summary: '能解释 happens-before。',
    evidence: '独立答对可见性问题。',
    nextStep: '学习 volatile。',
  })
  assert.equal(updated.status, 'verified')
  assert.match(updated.evidence, /独立答对/)

  store.setCurrent(map.id, child.id)
  const persisted = store.get(map.id)
  assert.equal(persisted.currentNodeId, child.id)
  assert.equal(store.list().length, 1)

  assert.throws(() => store.addNode(map.id, { parentId: 'missing', title: '无效' }), /父节点不存在/)
  assert.throws(() => store.updateNode(map.id, child.id, { status: 'done' }), /无效的掌握状态/)

  fs.rmSync(tempDir, { recursive: true, force: true })
  console.log('learning-maps tests passed')
}

run()

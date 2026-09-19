// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { analyzeRepository, moduleForFile, parseNameStatus, parsePorcelain, scopeFilesToWorkspace } = require('./architecture-analyzer')

test('maps project files to stable product modules', () => {
  assert.equal(moduleForFile('src/renderer/src/components/ChatPage/index.tsx').id, 'renderer-chat')
  assert.equal(moduleForFile('src/preload/index.js').id, 'preload')
  assert.equal(moduleForFile('src/main/task-engine/state.js').id, 'task-engine')
})

test('parses changed and untracked git status records', () => {
  const files = parsePorcelain(' M src/main/chat-handler.js\0?? src/new.js\0')
  assert.deepEqual(files, [
    { path: 'src/main/chat-handler.js', status: 'M', untracked: false },
    { path: 'src/new.js', status: '??', untracked: true },
  ])
})

test('parses files from a committed git changeset', () => {
  assert.deepEqual(parseNameStatus('M\0src/main/index.js\0R100\0old.js\0new.js\0'), [
    { path: 'src/main/index.js', status: 'M', untracked: false },
    { path: 'new.js', status: 'R100', untracked: false },
  ])
})

test('keeps only changes inside a workspace nested below the git root', () => {
  const files = [
    { path: 'ai-terminal/src/main/index.js', status: 'M', untracked: false },
    { path: 'work/other/index.js', status: 'M', untracked: false },
  ]
  assert.deepEqual(scopeFilesToWorkspace(files, 'ai-terminal/'), [
    { path: 'src/main/index.js', status: 'M', untracked: false },
  ])
})

test('analyzes real git changes and propagates evidence across known boundaries', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-analysis-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })

  const chatDir = path.join(repo, 'src/renderer/src/components/ChatPage')
  fs.mkdirSync(chatDir, { recursive: true })
  fs.writeFileSync(path.join(chatDir, 'index.tsx'), 'export const value = 1\n')
  fs.writeFileSync(path.join(chatDir, 'index.test.tsx'), 'test("value", () => {})\n')
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'docs/README.md'), 'initial\n')
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo })
  fs.writeFileSync(path.join(chatDir, 'index.tsx'), 'export const value = 2\n')
  fs.writeFileSync(path.join(repo, 'docs/README.md'), 'changed\n')

  const analysis = analyzeRepository(repo)
  const renderer = analysis.modules.find(module => module.id === 'renderer-chat')
  const preload = analysis.modules.find(module => module.id === 'preload')
  const docs = analysis.modules.find(module => module.id === 'docs')

  assert.equal(analysis.summary.changedFiles, 2)
  assert.equal(analysis.summary.untestedFiles, 0)
  assert.equal(renderer.state, 'changed')
  assert.equal(renderer.files[0].added, 1)
  assert.equal(renderer.files[0].deleted, 1)
  assert.equal(renderer.files[0].testStatus, 'existing')
  assert.equal(preload.state, 'affected')
  assert.match(preload.evidence[0].text, /preload/)
  assert.equal(docs.testStatus, 'not-applicable')

  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-m', 'agent change'], { cwd: repo })
  const committedAnalysis = analyzeRepository(repo)
  assert.equal(committedAnalysis.changeset.mode, 'latest-commit')
  assert.equal(committedAnalysis.changeset.subject, 'agent change')
  assert.equal(committedAnalysis.summary.changedFiles, 2)
})

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { TOOLS, _internals } = require('./react-engine')

const { parseReactResponse, shouldSaveCheckpoint, resolveWorkspacePath, authorizeToolAction, findShellWorkspaceEscape } = _internals

async function createFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'react-engine-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  await fs.mkdir(workspace)
  await fs.mkdir(outside)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, workspace, outside }
}

test('parses fenced action responses and normalizes aliases', () => {
  const result = parseReactResponse(`\`\`\`json
{"type":"action","thought":"inspect","action_name":"READ_FILE","action_input":{"path":"a.js"}}
\`\`\``)

  assert.equal(result.type, 'action')
  assert.equal(result.actionName, 'read_file')
  assert.deepEqual(result.actionInput, { path: 'a.js' })
})

test('extracts a JSON response surrounded by model commentary', () => {
  const result = parseReactResponse('I will finish now. {"type":"final","answer":"done"} trailing text')
  assert.equal(result.type, 'final')
  assert.equal(result.finalAnswer, 'done')
})

test('classifies incomplete file actions as truncated', () => {
  const result = parseReactResponse('{"type":"action","action":"write_file","input":{"path":"large.js","content":"unfinished')
  assert.equal(result.type, 'truncated')
  assert.equal(result.truncatedFile, 'large.js')
})

test('checkpoint policy requires useful progress and a recoverable interruption', () => {
  const usefulSteps = [
    { success: true, actionName: 'read_file' },
    { success: true, actionName: 'write_file' },
    { success: false, actionName: 'shell' },
  ]

  assert.equal(shouldSaveCheckpoint(usefulSteps, '执行超时'), true)
  assert.equal(shouldSaveCheckpoint(usefulSteps, 'AI调用失败: network error'), true)
  assert.equal(shouldSaveCheckpoint(usefulSteps, '时间预算不足'), true)
  assert.equal(shouldSaveCheckpoint(usefulSteps, '用户主动中断'), false)
  assert.equal(shouldSaveCheckpoint(usefulSteps.slice(0, 2), '执行超时'), false)
  assert.equal(shouldSaveCheckpoint(usefulSteps.map(s => ({ ...s, actionName: 'read_file' })), '执行超时'), false)
})

test('workspace path resolver blocks traversal and symlink escapes', async t => {
  const { workspace, outside } = await createFixture(t)
  await fs.symlink(outside, path.join(workspace, 'outside-link'))

  assert.equal(resolveWorkspacePath(workspace, 'src/a.js'), path.join(workspace, 'src/a.js'))
  assert.throws(() => resolveWorkspacePath(workspace, '../escape.js'), /路径超出工作区范围/)
  assert.throws(() => resolveWorkspacePath(workspace, 'outside-link/escape.js'), /符号链接超出工作区范围/)
})

test('ReAct file tools reject reads and writes outside the workspace', async t => {
  const { workspace, outside } = await createFixture(t)
  await fs.writeFile(path.join(outside, 'secret.txt'), 'secret')

  const readResult = await TOOLS.read_file({ path: path.join(outside, 'secret.txt') }, workspace)
  const writeResult = await TOOLS.write_file({ path: '../escape.txt', content: 'no' }, workspace)

  assert.match(readResult, /读取失败: 路径超出工作区范围/)
  assert.match(writeResult, /写入失败: 路径超出工作区范围/)
})

test('apply_patch validates every path before changing any file', async t => {
  const { root, workspace } = await createFixture(t)
  const patch = `*** Begin Patch
*** Add File: safe.txt
+safe
*** End File
*** Add File: ../escape.txt
+escape
*** End File
*** End Patch`

  const result = await TOOLS.apply_patch({ patch }, workspace)

  assert.match(result, /路径预检未通过/)
  await assert.rejects(() => fs.access(path.join(workspace, 'safe.txt')))
  await assert.rejects(() => fs.access(path.join(root, 'escape.txt')))
})

test('dangerous shell actions fail closed without explicit user authorization', async () => {
  const deniedWithoutChannel = await authorizeToolAction('shell', { cmd: 'rm -rf /' }, undefined, 1)
  const deniedByUser = await authorizeToolAction('shell', { cmd: 'rm -rf /' }, async () => false, 1)
  const allowedByUser = await authorizeToolAction('shell', { cmd: 'rm -rf /' }, async () => true, 1)
  const safeWithoutChannel = await authorizeToolAction('shell', { cmd: 'pwd' }, undefined, 1)

  assert.equal(deniedWithoutChannel.allowed, false)
  assert.equal(deniedWithoutChannel.reason, '缺少用户授权通道')
  assert.equal(deniedByUser.allowed, false)
  assert.equal(allowedByUser.allowed, true)
  assert.equal(safeWithoutChannel.allowed, true)
})

test('shell authorization detects explicit paths outside the workspace', async t => {
  const { workspace } = await createFixture(t)
  const outsideRedirect = await authorizeToolAction('shell', { cmd: 'echo hi > /tmp/output.txt' }, undefined, 1, workspace)
  const parentTraversal = await authorizeToolAction('shell', { cmd: 'cat ../secret.txt' }, undefined, 1, workspace)
  const insideRedirect = await authorizeToolAction('shell', { cmd: 'echo hi > output.txt' }, undefined, 1, workspace)

  assert.equal(outsideRedirect.allowed, false)
  assert.equal(outsideRedirect.workspaceEscape.path, '/tmp/output.txt')
  assert.equal(parentTraversal.allowed, false)
  assert.equal(insideRedirect.allowed, true)
  assert.equal(findShellWorkspaceEscape('echo ok > /dev/null', workspace), null)
})

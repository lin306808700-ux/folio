// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const MODULES = [
  { id: 'renderer-chat', label: '对话工作区', match: file => file.startsWith('src/renderer/src/components/ChatPage/') },
  { id: 'renderer-pages', label: '产品页面', match: file => file.startsWith('src/renderer/src/pages/') || file === 'src/renderer/src/App.tsx' },
  { id: 'preload', label: '隔离桥接', match: file => file.startsWith('src/preload/') },
  { id: 'main-chat', label: '主进程流处理', match: file => file === 'src/main/chat-handler.js' },
  { id: 'muse', label: 'Muse 路由与执行', match: file => file.startsWith('src/main/muse/') },
  { id: 'task-engine', label: '任务引擎', match: file => file.startsWith('src/main/task-engine/') },
  { id: 'ipc', label: 'IPC 处理器', match: file => file.startsWith('src/main/ipc/') || file === 'src/main/index.js' },
  { id: 'shared', label: '模型客户端', match: file => file.startsWith('src/shared/') },
  { id: 'docs', label: '项目文档', match: file => file.startsWith('docs/') || file === 'AGENTS.md' },
  { id: 'other', label: '其他文件', match: () => true },
]

const MODULE_EDGES = [
  { from: 'renderer-chat', to: 'preload', label: '调用桥接 API', evidence: 'renderer 只能通过 preload 访问主进程' },
  { from: 'preload', to: 'ipc', label: 'IPC invoke', evidence: 'preload channel 必须与 main handler 对齐' },
  { from: 'ipc', to: 'main-chat', label: '流式处理', evidence: 'AI IPC 将请求交给 chat-handler' },
  { from: 'main-chat', to: 'muse', label: '请求路由', evidence: 'chat-handler 与 Muse router 共同处理聊天和 ReAct 路径' },
  { from: 'muse', to: 'task-engine', label: '执行任务', evidence: 'ReAct engine 调用 task-engine 工具与状态' },
  { from: 'renderer-pages', to: 'preload', label: '读取业务数据', evidence: '业务页面通过 electronAPI 调用主进程' },
  { from: 'main-chat', to: 'shared', label: '模型调用', evidence: '主进程使用 shared provider 客户端' },
]

function runGit(repoPath, args) {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 5 * 1024 * 1024,
  }).replace(/\r?\n$/, '')
}

function parsePorcelain(output) {
  if (!output) return []
  return output.split('\0').filter(Boolean).map(entry => {
    const status = entry.slice(0, 2)
    let filePath = entry.slice(3)
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop()
    return { path: filePath, status: status.trim() || 'M', untracked: status === '??' }
  })
}

function parseNameStatus(output) {
  if (!output) return []
  const tokens = output.split('\0').filter(Boolean)
  const files = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]
    const firstPath = tokens[index++]
    if (!firstPath) break
    const renamed = /^[RC]/.test(status)
    const filePath = renamed ? tokens[index++] : firstPath
    if (filePath) files.push({ path: filePath, status, untracked: false })
  }
  return files
}

function moduleForFile(filePath) {
  return MODULES.find(module => module.match(filePath)) || MODULES[MODULES.length - 1]
}

function scopeFilesToWorkspace(files, workspacePrefix) {
  if (!workspacePrefix) return files.filter(file => !file.path.startsWith('../') && !path.isAbsolute(file.path))
  return files
    .filter(file => file.path.startsWith(workspacePrefix))
    .map(file => ({ ...file, path: file.path.slice(workspacePrefix.length) }))
}

function countFileLines(repoPath, filePath) {
  try {
    const content = fs.readFileSync(path.join(repoPath, filePath), 'utf8')
    return content ? content.split(/\r?\n/).length : 0
  } catch {
    return 0
  }
}

function attachLineChanges(repoPath, files, changesetMode, workspacePrefix) {
  const args = changesetMode === 'latest-commit'
    ? ['-c', 'core.quotePath=false', 'show', '--format=', '--numstat', 'HEAD', '--', '.']
    : ['-c', 'core.quotePath=false', 'diff', '--numstat', 'HEAD', '--', '.']
  const changes = new Map()
  try {
    const output = runGit(repoPath, args)
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue
      const [added, deleted, ...pathParts] = line.split('\t')
      let filePath = pathParts.join('\t')
      if (workspacePrefix && filePath.startsWith(workspacePrefix)) filePath = filePath.slice(workspacePrefix.length)
      changes.set(filePath, {
        added: Number.isFinite(Number(added)) ? Number(added) : 0,
        deleted: Number.isFinite(Number(deleted)) ? Number(deleted) : 0,
      })
    }
  } catch {
    // Git diff 失败时仍返回文件级事实，只将行数标记为 0。
  }
  return files.map(file => ({
    ...file,
    ...(file.untracked ? { added: countFileLines(repoPath, file.path), deleted: 0 } : changes.get(file.path) || { added: 0, deleted: 0 }),
  }))
}

function isTestFile(filePath) {
  return /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[^.]+$)/.test(filePath)
}

function isTestableSource(filePath) {
  return /\.(?:js|jsx|ts|tsx|mjs|cjs|py)$/.test(filePath)
}

function findRelatedTests(repoPath, filePath) {
  if (isTestFile(filePath)) return [filePath]
  const extension = path.extname(filePath)
  const base = filePath.slice(0, -extension.length)
  const candidates = [
    `${base}.test${extension}`,
    `${base}.spec${extension}`,
    path.join(path.dirname(filePath), '__tests__', `${path.basename(base)}.test${extension}`),
  ]
  return candidates.filter(candidate => fs.existsSync(path.join(repoPath, candidate)))
}

function buildAnalysis(repoPath, changedFiles, branch, head, changeset = { mode: 'working-tree', label: '未提交变更' }) {
  const changedModuleIds = new Set(changedFiles.map(file => moduleForFile(file.path).id))
  const affectedModuleIds = new Set()

  for (const edge of MODULE_EDGES) {
    if (changedModuleIds.has(edge.from) && !changedModuleIds.has(edge.to)) affectedModuleIds.add(edge.to)
    if (changedModuleIds.has(edge.to) && !changedModuleIds.has(edge.from)) affectedModuleIds.add(edge.from)
  }

  const visibleIds = new Set([...changedModuleIds, ...affectedModuleIds])
  const modules = MODULES.filter(module => visibleIds.has(module.id)).map(module => {
    const files = changedFiles
      .filter(file => moduleForFile(file.path).id === module.id)
      .map(file => {
        if (!isTestableSource(file.path)) {
          return { ...file, tests: [], testStatus: 'not-applicable' }
        }
        const tests = findRelatedTests(repoPath, file.path)
        const testChanged = tests.some(testPath => changedFiles.some(changed => changed.path === testPath))
        return {
          ...file,
          tests,
          testStatus: testChanged ? 'changed' : tests.length > 0 ? 'existing' : 'missing',
        }
      })

    const connectedEdges = MODULE_EDGES.filter(edge => edge.from === module.id || edge.to === module.id)
    const changed = changedModuleIds.has(module.id)
    const testableFiles = files.filter(file => file.testStatus !== 'not-applicable')
    const tests = testableFiles.flatMap(file => file.tests)
    const testStatus = testableFiles.length === 0
      ? 'not-applicable'
      : testableFiles.some(file => file.testStatus === 'changed')
      ? 'changed'
      : tests.length > 0
        ? 'existing'
        : 'missing'

    return {
      id: module.id,
      label: module.label,
      state: changed ? 'changed' : 'affected',
      files,
      testStatus,
      evidence: changed
        ? [{ kind: 'static', text: `${files.length} 个文件存在真实 Git 变更` }]
        : connectedEdges
          .filter(edge => changedModuleIds.has(edge.from) || changedModuleIds.has(edge.to))
          .map(edge => ({ kind: 'static', text: edge.evidence })),
    }
  })

  return {
    repository: { path: repoPath, name: path.basename(repoPath), branch, head },
    changeset,
    summary: {
      changedFiles: changedFiles.length,
      changedModules: changedModuleIds.size,
      affectedModules: affectedModuleIds.size,
      untestedFiles: modules.flatMap(module => module.files).filter(file => file.testStatus === 'missing').length,
    },
    modules,
    edges: MODULE_EDGES.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)).map(edge => ({ ...edge, kind: 'static' })),
  }
}

function analyzeRepository(repoPath) {
  if (!repoPath || !fs.existsSync(repoPath)) throw new Error('工作区不存在')
  try {
    runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error('当前工作区不是 Git 仓库')
  }

  const workspacePrefix = runGit(repoPath, ['rev-parse', '--show-prefix'])
  let changedFiles = scopeFilesToWorkspace(
    parsePorcelain(runGit(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])),
    workspacePrefix,
  )
  const branch = runGit(repoPath, ['branch', '--show-current']) || 'detached'
  const head = runGit(repoPath, ['rev-parse', '--short', 'HEAD'])
  let changeset = { mode: 'working-tree', label: '未提交变更' }
  if (changedFiles.length === 0) {
    changedFiles = scopeFilesToWorkspace(
      parseNameStatus(runGit(repoPath, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', 'HEAD'])),
      workspacePrefix,
    )
    const subject = runGit(repoPath, ['show', '-s', '--format=%s', 'HEAD'])
    changeset = { mode: 'latest-commit', label: `最新提交 ${head}`, subject }
  }
  changedFiles = attachLineChanges(repoPath, changedFiles, changeset.mode, workspacePrefix)
  return buildAnalysis(repoPath, changedFiles, branch, head, changeset)
}

module.exports = {
  MODULE_EDGES,
  analyzeRepository,
  attachLineChanges,
  buildAnalysis,
  findRelatedTests,
  moduleForFile,
  parsePorcelain,
  parseNameStatus,
  scopeFilesToWorkspace,
}

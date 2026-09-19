// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * AI Mock 基础设施
 * 提供统一的 mock AI 调用、依赖注入和状态管理
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const Module = require('module')

// ============================================================
// 状态管理
// ============================================================
let _mockAIResponses = []
let _aiCallLog = []
let _callAIImpl = null

function resetMockState() {
  _mockAIResponses = []
  _aiCallLog = []
}

function getAICallLog() {
  return _aiCallLog
}

function pushMockAIResponse(response) {
  _mockAIResponses.push(response)
}

function setMockAIResponses(responses) {
  _mockAIResponses = [...responses]
}

/**
 * 设置自定义 AI 实现（用于高级场景）
 */
function setCallAIImpl(impl) {
  _callAIImpl = impl
}

function restoreDefaultAIImpl() {
  _callAIImpl = null
}

// 默认 AI 实现
function defaultCallAI(prompt, options = {}) {
  _aiCallLog.push({ prompt: prompt.slice(0, 300), options, time: Date.now() })
  if (_mockAIResponses.length > 0) {
    const resp = _mockAIResponses.shift()
    return typeof resp === 'function' ? resp(prompt) : resp
  }
  return '{}'
}

// ============================================================
// 模块拦截 — 在 require 之前调用 setupMocks()
// ============================================================
const originalResolveFilename = Module._resolveFilename
let _mocksInstalled = false

function setupMocks() {
  if (_mocksInstalled) return
  _mocksInstalled = true

  // Intercept electron require
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron') {
      return path.join(__dirname, 'electron.js')
    }
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }

  // Create mock electron module
  if (!fs.existsSync(path.join(__dirname, 'electron.js'))) {
    fs.writeFileSync(path.join(__dirname, 'electron.js'), `
module.exports = {
  app: { getPath: (name) => '${os.tmpdir().replace(/\\/g, '/')}', isReady: () => true, getName: () => 'test' },
  BrowserWindow: class { constructor() {} },
  ipcMain: { on: () => {}, handle: () => {} }
}
`)
  }

  // Patch ai-client
  const aiClientPath = path.resolve(__dirname, '..', '..', '..', '..', 'shared', 'ai-client.js')
  require.cache[aiClientPath] = {
    id: aiClientPath, filename: aiClientPath, loaded: true,
    exports: {
      callAI: async (prompt, options) => {
        if (_callAIImpl) return _callAIImpl(prompt, options)
        return defaultCallAI(prompt, options)
      },
      callAIStream: async () => {},
      collectStream: async () => '',
      analyzeImages: async () => ''
    }
  }

  // Patch security-analyzer
  const secAnalyzerPath = path.resolve(__dirname, '../../../security-analyzer.js')
  require.cache[secAnalyzerPath] = {
    id: secAnalyzerPath, filename: secAnalyzerPath, loaded: true,
    exports: { analyze: () => ({ safe: true, risk: 0 }), analyzeCommand: () => ({ safe: true }) }
  }

  // Patch script-executor
  const scriptExecPath = path.resolve(__dirname, '../../../script-executor.js')
  require.cache[scriptExecPath] = {
    id: scriptExecPath, filename: scriptExecPath, loaded: true,
    exports: {
      analyzeScriptSafety: () => ({ safe: true, needsAuth: false, riskLevel: 'none', reason: '安全', details: {} }),
      executeScript: async () => ({ success: true, stdout: 'mock ok', stderr: '', exitCode: 0 }),
      buildErrorReport: () => '',
      MAX_LOG_LENGTH: 5000,
      DEFAULT_TIMEOUT: 60000
    }
  }

  // Patch database — 包含完整的 Letters.create 等方法
  const databasePath = path.resolve(__dirname, '../../../database.js')
  let _letterStore = []
  let _letterIdCounter = 1
  require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true,
    exports: {
      History: { getRecent: () => [], add: () => {} },
      Memories: { getAll: () => [], add: () => {} },
      MemorySummary: { getActive: () => [], add: () => {} },
      Ideas: { getAll: () => [] },
      Letters: {
        getById: (id) => _letterStore.find(l => l.id === id) || { id, source: 'task', taskId: 'mock_task' },
        getUnread: () => _letterStore.filter(l => !l.read),
        add: (letter) => { _letterStore.push(letter); return letter },
        create: (data) => {
          const letter = { id: `letter_${_letterIdCounter++}`, ...data, createdAt: new Date().toISOString(), read: false }
          _letterStore.push(letter)
          return letter
        },
        markRead: (id) => {
          const l = _letterStore.find(x => x.id === id)
          if (l) l.read = true
        }
      }
    }
  }
}

function teardownMocks() {
  Module._resolveFilename = originalResolveFilename
  _mocksInstalled = false
}

// ============================================================
// AI 响应工厂 — 常见场景的 mock 响应
// ============================================================
const AIResponseFactory = {
  /** 新任务识别响应 */
  newTaskRecognition(understood = 'mock理解') {
    return JSON.stringify({ action: 'new_task', isNewCommand: true, understood })
  },

  /** 任务策略分析响应 */
  taskStrategy({ understood = '测试任务', isComplex = false, scriptLanguage = 'bash' } = {}) {
    return JSON.stringify({
      understood, isComplex, shouldSplit: false,
      needsExecution: true, scriptLanguage,
      outputFormat: '文件', needsOwnerDecision: false, needsConfirmBeforeExec: false
    })
  },

  /** 带代码块的脚本生成响应 */
  scriptGeneration(code, language = 'bash') {
    return `根据你的需求，我生成了以下脚本：\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n这个脚本会完成任务。`
  },

  /** 精确编辑响应 */
  fileEdit(edits) {
    return JSON.stringify({ edits, summary: edits.map(e => e.description).join('; ') })
  },

  /** 任务拆分响应 */
  taskSplit(subtasks) {
    return JSON.stringify({
      understood: '复杂任务', isComplex: true, shouldSplit: true,
      subtasks: subtasks.map((name, i) => ({ name, order: i + 1 })),
      scriptLanguage: 'bash', outputFormat: '文件'
    })
  },

  /** 错误修复响应 */
  repairScript(code, language = 'bash') {
    return `分析错误后，修复后的脚本如下：\n\n\`\`\`${language}\n${code}\n\`\`\`\n`
  },

  /** ReAct action 响应（executeReAct 引擎使用） */
  reactAction(actionName, actionInput, thought = '执行任务') {
    return JSON.stringify({ type: 'action', thought, action: actionName, input: actionInput })
  },

  /** ReAct final 响应（executeReAct 引擎完成时使用） */
  reactFinal(answer = '任务完成', thought = '任务已完成') {
    return JSON.stringify({ type: 'final', thought, answer })
  },

  /** ReAct shell action — 执行 shell 命令 */
  reactCommand(command, thought = '执行命令') {
    return JSON.stringify({ type: 'action', thought, action: 'shell', input: { command } })
  },

  /** 超时/空响应 */
  timeout() {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 100))
  },

  /** 无效 JSON 响应 */
  malformedJSON() {
    return '{ invalid json <<<'
  }
}

module.exports = {
  setupMocks,
  teardownMocks,
  resetMockState,
  getAICallLog,
  pushMockAIResponse,
  setMockAIResponses,
  setCallAIImpl,
  restoreDefaultAIImpl,
  AIResponseFactory
}

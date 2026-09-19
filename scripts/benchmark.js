#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * Muse AI-Terminal Benchmark
 *
 * 通过 MCP Server 测试工具能力，记录耗时和成功率。
 *
 * 用法：
 *   node scripts/benchmark.js
 *
 * 前置条件：
 *   - MCP Server 可正常启动（node src/mcp-server/index.js）
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const MCP_SERVER = path.resolve(__dirname, '..', 'src', 'mcp-server', 'index.js')
const BENCH_DIR = path.join(os.tmpdir(), 'muse-bench-' + Date.now())

// ========== 评测任务 ==========

const TASKS = [
  {
    name: 'file_write',
    desc: '写入 1KB 文件',
    tool: 'file_write',
    args: () => ({
      path: path.join(BENCH_DIR, 'test-write.txt'),
      content: 'x'.repeat(1024)
    }),
    verify: (result) => !result.isError
  },
  {
    name: 'file_read',
    desc: '读取文件',
    tool: 'file_read',
    args: () => ({ path: path.join(BENCH_DIR, 'test-write.txt') }),
    verify: (result) => !result.isError && result.content?.[0]?.text?.length === 1024
  },
  {
    name: 'file_edit',
    desc: '编辑文件（search/replace）',
    tool: 'file_edit',
    args: () => ({
      path: path.join(BENCH_DIR, 'test-write.txt'),
      search: 'x'.repeat(100),
      replace: 'y'.repeat(100)
    }),
    verify: (result) => !result.isError
  },
  {
    name: 'list_dir',
    desc: '列出目录',
    tool: 'list_dir',
    args: () => ({ path: BENCH_DIR }),
    verify: (result) => !result.isError
  },
  {
    name: 'run_command',
    desc: '执行命令 (echo)',
    tool: 'run_command',
    args: () => ({ command: 'echo "benchmark test"' }),
    verify: (result) => !result.isError && result.content?.[0]?.text?.includes('benchmark test')
  },
  {
    name: 'search_code',
    desc: '搜索代码',
    tool: 'search_code',
    args: () => ({ pattern: 'benchmark', path: BENCH_DIR }),
    verify: (result) => !result.isError
  },
  {
    name: 'safety_check',
    desc: '危险命令拦截',
    tool: 'run_command',
    args: () => ({ command: 'rm -rf /' }),
    verify: (result) => result.isError === true
  },
]

// ========== MCP Client ==========

class McpClient {
  constructor(serverPath) {
    this.proc = null
    this.msgId = 0
    this.pending = new Map()
    this.buffer = ''
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.proc = spawn('node', [MCP_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })

      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString()
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.id !== undefined && this.pending.has(msg.id)) {
              const { resolve, timer } = this.pending.get(msg.id)
              clearTimeout(timer)
              this.pending.delete(msg.id)
              resolve(msg.result || msg.error)
            }
          } catch { /* 忽略非 JSON 行 */ }
        }
      })

      this.proc.stderr.on('data', () => { /* 忽略 stderr */ })
      this.proc.on('error', reject)

      // 发送 initialize
      this._send('initialize', { protocolVersion: '2025-06-18' }).then(() => {
        this._notify('notifications/initialized')
        resolve()
      }).catch(reject)
    })
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`超时: ${method}`))
      }, 30000)

      this.pending.set(id, { resolve, timer })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  _notify(method) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }

  callTool(name, args) {
    return this._send('tools/call', { name, arguments: args })
  }

  disconnect() {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}

// ========== 运行评测 ==========

async function runBenchmark() {
  // 准备评测目录
  fs.mkdirSync(BENCH_DIR, { recursive: true })

  console.log('=== Muse AI-Terminal Benchmark ===\n')
  console.log(`评测目录: ${BENCH_DIR}`)
  console.log(`任务数量: ${TASKS.length}\n`)

  const client = new McpClient(MCP_SERVER)
  await client.connect()
  console.log('MCP Server 已连接\n')

  const results = []

  for (const task of TASKS) {
    const args = task.args()
    const start = Date.now()

    try {
      const result = await client.callTool(task.tool, args)
      const elapsed = Date.now() - start
      const passed = task.verify(result)

      results.push({ name: task.name, desc: task.desc, elapsed, passed, error: null })
      console.log(`  ${passed ? '✅' : '❌'} ${task.name.padEnd(16)} ${String(elapsed).padStart(6)}ms  ${task.desc}`)
    } catch (err) {
      const elapsed = Date.now() - start
      results.push({ name: task.name, desc: task.desc, elapsed, passed: false, error: err.message })
      console.log(`  ❌ ${task.name.padEnd(16)} ${String(elapsed).padStart(6)}ms  ${err.message}`)
    }
  }

  client.disconnect()

  // 清理
  try { fs.rmSync(BENCH_DIR, { recursive: true }) } catch { /* 忽略 */ }

  // 报告
  const passed = results.filter(r => r.passed).length
  const total = results.length
  const avgTime = Math.round(results.reduce((s, r) => s + r.elapsed, 0) / total)

  console.log(`\n=== 评测报告 ===`)
  console.log(`通过率: ${passed}/${total} (${Math.round(passed / total * 100)}%)`)
  console.log(`平均耗时: ${avgTime}ms`)
  console.log(`总耗时: ${results.reduce((s, r) => s + r.elapsed, 0)}ms`)

  return passed === total ? 0 : 1
}

runBenchmark().then(exitCode => process.exit(exitCode)).catch(err => {
  console.error('评测失败:', err)
  process.exit(1)
})

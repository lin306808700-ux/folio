#!/usr/bin/env node
'use strict'

/**
 * Muse AI-Terminal MCP Server
 *
 * 通过 Model Context Protocol 暴露 Muse 的工具能力。
 * 让 Claude Desktop、Cursor、Windsurf 等 MCP Client 可以调用。
 *
 * 传输方式：stdio (JSON-RPC 2.0 over stdin/stdout)
 * 协议版本：2025-06-18
 *
 * 用法：
 *   node src/mcp-server/index.js
 *
 * 在 Claude Desktop 的 claude_desktop_config.json 中配置：
 *   {
 *     "mcpServers": {
 *       "muse": {
 *         "command": "node",
 *         "args": ["/path/to/muse-ai-terminal/src/mcp-server/index.js"]
 *       }
 *     }
 *   }
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { exec } = require('child_process')
const { promisify } = require('util')
const readline = require('readline')

const execAsync = promisify(exec)

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'muse-ai-terminal'
const SERVER_VERSION = '1.0.0'

// ========== 工具定义 ==========

const TOOLS = [
  {
    name: 'file_read',
    description: '读取文件内容。支持文本文件。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（支持 ~ 家目录）' }
      },
      required: ['path']
    }
  },
  {
    name: 'file_write',
    description: '写入文件。如果目录不存在会自动创建。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'file_edit',
    description: '编辑文件：搜索指定文本并替换。如果搜索文本不存在则报错。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        search: { type: 'string', description: '要搜索的文本' },
        replace: { type: 'string', description: '替换为的文本' }
      },
      required: ['path', 'search', 'replace']
    }
  },
  {
    name: 'list_dir',
    description: '列出目录内容，返回文件和子目录列表。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（支持 ~ 家目录）' }
      },
      required: ['path']
    }
  },
  {
    name: 'run_command',
    description: '在 shell 中执行命令。危险命令（rm、sudo、chmod 等）会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        cwd: { type: 'string', description: '工作目录（默认用户家目录）' },
        timeout: { type: 'number', description: '超时毫秒（默认 30000）' }
      },
      required: ['command']
    }
  },
  {
    name: 'search_code',
    description: '在文件中搜索正则表达式（类似 grep -rn）。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        path: { type: 'string', description: '搜索目录（默认当前目录）' },
        glob: { type: 'string', description: '文件名过滤（如 *.js）' }
      },
      required: ['pattern']
    }
  }
]

// ========== 工具执行 ==========

function resolvePath(p) {
  if (!p) return process.cwd()
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1))
  return path.resolve(p)
}

// 危险命令黑名单
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\s+\//, /sudo\s/, /\bmkfs\b/, /\bdd\s+if=/,
  /\b:\(\)\s*\{.*\};\s*:/, /\bchmod\s+777\s+\//, /\bshutdown\b/,
  /\bhalt\b/, /\breboot\b/
]

function isDangerous(cmd) {
  return DANGEROUS_PATTERNS.some(p => p.test(cmd))
}

async function executeTool(name, args) {
  switch (name) {
    case 'file_read': {
      const filePath = resolvePath(args.path)
      const content = await fs.promises.readFile(filePath, 'utf-8')
      return content
    }

    case 'file_write': {
      const filePath = resolvePath(args.path)
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, args.content, 'utf-8')
      return `文件已写入: ${filePath} (${args.content.length} 字符)`
    }

    case 'file_edit': {
      const filePath = resolvePath(args.path)
      let content = await fs.promises.readFile(filePath, 'utf-8')
      if (!content.includes(args.search)) {
        throw new Error(`在 ${path.basename(filePath)} 中未找到匹配内容`)
      }
      content = content.replace(args.search, args.replace)
      await fs.promises.writeFile(filePath, content, 'utf-8')
      return `已替换 ${path.basename(filePath)} 中的内容`
    }

    case 'list_dir': {
      const dirPath = resolvePath(args.path)
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      const result = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file'
      }))
      return JSON.stringify(result, null, 2)
    }

    case 'run_command': {
      const cmd = args.command
      if (isDangerous(cmd)) {
        throw new Error(`命令被拒绝（安全策略）: ${cmd}`)
      }
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: args.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: args.cwd ? resolvePath(args.cwd) : os.homedir()
      })
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n--- stderr ---\n')
      return output || '(无输出)'
    }

    case 'search_code': {
      const pattern = args.pattern
      const searchPath = args.path ? resolvePath(args.path) : process.cwd()
      const globFlag = args.glob ? ` --include='${args.glob}'` : ''
      const cmd = `grep -rn --color=never${globFlag} '${pattern.replace(/'/g, "'\\''")}' "${searchPath}" 2>/dev/null | head -100`
      const { stdout } = await execAsync(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 })
      return stdout.trim() || '(无匹配结果)'
    }

    default:
      throw new Error(`未知工具: ${name}`)
  }
}

// ========== JSON-RPC 协议处理 ==========

function makeResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result })
}

function makeErrorResponse(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleMessage(msg) {
  const { id, method, params } = msg

  // 通知（无 id）不需要响应
  if (id === undefined || id === null) return null

  switch (method) {
    case 'initialize':
      return makeResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} }
      })

    case 'tools/list':
      return makeResponse(id, { tools: TOOLS })

    case 'tools/call': {
      const { name, arguments: args } = params || {}
      if (!name) return makeErrorResponse(id, -32602, '缺少工具名称')

      const toolDef = TOOLS.find(t => t.name === name)
      if (!toolDef) return makeErrorResponse(id, -32601, `未知工具: ${name}`)

      try {
        const result = await executeTool(name, args || {})
        return makeResponse(id, {
          content: [{ type: 'text', text: String(result) }],
          isError: false
        })
      } catch (err) {
        return makeResponse(id, {
          content: [{ type: 'text', text: `错误: ${err.message}` }],
          isError: true
        })
      }
    }

    case 'resources/list':
      return makeResponse(id, { resources: [] })

    case 'prompts/list':
      return makeResponse(id, { prompts: [] })

    default:
      return makeErrorResponse(id, -32601, `未知方法: ${method}`)
  }
}

// ========== stdio 传输 ==========

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    // 非 JSON 行，忽略
    return
  }

  try {
    const response = await handleMessage(msg)
    if (response) {
      process.stdout.write(response + '\n')
    }
  } catch (err) {
    const response = makeErrorResponse(msg.id || 0, -32603, err.message)
    process.stdout.write(response + '\n')
  }
})

rl.on('close', () => {
  process.exit(0)
})

// 启动信号
process.stderr.write(`[${SERVER_NAME}] MCP Server v${SERVER_VERSION} 已启动 (protocol ${PROTOCOL_VERSION})\n`)
process.stderr.write(`[${SERVER_NAME}] 暴露 ${TOOLS.length} 个工具: ${TOOLS.map(t => t.name).join(', ')}\n`)

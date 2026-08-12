'use strict'

/**
 * Muse 静态文件服务
 * 用于渲染 Muse 生成的 HTML、SVG、图片、Markdown 等物料
 */

const express = require('express')
const path = require('path')
const fs = require('fs')

const MUSE_HOME = path.join(process.env.HOME, '.ai-terminal/muse')
const WORKSPACE_DIR = path.join(MUSE_HOME, 'workspace')

const app = express()
const PORT = 8766

// 确保工作目录存在
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
}

// 设置 CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

// 错误日志静态服务
const ERROR_LOG_DIR = path.join(MUSE_HOME, 'error-logs')
if (!fs.existsSync(ERROR_LOG_DIR)) {
  fs.mkdirSync(ERROR_LOG_DIR, { recursive: true })
}
app.use('/error-logs', express.static(ERROR_LOG_DIR, {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache')
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    } else if (ext === '.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    } else if (ext === '.txt' || ext === '') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    }
  }
}))

// 静态文件服务
// 只有二进制媒体文件（PNG/JPEG）才缓存，Muse 频繁更新的产物（HTML/SVG/MD/JSON）不缓存
app.use('/workspace', express.static(WORKSPACE_DIR, {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const isBinaryMedia = ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp'

    if (isBinaryMedia) {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    } else {
      res.setHeader('Cache-Control', 'no-cache')
    }

    if (ext === '.html' || ext === '.htm') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
    } else if (ext === '.svg') {
      res.setHeader('Content-Type', 'image/svg+xml')
    } else if (ext === '.md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    } else if (ext === '.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    } else if (ext === '.png') {
      res.setHeader('Content-Type', 'image/png')
    } else if (ext === '.jpg' || ext === '.jpeg') {
      res.setHeader('Content-Type', 'image/jpeg')
    } else if (ext === '.gif') {
      res.setHeader('Content-Type', 'image/gif')
    } else if (ext === '.webp') {
      res.setHeader('Content-Type', 'image/webp')
    } else if (ext === '.css') {
      res.setHeader('Content-Type', 'text/css; charset=utf-8')
    } else if (ext === '.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    }
  }
}))

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    workspace: WORKSPACE_DIR,
    timestamp: new Date().toISOString()
  })
})

const IGNORED_SCAN_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.svn',
  '__pycache__', '.cache', '.tmp', 'coverage',
  '.next', '.nuxt', '.output', 'vendor'
])

function scanWorkspaceFiles(dir, baseDir = '') {
  const results = []
  const entries = fs.readdirSync(dir)
  for (const entry of entries) {
    if (entry.startsWith('.') || IGNORED_SCAN_DIRS.has(entry)) continue
    const fullPath = path.join(dir, entry)
    const relativePath = baseDir ? path.join(baseDir, entry) : entry
    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...scanWorkspaceFiles(fullPath, relativePath))
    } else {
      results.push({
        name: entry,
        path: relativePath,
        size: stat.size,
        modified: stat.mtime,
        isDirectory: false,
        url: `http://localhost:${PORT}/workspace/${relativePath}`
      })
    }
  }
  return results
}

// 获取文件列表（递归扫描，与 muse-handlers 行为一致）
app.get('/files', (req, res) => {
  try {
    const files = scanWorkspaceFiles(WORKSPACE_DIR)
    res.json({
      success: true,
      count: files.length,
      files
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    })
  }
})

// ========== Browser Bridge API ==========
// 暴露 BrowserTool 能力给 Node ReAct 引擎(react-engine) 循环
let _browserTool = null

function setBrowserTool(bt) {
  _browserTool = bt
  console.log('[StaticServer] BrowserTool 已注入')
}

app.use('/api/browser', express.json())

app.post('/api/browser/navigate', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.navigate(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

app.post('/api/browser/screenshot', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.screenshot(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

app.post('/api/browser/smartClick', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.smartClick(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

app.post('/api/browser/smartType', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.smartType(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

app.post('/api/browser/getInteractiveElements', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.getInteractiveElements(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

app.post('/api/browser/executeScript', async (req, res) => {
  try {
    if (!_browserTool) return res.json({ success: false, error: 'BrowserTool 未初始化' })
    const result = await _browserTool.executeScript(req.body)
    res.json(result)
  } catch (e) { res.json({ success: false, error: e.message }) }
})

// ========== Artifact API ==========
// 暴露产物管理能力给 react-engine
const artifactStore = require('./artifact-store')

app.use('/api/artifacts', express.json())

app.get('/api/artifacts/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 10
  res.json({ success: true, artifacts: artifactStore.getRecent(limit) })
})

app.get('/api/artifacts/search', (req, res) => {
  const keyword = req.query.q || ''
  const limit = parseInt(req.query.limit) || 10
  if (!keyword) return res.json({ success: false, error: '缺少 q 参数' })
  res.json({ success: true, artifacts: artifactStore.search(keyword, limit) })
})

app.get('/api/artifacts/session/:sessionId', (req, res) => {
  res.json({ success: true, artifacts: artifactStore.getBySession(req.params.sessionId) })
})

app.post('/api/artifacts/register', (req, res) => {
  const { filePath, type, description, command, sessionId } = req.body
  if (!filePath) return res.json({ success: false, error: '缺少 filePath' })
  const entry = artifactStore.register({ filePath, type, description, command, sessionId })
  res.json({ success: true, artifact: entry })
})

// 启动服务
function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[Muse Static Server] 🚀 服务已启动: http://localhost:${PORT} | 工作目录: ${WORKSPACE_DIR}`)
      resolve(server)
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // 端口已被占用，验证是否是本服务（发健康检查）
        const http = require('http')
        const checkReq = http.get(`http://127.0.0.1:${PORT}/health`, (checkRes) => {
          let body = ''
          checkRes.on('data', (chunk) => { body += chunk })
          checkRes.on('end', () => {
            try {
              const data = JSON.parse(body)
              if (data.status === 'ok') {
                console.log(`[Muse Static Server] ✅ 端口 ${PORT} 已由本服务占用，复用现有实例`)
                resolve(null)
                return
              }
            } catch {}
            console.error(`[Muse Static Server] ❌ 端口 ${PORT} 被其他进程占用且无法复用`)
            reject(new Error(`端口 ${PORT} 被其他进程占用`))
          })
        })
        checkReq.on('error', () => {
          console.error(`[Muse Static Server] ❌ 端口 ${PORT} 被其他进程占用`)
          reject(new Error(`端口 ${PORT} 被其他进程占用`))
        })
        checkReq.setTimeout(2000, () => {
          checkReq.destroy()
          reject(new Error(`端口 ${PORT} 被其他进程占用且健康检查超时`))
        })
      } else {
        reject(err)
      }
    })
  })
}

module.exports = { startServer, setBrowserTool, app, PORT, WORKSPACE_DIR }

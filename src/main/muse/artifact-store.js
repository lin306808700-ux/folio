'use strict'

/**
 * Artifact Store — 创作产物管理
 * 记录 Muse 每次工具任务生成的文件，支持检索/关联/追溯
 */

const fs = require('fs')
const path = require('path')

const MUSE_HOME = path.join(process.env.HOME, '.ai-terminal/muse')
const ARTIFACTS_FILE = path.join(MUSE_HOME, 'artifacts.json')

let _artifacts = []

function ensureDir() {
  if (!fs.existsSync(MUSE_HOME)) {
    fs.mkdirSync(MUSE_HOME, { recursive: true })
  }
}

function load() {
  try {
    if (fs.existsSync(ARTIFACTS_FILE)) {
      _artifacts = JSON.parse(fs.readFileSync(ARTIFACTS_FILE, 'utf-8'))
    }
  } catch {
    _artifacts = []
  }
}

function save() {
  ensureDir()
  fs.writeFileSync(ARTIFACTS_FILE, JSON.stringify(_artifacts, null, 2), 'utf-8')
}

/**
 * 注册一个创作产物
 * @param {object} artifact
 * @param {string} artifact.filePath - 文件绝对路径
 * @param {string} artifact.type - 类型：html/script/image/document/other
 * @param {string} artifact.description - 简要描述
 * @param {string} artifact.command - 来源命令（用户原始输入）
 * @param {string} artifact.sessionId - 所属工具会话 ID
 */
function register(artifact) {
  const entry = {
    id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    filePath: artifact.filePath,
    type: artifact.type || detectType(artifact.filePath),
    description: artifact.description || '',
    command: artifact.command || '',
    sessionId: artifact.sessionId || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  _artifacts.push(entry)

  // 保持最多 500 条
  if (_artifacts.length > 500) {
    _artifacts = _artifacts.slice(-500)
  }
  save()
  return entry
}

/**
 * 根据文件路径更新产物（用于修改场景）
 */
function updateByPath(filePath, updates) {
  const entry = _artifacts.find(a => a.filePath === filePath)
  if (entry) {
    Object.assign(entry, updates, { updatedAt: Date.now() })
    save()
  }
  return entry
}

/**
 * 搜索产物（模糊匹配描述和命令）
 */
function search(keyword, limit = 10) {
  const lower = keyword.toLowerCase()
  return _artifacts
    .filter(a => {
      return (a.description || '').toLowerCase().includes(lower) ||
        (a.command || '').toLowerCase().includes(lower) ||
        path.basename(a.filePath).toLowerCase().includes(lower)
    })
    .slice(-limit)
    .reverse()
}

/**
 * 获取最近的产物
 */
function getRecent(limit = 10) {
  return _artifacts.slice(-limit).reverse()
}

/**
 * 获取某次工具会话生成的所有产物
 */
function getBySession(sessionId) {
  return _artifacts.filter(a => a.sessionId === sessionId)
}

/**
 * 根据文件扩展名推断类型
 */
function detectType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const typeMap = {
    '.html': 'html', '.htm': 'html',
    '.js': 'script', '.ts': 'script', '.py': 'script', '.sh': 'script',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.svg': 'image', '.gif': 'image', '.webp': 'image',
    '.pdf': 'document', '.md': 'document', '.txt': 'document',
    '.pptx': 'document', '.docx': 'document', '.xlsx': 'document',
  }
  return typeMap[ext] || 'other'
}

// 启动时加载
load()

module.exports = { register, updateByPath, search, getRecent, getBySession, load }

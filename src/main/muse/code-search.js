'use strict'

/**
 * 代码检索模块
 * 
 * 为 Muse 提供渐进式代码检索能力：
 *   - grepCode: 在目录中搜索关键词/正则，返回匹配的文件路径和行号
 *   - globFiles: 按文件名模式匹配，返回文件路径列表
 *   - scanDirTree: 扫描目录树结构（带深度限制和过滤）
 *   - readFileSlice: 按需读取文件的指定行范围
 * 
 * 设计原则：
 *   - 轻量返回：搜索只返回路径和行号，不返回全部内容
 *   - 智能过滤：自动排除 node_modules、dist、.git 等无关目录
 *   - 结果限制：每次最多返回有限条结果，避免上下文爆炸
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// 默认排除的目录和文件
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', '.idea', '.vscode', '__pycache__',
  '.tox', 'venv', '.venv', 'env', '.env', 'vendor',
  '.DS_Store', 'thumbs.db', '.turbo', '.output'
])

const DEFAULT_IGNORE_EXTENSIONS = new Set([
  '.lock', '.log', '.map', '.min.js', '.min.css',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar',
  '.pyc', '.pyo', '.class', '.o', '.so', '.dll'
])

const MAX_GREP_RESULTS = 30
const MAX_GLOB_RESULTS = 50
const MAX_TREE_DEPTH = 4
const MAX_TREE_FILES = 200
const MAX_FILE_READ_LINES = 200

/**
 * 在目录中搜索关键词或正则表达式
 * 
 * @param {string} directory - 搜索的根目录
 * @param {string} pattern - 搜索关键词或正则表达式
 * @param {object} [options]
 * @param {string} [options.includePattern] - 文件名过滤（如 "*.js"）
 * @param {boolean} [options.caseSensitive=false] - 是否区分大小写
 * @param {number} [options.maxResults=MAX_GREP_RESULTS] - 最大结果数
 * @returns {{matches: Array<{file: string, line: number, content: string}>, totalMatches: number, truncated: boolean}}
 */
function grepCode(directory, pattern, options = {}) {
  const {
    includePattern,
    caseSensitive = false,
    maxResults = MAX_GREP_RESULTS
  } = options

  if (!fs.existsSync(directory)) {
    return { matches: [], totalMatches: 0, truncated: false, error: `目录不存在: ${directory}` }
  }

  try {
    // 构建 grep 命令
    const flags = caseSensitive ? '-Ern' : '-Erin'
    const excludeDirs = [...DEFAULT_IGNORE_DIRS].map(d => `--exclude-dir="${d}"`).join(' ')
    const excludeExts = [...DEFAULT_IGNORE_EXTENSIONS].map(e => `--exclude="*${e}"`).join(' ')
    const includeFlag = includePattern ? `--include="${includePattern}"` : ''

    // 转义 pattern 中的特殊 shell 字符
    const safePattern = pattern.replace(/'/g, "'\\''")

    const command = `grep ${flags} ${excludeDirs} ${excludeExts} ${includeFlag} -m ${maxResults * 2} '${safePattern}' "${directory}" 2>/dev/null | head -${maxResults * 2}`

    const output = execSync(command, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000
    }).trim()

    if (!output) {
      return { matches: [], totalMatches: 0, truncated: false }
    }

    const lines = output.split('\n')
    const matches = []

    for (const line of lines) {
      // grep 输出格式: file:line:content
      const firstColon = line.indexOf(':')
      if (firstColon === -1) continue
      const secondColon = line.indexOf(':', firstColon + 1)
      if (secondColon === -1) continue

      const file = line.slice(0, firstColon)
      const lineNum = parseInt(line.slice(firstColon + 1, secondColon), 10)
      const content = line.slice(secondColon + 1).trim()

      if (isNaN(lineNum)) continue

      // 转为相对路径
      const relativePath = path.relative(directory, file)

      matches.push({
        file: relativePath,
        line: lineNum,
        content: content.slice(0, 200) // 截断过长的行
      })

      if (matches.length >= maxResults) break
    }

    return {
      matches,
      totalMatches: lines.length,
      truncated: lines.length > maxResults
    }
  } catch (err) {
    // grep 没找到匹配时退出码为 1，不算错误
    if (err.status === 1) {
      return { matches: [], totalMatches: 0, truncated: false }
    }
    return { matches: [], totalMatches: 0, truncated: false, error: err.message }
  }
}

/**
 * 按文件名模式匹配文件
 * 
 * @param {string} directory - 搜索的根目录
 * @param {string} pattern - glob 模式（如 "*.tsx", "Login*", "*Controller.java"）
 * @param {object} [options]
 * @param {number} [options.maxResults=MAX_GLOB_RESULTS] - 最大结果数
 * @returns {{files: string[], totalFound: number, truncated: boolean}}
 */
function globFiles(directory, pattern, options = {}) {
  const { maxResults = MAX_GLOB_RESULTS } = options

  if (!fs.existsSync(directory)) {
    return { files: [], totalFound: 0, truncated: false, error: `目录不存在: ${directory}` }
  }

  try {
    // 构建 find 命令
    const excludeDirs = [...DEFAULT_IGNORE_DIRS].map(d => `-not -path "*/${d}/*"`).join(' ')
    const command = `find "${directory}" -type f -name "${pattern}" ${excludeDirs} 2>/dev/null | head -${maxResults * 2}`

    const output = execSync(command, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000
    }).trim()

    if (!output) {
      return { files: [], totalFound: 0, truncated: false }
    }

    const allFiles = output.split('\n').filter(Boolean)
    const files = allFiles.slice(0, maxResults).map(f => path.relative(directory, f))

    return {
      files,
      totalFound: allFiles.length,
      truncated: allFiles.length > maxResults
    }
  } catch (err) {
    return { files: [], totalFound: 0, truncated: false, error: err.message }
  }
}

/**
 * 扫描目录树结构
 * 
 * @param {string} directory - 根目录
 * @param {object} [options]
 * @param {number} [options.maxDepth=MAX_TREE_DEPTH] - 最大深度
 * @param {number} [options.maxFiles=MAX_TREE_FILES] - 最大文件数
 * @returns {{tree: string, fileCount: number, dirCount: number}}
 */
function scanDirTree(directory, options = {}) {
  const { maxDepth = MAX_TREE_DEPTH, maxFiles = MAX_TREE_FILES } = options

  if (!fs.existsSync(directory)) {
    return { tree: '', fileCount: 0, dirCount: 0, error: `目录不存在: ${directory}` }
  }

  const lines = []
  let fileCount = 0
  let dirCount = 0

  function walk(dir, depth, prefix) {
    if (depth > maxDepth || fileCount + dirCount > maxFiles) return

    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // 排序：目录在前，文件在后
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    // 过滤
    entries = entries.filter(e => {
      if (e.name.startsWith('.') && DEFAULT_IGNORE_DIRS.has(e.name.slice(1))) return false
      if (DEFAULT_IGNORE_DIRS.has(e.name)) return false
      if (!e.isDirectory()) {
        const ext = path.extname(e.name).toLowerCase()
        if (DEFAULT_IGNORE_EXTENSIONS.has(ext)) return false
      }
      return true
    })

    for (let i = 0; i < entries.length; i++) {
      if (fileCount + dirCount > maxFiles) {
        lines.push(`${prefix}... (已截断)`)
        break
      }

      const entry = entries[i]
      const isLast = i === entries.length - 1
      const connector = isLast ? '└── ' : '├── '
      const childPrefix = prefix + (isLast ? '    ' : '│   ')

      if (entry.isDirectory()) {
        dirCount++
        lines.push(`${prefix}${connector}${entry.name}/`)
        walk(path.join(dir, entry.name), depth + 1, childPrefix)
      } else {
        fileCount++
        lines.push(`${prefix}${connector}${entry.name}`)
      }
    }
  }

  lines.push(path.basename(directory) + '/')
  walk(directory, 0, '')

  return {
    tree: lines.join('\n'),
    fileCount,
    dirCount
  }
}

/**
 * 按需读取文件的指定行范围
 * 
 * @param {string} filePath - 文件绝对路径
 * @param {object} [options]
 * @param {number} [options.startLine=1] - 起始行号（从 1 开始）
 * @param {number} [options.endLine] - 结束行号（含），默认读 MAX_FILE_READ_LINES 行
 * @returns {{content: string, startLine: number, endLine: number, totalLines: number, truncated: boolean}}
 */
function readFileSlice(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    return { content: '', startLine: 0, endLine: 0, totalLines: 0, error: `文件不存在: ${filePath}` }
  }

  try {
    const fullContent = fs.readFileSync(filePath, 'utf8')
    const allLines = fullContent.split('\n')
    const totalLines = allLines.length

    const startLine = Math.max(1, options.startLine || 1)
    const endLine = Math.min(totalLines, options.endLine || (startLine + MAX_FILE_READ_LINES - 1))

    const slicedLines = allLines.slice(startLine - 1, endLine)
    const content = slicedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n')

    return {
      content,
      startLine,
      endLine,
      totalLines,
      truncated: endLine < totalLines
    }
  } catch (err) {
    return { content: '', startLine: 0, endLine: 0, totalLines: 0, error: err.message }
  }
}

/**
 * 格式化搜索结果为紧凑的上下文字符串（供 AI 消费）
 * 
 * @param {object} grepResult - grepCode 的返回值
 * @returns {string}
 */
function formatGrepResult(grepResult) {
  if (!grepResult.matches || grepResult.matches.length === 0) {
    return '未找到匹配结果'
  }

  // 按文件分组
  const byFile = {}
  for (const match of grepResult.matches) {
    if (!byFile[match.file]) byFile[match.file] = []
    byFile[match.file].push(match)
  }

  const lines = []
  for (const [file, matches] of Object.entries(byFile)) {
    lines.push(`📄 ${file} (${matches.length} 处匹配)`)
    for (const m of matches.slice(0, 5)) {
      lines.push(`  L${m.line}: ${m.content}`)
    }
    if (matches.length > 5) {
      lines.push(`  ... 还有 ${matches.length - 5} 处`)
    }
  }

  if (grepResult.truncated) {
    lines.push(`\n⚠️ 结果已截断，共 ${grepResult.totalMatches} 处匹配`)
  }

  return lines.join('\n')
}

/**
 * 格式化 glob 结果
 */
function formatGlobResult(globResult) {
  if (!globResult.files || globResult.files.length === 0) {
    return '未找到匹配文件'
  }

  const lines = globResult.files.map(f => `📄 ${f}`)
  if (globResult.truncated) {
    lines.push(`\n⚠️ 结果已截断，共 ${globResult.totalFound} 个文件`)
  }

  return lines.join('\n')
}

module.exports = {
  grepCode,
  globFiles,
  scanDirTree,
  readFileSlice,
  formatGrepResult,
  formatGlobResult,
  MAX_GREP_RESULTS,
  MAX_GLOB_RESULTS,
  MAX_TREE_DEPTH,
  MAX_FILE_READ_LINES
}

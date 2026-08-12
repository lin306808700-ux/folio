'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * 文件快照与回滚模块（轻量级）
 *
 * 核心思路：
 * 1. 从脚本内容中分析出即将被变更的文件路径
 * 2. 在脚本执行前，只备份这些文件（copy 到备份目录）
 * 3. 备份文件名带时间戳和原路径编码，回滚时直接 copy 回去
 *
 * 备份目录：~/.ai-terminal/snapshots/
 * 备份文件命名：{timestamp}_{encodedOriginalPath}
 * 元信息文件：{timestamp}_{scriptId}.meta.json
 */

const SNAPSHOTS_DIR = path.join(os.homedir(), '.ai-terminal', 'snapshots')
const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB，超过此大小的文件不备份
const MAX_SNAPSHOTS = 200               // 最多保留的元信息文件数

/**
 * 从脚本内容中提取即将被变更的文件路径
 * 通过正则匹配常见的文件写操作模式
 *
 * @param {string} scriptContent - 脚本内容
 * @param {string} lang - 脚本语言
 * @param {string} cwd - 工作目录
 * @returns {string[]} 绝对文件路径列表
 */
function extractTargetFiles(scriptContent, lang, cwd) {
  const filePaths = new Set()

  // Python 文件写操作
  // open('file', 'w'), open("file", "w"), Path('file').write_text(...)
  const pythonWritePatterns = [
    /open\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"][wWaA]/g,
    /open\s*\(\s*['"]([^'"]+)['"]\s*,\s*mode\s*=\s*['"][wWaA]/g,
    /\.write_text\s*\(/g,  // Path(...).write_text — 需要配合上下文
    /Path\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /with\s+open\s*\(\s*(?:os\.path\.join\s*\([^)]*['"]([^'"]+)['"]\s*\)|['"]([^'"]+)['"])\s*,\s*['"][wWaA]/g,
  ]

  // Shell/Bash 文件写操作
  // > file, >> file, tee file, cp ... dest, mv ... dest, sed -i file
  const shellWritePatterns = [
    /(?:>|>>)\s*['"]?([^\s'";&|]+)['"]?/g,
    /\btee\s+(?:-a\s+)?['"]?([^\s'";&|]+)['"]?/g,
    /\bcp\s+(?:-[a-zA-Z]*\s+)*\S+\s+['"]?([^\s'";&|]+)['"]?/g,
    /\bmv\s+(?:-[a-zA-Z]*\s+)*\S+\s+['"]?([^\s'";&|]+)['"]?/g,
    /\bsed\s+-i['".\s]*(?:['"][^'"]*['"]\s+)?['"]?([^\s'";&|]+)['"]?/g,
    /\brm\s+(?:-[a-zA-Z]*\s+)*['"]?([^\s'";&|]+)['"]?/g,
    /\bmkdir\s+(?:-[a-zA-Z]*\s+)*['"]?([^\s'";&|]+)['"]?/g,
    /\btouch\s+['"]?([^\s'";&|]+)['"]?/g,
    /\bchmod\s+\S+\s+['"]?([^\s'";&|]+)['"]?/g,
  ]

  // Node.js 文件写操作
  // fs.writeFileSync('file', ...), fs.writeFile('file', ...)
  const nodeWritePatterns = [
    /fs\.(?:writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|renameSync|rename|unlinkSync|unlink|mkdirSync|mkdir)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /fs\.(?:writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|renameSync|rename|unlinkSync|unlink|mkdirSync|mkdir)\s*\(\s*(?:path\.(?:join|resolve)\s*\([^)]*['"`]([^'"`]+)['"`])/g,
  ]

  // Ruby 文件写操作
  const rubyWritePatterns = [
    /File\.(?:write|open)\s*\(\s*['"]([^'"]+)['"]/g,
  ]

  // 通用：所有语言都可能用的重定向和路径
  const universalPatterns = [
    // 直接的文件路径字符串（启发式：看起来像文件路径的字符串）
    /['"`]((?:\.\/|\.\.\/|\/)[^\s'"`*?]+\.[a-zA-Z0-9]+)['"`]/g,
  ]

  let patterns = [...universalPatterns]
  switch (lang) {
    case 'python':
    case 'py':
      patterns = [...pythonWritePatterns, ...patterns]
      break
    case 'sh':
    case 'bash':
      patterns = [...shellWritePatterns, ...patterns]
      break
    case 'node':
    case 'js':
    case 'javascript':
      patterns = [...nodeWritePatterns, ...patterns]
      break
    case 'ruby':
    case 'rb':
      patterns = [...rubyWritePatterns, ...patterns]
      break
    default:
      // 对未知语言，尝试所有模式
      patterns = [...pythonWritePatterns, ...shellWritePatterns, ...nodeWritePatterns, ...rubyWritePatterns, ...patterns]
  }

  for (const pattern of patterns) {
    let match
    // 重置 lastIndex（正则可能被复用）
    pattern.lastIndex = 0
    while ((match = pattern.exec(scriptContent)) !== null) {
      // 取第一个非空捕获组
      const captured = match[1] || match[2] || match[3]
      if (!captured) continue

      // 过滤掉明显不是文件路径的
      if (captured.includes('*') || captured.includes('?')) continue

      // 解析为绝对路径
      const absPath = path.isAbsolute(captured) ? captured : path.resolve(cwd, captured)
      filePaths.add(absPath)
    }
  }

  return Array.from(filePaths)
}

/**
 * 将原始文件路径编码为安全的文件名
 * 用 __ 替换路径分隔符
 */
function encodePathForFilename(filePath) {
  return filePath.replace(/\//g, '__').replace(/^__/, '')
}

/**
 * 从编码的文件名还原原始路径
 */
function decodePathFromFilename(encoded) {
  return '/' + encoded.replace(/__/g, '/')
}

/**
 * 在脚本执行前，备份即将被变更的文件
 *
 * @param {string} scriptContent - 脚本内容
 * @param {string} lang - 脚本语言
 * @param {string} cwd - 工作目录
 * @param {object} meta - 元信息
 * @param {string} meta.scriptId - 脚本标识（filename）
 * @param {string} meta.description - 脚本描述
 * @param {string[]} [meta.targetFiles] - AI 声明的目标文件列表（优先使用）
 * @returns {object} 快照信息
 */
function backupBeforeExecution(scriptContent, lang, cwd, meta) {
  const timestamp = Date.now()

  // 优先使用 AI 声明的 targetFiles，兜底用正则提取
  let aiDeclaredFiles = []
  if (Array.isArray(meta.targetFiles) && meta.targetFiles.length > 0) {
    aiDeclaredFiles = meta.targetFiles.map(f => path.isAbsolute(f) ? f : path.resolve(cwd, f))
    console.log(`[FileSnapshot] AI 声明了 ${aiDeclaredFiles.length} 个目标文件`)
  }
  const regexExtractedFiles = extractTargetFiles(scriptContent, lang, cwd)
  
  // 合并去重
  const targetFiles = [...new Set([...aiDeclaredFiles, ...regexExtractedFiles])]

  if (targetFiles.length === 0) {
    console.log('[FileSnapshot] 未检测到文件写操作，跳过备份')
    return { snapshotId: null, timestamp, backedUpFiles: [], targetFiles: [] }
  }

  // 确保备份目录存在
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true })

  const backedUpFiles = []
  const snapshotId = `${timestamp}_${meta.scriptId.replace(/[^a-zA-Z0-9_.-]/g, '_')}`

  for (const filePath of targetFiles) {
    try {
      if (!fs.existsSync(filePath)) {
        // 文件不存在 → 标记为"将被新建"，回滚时删除
        backedUpFiles.push({
          originalPath: filePath,
          backupFile: null,
          type: 'will_create'
        })
        continue
      }

      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) continue

      // 备份文件：{timestamp}_{encodedPath}
      const encodedPath = encodePathForFilename(filePath)
      const backupFilename = `${timestamp}_${encodedPath}`
      const backupPath = path.join(SNAPSHOTS_DIR, backupFilename)

      fs.copyFileSync(filePath, backupPath)
      backedUpFiles.push({
        originalPath: filePath,
        backupFile: backupFilename,
        type: 'existing'
      })

      console.log(`[FileSnapshot] 已备份: ${filePath}`)
    } catch (err) {
      console.warn(`[FileSnapshot] 备份失败 ${filePath}:`, err.message)
    }
  }

  // 写入元信息文件
  const metaData = {
    snapshotId,
    timestamp,
    scriptId: meta.scriptId,
    description: meta.description,
    cwd,
    backedUpFiles,
    targetFiles
  }

  const metaPath = path.join(SNAPSHOTS_DIR, `${snapshotId}.meta.json`)
  fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2))

  console.log(`[FileSnapshot] 备份完成: ${backedUpFiles.length} 个文件, snapshotId=${snapshotId}`)

  // 清理旧快照
  cleanupOldSnapshots()

  return metaData
}

/**
 * 获取所有快照列表（按时间倒序）
 */
function listSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return []

  const snapshots = []
  try {
    const files = fs.readdirSync(SNAPSHOTS_DIR)
    for (const file of files) {
      if (!file.endsWith('.meta.json')) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, file), 'utf-8'))
        snapshots.push(meta)
      } catch {
        // 损坏的元信息，跳过
      }
    }
  } catch {
    return []
  }

  snapshots.sort((a, b) => b.timestamp - a.timestamp)
  return snapshots
}

/**
 * 回滚单个快照
 * 将备份文件 copy 回原位，新建的文件删除
 *
 * @param {string} snapshotId
 * @returns {{ success: boolean, restored: string[], removed: string[], errors: string[] }}
 */
function rollbackSnapshot(snapshotId) {
  const snapshots = listSnapshots()
  const snapshot = snapshots.find(s => s.snapshotId === snapshotId)
  if (!snapshot) {
    return { success: false, restored: [], removed: [], errors: ['快照不存在'] }
  }

  const restored = []
  const removed = []
  const errors = []

  for (const fileInfo of snapshot.backedUpFiles) {
    try {
      if (fileInfo.type === 'existing' && fileInfo.backupFile) {
        // 恢复备份文件到原位
        const backupPath = path.join(SNAPSHOTS_DIR, fileInfo.backupFile)
        if (fs.existsSync(backupPath)) {
          fs.mkdirSync(path.dirname(fileInfo.originalPath), { recursive: true })
          fs.copyFileSync(backupPath, fileInfo.originalPath)
          fs.unlinkSync(backupPath)  // 恢复后删除备份
          restored.push(fileInfo.originalPath)
        }
      } else if (fileInfo.type === 'will_create') {
        // 删除脚本新建的文件
        if (fs.existsSync(fileInfo.originalPath)) {
          fs.unlinkSync(fileInfo.originalPath)
          removed.push(fileInfo.originalPath)
        }
      }
    } catch (err) {
      errors.push(`${fileInfo.originalPath}: ${err.message}`)
    }
  }

  // 删除元信息文件
  try {
    const metaPath = path.join(SNAPSHOTS_DIR, `${snapshotId}.meta.json`)
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
  } catch {
    // 忽略
  }

  console.log(`[FileSnapshot] 回滚完成 ${snapshotId}:`, { restored: restored.length, removed: removed.length, errors: errors.length })
  return { success: errors.length === 0, restored, removed, errors }
}

/**
 * 回滚到指定时间点
 * 将该时间点之后的所有快照按时间倒序逐个回滚
 */
function rollbackToTimestamp(targetTimestamp) {
  const allSnapshots = listSnapshots()
  const snapshotsToRollback = allSnapshots.filter(s => s.timestamp > targetTimestamp)

  if (snapshotsToRollback.length === 0) {
    return { success: true, rolledBack: 0, details: [], message: '没有需要回滚的快照' }
  }

  console.log(`[FileSnapshot] 回滚到 ${new Date(targetTimestamp).toLocaleString()}: ${snapshotsToRollback.length} 个快照`)

  const details = []
  for (const snapshot of snapshotsToRollback) {
    const result = rollbackSnapshot(snapshot.snapshotId)
    details.push({ snapshotId: snapshot.snapshotId, description: snapshot.description, timestamp: snapshot.timestamp, ...result })
  }

  return {
    success: details.every(d => d.success),
    rolledBack: snapshotsToRollback.length,
    details
  }
}

/**
 * 清理旧快照
 */
function cleanupOldSnapshots() {
  const snapshots = listSnapshots()
  if (snapshots.length <= MAX_SNAPSHOTS) return

  const toDelete = snapshots.slice(MAX_SNAPSHOTS)
  for (const snapshot of toDelete) {
    // 删除备份文件
    for (const fileInfo of snapshot.backedUpFiles) {
      if (fileInfo.backupFile) {
        try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, fileInfo.backupFile)) } catch { /* ignore */ }
      }
    }
    // 删除元信息
    try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, `${snapshot.snapshotId}.meta.json`)) } catch { /* ignore */ }
  }
}

/**
 * 删除指定快照
 */
function deleteSnapshot(snapshotId) {
  const snapshots = listSnapshots()
  const snapshot = snapshots.find(s => s.snapshotId === snapshotId)
  if (!snapshot) return false

  for (const fileInfo of snapshot.backedUpFiles) {
    if (fileInfo.backupFile) {
      try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, fileInfo.backupFile)) } catch { /* ignore */ }
    }
  }
  try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, `${snapshotId}.meta.json`)) } catch { /* ignore */ }
  return true
}

module.exports = {
  extractTargetFiles,
  backupBeforeExecution,
  listSnapshots,
  rollbackSnapshot,
  rollbackToTimestamp,
  deleteSnapshot,
  SNAPSHOTS_DIR
}
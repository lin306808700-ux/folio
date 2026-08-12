'use strict'

/**
 * 上下文管理 - 简化策略
 * - 首次启动时加载一次完整上下文
 * - 后续对话不再重复加载，保持 Prompt 精简
 */

const fs = require('fs')
const path = require('path')
const { WORKSPACE_DIR, PROFILE_DIR } = require('./config')

// 延迟加载，避免循环依赖
let MemorySummary = null
let Memories = null
let History = null
let Ideas = null

function loadModules() {
  if (!MemorySummary) {
    const db = require('../database')
    MemorySummary = db.MemorySummary
    Memories = db.Memories
    History = db.History
    Ideas = db.Ideas
  }
}

// 缓存首次加载的上下文
let cachedContext = null

// Muse 专用固定 sessionId（复用同一个会话）
let museSessionId = null

function generateMuseSessionId() {
  if (!museSessionId) {
    museSessionId = `muse_${Date.now()}`
    console.log('[Muse] 🆔 生成固定 sessionId:', museSessionId)
  }
  return museSessionId
}

/**
 * 首次启动时加载完整上下文（仅调用一次）
 */
function loadInitialContext() {
  if (cachedContext) {
    return cachedContext
  }

  loadModules()
  
  const context = {
    workspace: WORKSPACE_DIR,
    timestamp: new Date().toISOString()
  }

  // 工作区信息
  try {
    const files = fs.readdirSync(WORKSPACE_DIR).filter(f => !f.startsWith('.'))
    context.workspaceFiles = files.slice(0, 20) // 最多20个文件
  } catch {
    context.workspaceFiles = []
  }

  // 记忆摘要（最近5条）
  try {
    const summaries = MemorySummary.getActive()
    context.memories = summaries.slice(0, 5).map(s => s.summary).join('\n\n')
  } catch {
    context.memories = ''
  }

  // 可用技能（扫描多个目录：ai-terminal 自有 + Claude skills）
  try {
    const skillsDirs = [
      path.join(process.env.HOME, '.ai-terminal/skills'),
      path.join(process.env.HOME, '.claude/skills')
    ]
    const allSkills = [] // { name, dir, description, usage }
    const seenNames = new Set()
    for (const skillsDir of skillsDirs) {
      if (!fs.existsSync(skillsDir)) continue
      const entries = fs.readdirSync(skillsDir).filter(f => !f.startsWith('.') && f !== 'node_modules')
      for (const entry of entries) {
        // 支持两种技能格式：
        // 1. 目录技能：skills/aiway/SKILL.md
        // 2. 单文件技能：skills/aiway.md
        const entryPath = path.join(skillsDir, entry)
        const isSingleFile = entry.endsWith('.md') && fs.statSync(entryPath).isFile()
        const skillName = isSingleFile ? entry.replace(/\.md$/, '') : entry

        if (seenNames.has(skillName)) continue
        seenNames.add(skillName)

        const skillInfo = { name: skillName, dir: entryPath, description: '', usage: '', credentialPaths: [] }

        // 读取技能内容
        const skillMdPath = isSingleFile ? entryPath : path.join(entryPath, 'SKILL.md')
        if (fs.existsSync(skillMdPath)) {
          try {
            const content = fs.readFileSync(skillMdPath, 'utf8')
            const descMatch = content.match(/description:\s*(.+)/i)
            if (descMatch) skillInfo.description = descMatch[1].trim().slice(0, 100)
            skillInfo.usage = content.split('\n').slice(0, 500).join('\n')

            // 探测凭证文件的实际绝对路径，注入给 AI 避免路径猜测错误
            const credentialCandidatePatterns = content.match(/`([^`]*credentials[^`]*\.json)`/gi) || []
            const candidatePaths = credentialCandidatePatterns
              .map(m => m.replace(/`/g, '').trim())
              .map(p => p.startsWith('~') ? path.join(process.env.HOME, p.slice(1)) : p)
              .filter(p => path.isAbsolute(p))
            // 也检查技能目录下的 credentials.json
            const skillDirCred = isSingleFile
              ? path.join(path.dirname(entryPath), skillName, 'credentials.json')
              : path.join(entryPath, 'credentials.json')
            const homeCred = path.join(process.env.HOME, `.${skillName}`, 'credentials.json')
            for (const credPath of [...candidatePaths, skillDirCred, homeCred]) {
              if (fs.existsSync(credPath) && !skillInfo.credentialPaths.includes(credPath)) {
                skillInfo.credentialPaths.push(credPath)
              }
            }
          } catch {}
        }

        allSkills.push(skillInfo)
      }
    }
    const skillsList = allSkills.slice(0, 20)
    // 格式化为字符串，包含路径和使用说明供 AI 使用
    if (skillsList.length > 0) {
      context.skills = '【可用技能】\n' + skillsList.map(s => {
        let entry = `- ${s.name} (路径: ${s.dir})${s.description ? ' — ' + s.description : ''}`
        if (s.credentialPaths && s.credentialPaths.length > 0) {
          entry += `\n  ⚠️ 凭证文件绝对路径（直接使用，勿用相对路径）: ${s.credentialPaths.join(', ')}`
        }
        if (s.usage) entry += `\n  使用说明:\n${s.usage.split('\n').map(l => '  ' + l).join('\n')}`
        return entry
      }).join('\n\n')
    } else {
      context.skills = ''
    }
  } catch {
    context.skills = ''
  }

  // 主人画像
  try {
    const profileFiles = fs.readdirSync(PROFILE_DIR).filter(f => f.endsWith('.md'))
    // 按修改时间倒序，取最近的画像文件
    const sortedFiles = profileFiles
      .map(f => ({ name: f, mtime: fs.statSync(path.join(PROFILE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5)
    const profiles = []
    for (const { name: file } of sortedFiles) {
      const filePath = path.join(PROFILE_DIR, file)
      const content = fs.readFileSync(filePath, 'utf8').trim()
      if (!content) continue
      // 内容本身已带 [YYYY-MM-DD] 日期前缀，直接保留
      profiles.push(`【${file.replace('.md', '')}】\n${content.slice(0, 400)}`)
    }
    context.profile = '以下是主人的长期画像（历史积累的认知，非实时任务状态，每段信息前的日期表示记录时间）：\n\n' + profiles.join('\n\n')
  } catch {
    context.profile = ''
  }

  // 可用系统工具
  try {
    const commonTools = [
      'python3', 'node', 'npm', 'npx',
      'git', 'curl', 'wget',
      'grep', 'awk', 'sed',
      'find', 'ls', 'cat', 'mkdir', 'cp', 'mv', 'rm',
      'ffmpeg', 'convert', 'magick',
      'jq', 'sqlite3'
    ]
    
    const availableTools = []
    for (const tool of commonTools) {
      try {
        require('child_process').execSync(`which ${tool}`, { stdio: 'pipe' })
        availableTools.push(tool)
      } catch {}
    }
    context.systemTools = availableTools.slice(0, 15)
  } catch {
    context.systemTools = []
  }

  // 活跃目标（top 3）
  try {
    const { getActiveGoals } = require('./goals')
    const goals = getActiveGoals().slice(0, 3)
    if (goals.length > 0) {
      context.goals = goals.map(g => {
        const steps = g.exploreSteps || []
        const completed = steps.filter(s => s.status === 'completed').length
        return `- ${g.title}（方向: ${g.direction}，进度: ${completed}/${steps.length}）`
      }).join('\n')
    } else {
      context.goals = ''
    }
  } catch {
    context.goals = ''
  }

  // 自主等级
  try {
    const { getState } = require('./autonomy')
    const autoState = getState()
    context.autonomyLevel = autoState.level
    context.autonomyName = autoState.levelName
    context.domainCoverage = autoState.metrics?.domainCoverage || []
  } catch {
    context.autonomyLevel = 0
    context.domainCoverage = []
  }

  cachedContext = context
  console.log('[Muse] ✅ 初始上下文已加载（仅一次）')
  return context
}

/**
 * 获取轻量级上下文（后续对话使用，仅包含任务信息）
 */
function getMinimalContext(taskInfo = {}) {
  return {
    workspace: WORKSPACE_DIR,
    timestamp: new Date().toISOString(),
    ...taskInfo
  }
}

/**
 * 兼容旧接口：首次调用加载完整上下文，后续返回缓存
 */
function gatherOwnerContext() {
  return loadInitialContext()
}

function clearContextCache() {
  cachedContext = null
  console.log('[Muse] 🔄 上下文缓存已清除，下次调用将重新加载')
}

module.exports = {
  loadInitialContext,
  getMinimalContext,
  gatherOwnerContext,
  clearContextCache,
  getMuseSessionId: generateMuseSessionId
}

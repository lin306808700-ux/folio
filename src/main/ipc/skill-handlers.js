'use strict'

const axios = require('axios')
const path = require('path')
const fs = require('fs')
const { Skills } = require('../database')

function register(ipcMain) {
  // 技能矩阵 CRUD
  ipcMain.handle('db:skills:getAll', () => Skills.getAll())
  ipcMain.handle('db:skills:add', (event, item) => Skills.add(item))
  ipcMain.handle('db:skills:update', (event, { id, item }) => {
    console.log('[IPC] db:skills:update 被调用, ID:', id, '数据:', item)
    const result = Skills.update(id, item)
    console.log('[IPC] db:skills:update 结果:', result)
    return result
  })
  ipcMain.handle('db:skills:delete', (event, id) => Skills.delete(id))

  // 从文件系统加载技能
  ipcMain.handle('db:skills:getAllFiles', () => Skills.getAllFiles())
  ipcMain.handle('db:skills:loadFromFile', (event, filename) => Skills.loadFromFile(filename))

  // 从 URL 安装技能
  ipcMain.handle('skills:install', async (event, { url, skillName }) => {
    console.log('[Main] 安装技能请求:', { url, skillName })

    try {
      let rawUrl = url.trim()

      console.log('[Main] 原始 URL:', rawUrl)

      // 如果是 github.com 链接，转换为 raw
      if (rawUrl.includes('github.com')) {
        rawUrl = rawUrl.replace(/\/$/, '')

        let branch = 'main'

        if (rawUrl.includes('/blob/')) {
          const match = rawUrl.match(/\/blob\/([^\/]+)/)
          if (match) branch = match[1]
          rawUrl = rawUrl.replace('/blob/', '/')
        } else if (rawUrl.includes('/tree/')) {
          const match = rawUrl.match(/\/tree\/([^\/]+)/)
          if (match) branch = match[1]
          rawUrl = rawUrl.replace('/tree/', '/')
        } else {
          rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com')
          rawUrl = `${rawUrl}/${branch}`
        }

        if (!rawUrl.includes('raw.githubusercontent.com')) {
          rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com')
        }

        console.log('[Main] 转换后 URL:', rawUrl)
        console.log('[Main] 使用分支:', branch)
      }

      if (skillName) {
        if (!rawUrl.endsWith('/')) rawUrl += '/'
        rawUrl = `${rawUrl}${skillName}.json`
      } else {
        if (!rawUrl.endsWith('.json')) rawUrl += '.json'
      }

      console.log('[Main] 最终下载 URL:', rawUrl)

      const response = await axios.get(rawUrl, {
        timeout: 30000,
        headers: { 'User-Agent': 'AI-Terminal-Skill-Installer' }
      })

      console.log('[Main] 下载成功，响应状态:', response.status)
      console.log('[Main] 响应数据:', JSON.stringify(response.data).substring(0, 200))

      const skillConfig = response.data

      if (!skillConfig || typeof skillConfig !== 'object') {
        throw new Error('技能配置不是有效的 JSON 对象')
      }
      if (!skillConfig.name) throw new Error('技能配置缺少 name 字段')
      if (!skillConfig.prompt) throw new Error('技能配置缺少 prompt 字段')

      const newSkill = Skills.add({
        name: skillConfig.name,
        description: skillConfig.description || '',
        prompt: skillConfig.prompt,
        icon: skillConfig.icon || 'Zap'
      })

      console.log('[Main] 技能安装成功:', newSkill.name)
      return { success: true, skill: newSkill }
    } catch (error) {
      console.error('[Main] 技能安装失败:', error.message)
      console.error('[Main] 错误详情:', error.response?.status, error.response?.statusText)

      let errorMsg = '技能安装失败'
      if (error.response) {
        errorMsg = `HTTP ${error.response.status}: ${error.response.statusText || '请求失败'}`
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = '无法连接到服务器，请检查 URL 是否正确'
      } else if (error.message.includes('JSON')) {
        errorMsg = '技能配置格式错误: ' + error.message
      } else {
        errorMsg = error.message
      }

      return { success: false, error: errorMsg }
    }
  })

  // 本地保存技能（支持关联脚本文件）
  ipcMain.handle('skill:saveLocal', async (event, { name, description, content, scriptFile }) => {
    console.log('[Main] 本地保存技能:', name, scriptFile ? `(关联脚本: ${scriptFile})` : '')
    try {
      if (!name || !content) {
        throw new Error('技能必须包含 name 和 content 字段')
      }
      const newSkill = Skills.add({
        name,
        description: description || '',
        content
      })

      // 如果有关联脚本文件，复制到技能目录
      // 使用 Skills 模块的 _ensureSkillsDir() 获取正确的技能根目录（~/.ai-terminal/skills/）
      if (scriptFile && fs.existsSync(scriptFile)) {
        const skillsDir = Skills._ensureSkillsDir()
        const skillDir = path.join(skillsDir, newSkill.id)
        if (!fs.existsSync(skillDir)) {
          fs.mkdirSync(skillDir, { recursive: true })
        }
        const ext = path.extname(scriptFile)
        const destPath = path.join(skillDir, `script${ext}`)
        fs.copyFileSync(scriptFile, destPath)
        console.log('[Main] 脚本已复制到技能目录:', destPath)
      }

      console.log('[Main] 技能保存成功:', newSkill.name)
      return { success: true, skill: newSkill }
    } catch (error) {
      console.error('[Main] 技能保存失败:', error.message)
      return { success: false, error: error.message }
    }
  })


  // 选择 zip 文件（通过系统对话框）
  ipcMain.handle('skills:selectZipFile', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      title: '选择技能 zip 文件',
      filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true }
    }
    return { success: true, filePath: result.filePaths[0] }
  })

  // 从 zip 文件安装技能
  ipcMain.handle('skills:installFromZip', async (event, { zipPath }) => {
    console.log('[Main] 从 zip 安装技能:', zipPath)
    const { execSync } = require('child_process')
    const os = require('os')

    try {
      if (!zipPath || !fs.existsSync(zipPath)) {
        throw new Error('zip 文件不存在: ' + zipPath)
      }

      // 解压到临时目录
      const tmpDir = path.join(os.tmpdir(), `skill-zip-${Date.now()}`)
      fs.mkdirSync(tmpDir, { recursive: true })

      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' })

      // 查找 SKILL.md（支持根目录或子目录内）
      let skillMdPath = null
      let skillSourceDir = null

      const topEntries = fs.readdirSync(tmpDir, { withFileTypes: true })

      // 优先检查子目录中的 SKILL.md
      for (const entry of topEntries) {
        if (entry.isDirectory()) {
          const candidate = path.join(tmpDir, entry.name, 'SKILL.md')
          if (fs.existsSync(candidate)) {
            skillMdPath = candidate
            skillSourceDir = path.join(tmpDir, entry.name)
            break
          }
        }
      }

      // 再检查根目录
      if (!skillMdPath) {
        const rootCandidate = path.join(tmpDir, 'SKILL.md')
        if (fs.existsSync(rootCandidate)) {
          skillMdPath = rootCandidate
          skillSourceDir = tmpDir
        }
      }

      if (!skillMdPath) {
        // 清理临时目录
        fs.rmSync(tmpDir, { recursive: true, force: true })
        throw new Error('zip 中未找到 SKILL.md 文件')
      }

      // 解析 SKILL.md 获取技能名称
      const { parseFrontmatter } = require('../skill-schema')
      const fileContent = fs.readFileSync(skillMdPath, 'utf-8')
      const { meta } = parseFrontmatter(fileContent)

      // 用 frontmatter 的 name 或 zip 文件名作为目录名
      const skillId = meta.name
        ? meta.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
        : path.basename(zipPath, '.zip')

      // 复制到 skills 目录
      const skillsDir = Skills._ensureSkillsDir()
      const destDir = path.join(skillsDir, skillId)

      // 如果已存在则先删除（覆盖安装）
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }

      // 递归复制整个技能目录
      const copyDirRecursive = (src, dest) => {
        fs.mkdirSync(dest, { recursive: true })
        const entries = fs.readdirSync(src, { withFileTypes: true })
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name)
          const destPath = path.join(dest, entry.name)
          if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath)
          } else {
            fs.copyFileSync(srcPath, destPath)
          }
        }
      }

      copyDirRecursive(skillSourceDir, destDir)

      // 清理临时目录
      fs.rmSync(tmpDir, { recursive: true, force: true })

      // 刷新缓存
      Skills.invalidateCache()

      const installedSkill = Skills.loadFromDir(skillId)
      console.log('[Main] zip 技能安装成功:', installedSkill?.name || skillId)

      return { success: true, skill: installedSkill || { id: skillId, name: meta.name || skillId } }
    } catch (error) {
      console.error('[Main] zip 技能安装失败:', error.message)
      return { success: false, error: error.message }
    }
  })

  // AI 对话式创建技能
  ipcMain.handle('skill:create', async (event, { description, empId }) => {
    try {
      const { createSkillFromDescription } = require('../muse/skill-creator')
      const result = await createSkillFromDescription(description, { empId })
      if (result.success) Skills.invalidateCache()
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // AI 推荐匹配技能
  ipcMain.handle('skill:suggest', async (event, { userInput, empId }) => {
    try {
      const { suggestSkills } = require('../muse/skill-creator')
      const availableSkills = Skills.getAll()
      return await suggestSkills(userInput, availableSkills, { empId })
    } catch (error) {
      return { suggestions: [] }
    }
  })

  // 技能使用统计
  ipcMain.handle('skill:stats', (event, skillId) => {
    try {
      const { getSkillStats, getTopSkills } = require('../muse/skill-creator')
      if (skillId) return { success: true, data: getSkillStats(skillId) }
      return { success: true, data: getSkillStats(), top: getTopSkills(10) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 记录技能激活
  ipcMain.handle('skill:recordUsage', (event, { skillId, success }) => {
    try {
      const { recordSkillUsage } = require('../muse/skill-creator')
      recordSkillUsage(skillId, success !== false)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 启用/禁用技能
  ipcMain.handle('skill:setEnabled', (event, { id, enabled }) => {
    try {
      const result = Skills.setEnabled(id, enabled)
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 技能健康检查
  ipcMain.handle('skill:healthCheck', (event, skillId) => {
    try {
      return { success: true, data: Skills.healthCheck(skillId) }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 全量健康报告
  ipcMain.handle('skill:healthReport', () => {
    try {
      return { success: true, data: Skills.healthReport() }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 技能依赖验证
  ipcMain.handle('skill:checkDependencies', (event, skillId) => {
    try {
      const skill = Skills.loadFromDir(skillId)
      if (!skill) return { success: false, error: '技能不存在' }

      const issues = []
      if (skill.depends && skill.depends.length > 0) {
        for (const depId of skill.depends) {
          const dep = Skills.loadFromDir(depId)
          if (!dep) {
            issues.push({ type: 'missing', skill: depId, message: `依赖技能 ${depId} 未安装` })
          } else if (dep.enabled === false) {
            issues.push({ type: 'disabled', skill: depId, message: `依赖技能 ${depId} 已被禁用` })
          }
        }
      }

      // 检测循环依赖
      const visited = new Set()
      const checkCircular = (id, path) => {
        if (path.includes(id)) {
          issues.push({ type: 'circular', skill: id, message: `检测到循环依赖: ${path.join(' → ')} → ${id}` })
          return true
        }
        if (visited.has(id)) return false
        visited.add(id)
        path.push(id)

        const s = Skills.loadFromDir(id)
        if (s && s.depends) {
          for (const depId of s.depends) {
            if (checkCircular(depId, [...path])) return true
          }
        }
        return false
      }
      checkCircular(skillId, [])

      return { success: true, data: { issues, healthy: issues.length === 0 } }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 导出技能为 zip
  ipcMain.handle('skill:export', async (event, { skillId }) => {
    const { dialog } = require('electron')
    const { execSync } = require('child_process')
    const os = require('os')

    try {
      const skill = Skills.loadFromDir(skillId)
      if (!skill) return { success: false, error: '技能不存在' }

      // 选择保存位置
      const result = await dialog.showSaveDialog({
        title: '导出技能',
        defaultPath: `${skillId}.zip`,
        filters: [{ name: 'ZIP 文件', extensions: ['zip'] }],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      const skillsDir = Skills._ensureSkillsDir()
      const skillDir = path.join(skillsDir, skillId)

      // 使用系统 zip 命令打包
      execSync(`cd "${skillsDir}" && zip -r "${result.filePath}" "${skillId}/"`, { stdio: 'pipe' })

      console.log('[Main] 技能已导出:', result.filePath)
      return { success: true, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { register }

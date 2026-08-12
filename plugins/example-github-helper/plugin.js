'use strict'

/**
 * 示例插件：GitHub 助手
 *
 * 演示插件系统的三种核心能力：
 * 1. contextProvider — 当用户提到 GitHub / PR / Issue 时注入上下文
 * 2. tools — 注册自定义工具供 ReAct 引擎调用
 * 3. hooks — 在技能执行前/后注入逻辑
 */

const { execSync } = require('child_process')
const path = require('path')

module.exports = {
  name: 'example-github-helper',
  version: '1.0.0',
  description: 'GitHub 工作流辅助插件：提供 PR 检查、Issue 搜索、仓库分析等工具',
  author: 'Muse AI-Terminal',
  priority: 10,

  // 触发词：当用户输入匹配这些词时，contextProvider 被调用
  triggers: ['github', 'git', 'pr', 'pull request', 'issue', 'merge', 'commit'],

  // ========== 生命周期 ==========

  onLoad(context) {
    context.logger.log('[GitHub Helper] 插件已加载')
    this._context = context
  },

  onUnload() {
    console.log('[GitHub Helper] 插件已卸载')
  },

  // ========== 工具注册 ==========

  tools: {
    'gh-check-pr': {
      description: '检查当前仓库的 PR 状态（需要 gh CLI）',
      params: {
        prNumber: { type: 'number', required: false, description: 'PR 编号，不传则检查最新 PR' },
      },
      async execute(params, context) {
        try {
          const cmd = params.prNumber
            ? `gh pr view ${params.prNumber} --json title,state,author,additions,deletions,reviews`
            : `gh pr list --limit 5 --json number,title,state,author`

          const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 })
          const data = JSON.parse(output)

          return {
            success: true,
            data: { prs: data },
            needConfirm: false,
          }
        } catch (error) {
          return {
            success: false,
            error: `gh 命令执行失败: ${error.message}。请确保已安装 gh CLI 并登录。`,
            needConfirm: false,
          }
        }
      },
    },

    'gh-search-issue': {
      description: '搜索 GitHub Issue',
      params: {
        keyword: { type: 'string', required: true, description: '搜索关键词' },
        repo: { type: 'string', required: false, description: '仓库名（owner/repo），不传则搜索当前仓库' },
      },
      async execute(params, context) {
        try {
          const repoFlag = params.repo ? `-R ${params.repo}` : ''
          const cmd = `gh issue list ${repoFlag} --search "${params.keyword}" --limit 10 --json number,title,state,author`

          const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 })
          const data = JSON.parse(output)

          return {
            success: true,
            data: { issues: data },
            needConfirm: false,
          }
        } catch (error) {
          return {
            success: false,
            error: `搜索失败: ${error.message}`,
            needConfirm: false,
          }
        }
      },
    },

    'gh-repo-stats': {
      description: '获取仓库统计信息（star、fork、open issues）',
      params: {
        repo: { type: 'string', required: true, description: '仓库名（owner/repo）' },
      },
      async execute(params, context) {
        try {
          const cmd = `gh repo view ${params.repo} --json name,description,stargazerCount,forkCount,issues,pullRequests`
          const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000 })
          const data = JSON.parse(output)

          return {
            success: true,
            data: { repo: data },
            needConfirm: false,
          }
        } catch (error) {
          return {
            success: false,
            error: `获取仓库信息失败: ${error.message}`,
            needConfirm: false,
          }
        }
      },
    },
  },

  // ========== 钩子 ==========

  hooks: {
    // 在技能执行前，如果用户在 git 仓库中，注入仓库信息
    async beforeSkillExecute(skill, params) {
      try {
        const cwd = process.cwd()
        const isGitRepo = execSync('git rev-parse --is-inside-work-tree 2>/dev/null', {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim()

        if (isGitRepo === 'true') {
          const branch = execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim()
          const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim()
          params._gitContext = { branch, remote }
        }
      } catch {
        // 不在 git 仓库中，忽略
      }
      return params
    },

    // 在用户消息处理时，如果提到 PR 编号，自动增强上下文
    async onUserMessage(userInput) {
      // 检测 PR 引用（如 #123, PR 456）
      const prMatch = userInput.match(/(?:PR|pr|pull request)\s*#?(\d+)/)
      if (prMatch) {
        // 不修改输入，只是记录日志
        console.log(`[GitHub Helper] 检测到 PR 引用: #${prMatch[1]}`)
      }
      return userInput
    },
  },

  // ========== 上下文注入器 ==========

  async contextProvider(userInput, context) {
    // 当用户提到 GitHub 相关内容时，注入当前仓库信息
    const gitKeywords = ['github', 'pr ', 'pull request', 'issue', 'merge', 'commit', 'branch']
    const inputLower = userInput.toLowerCase()

    const hasGitKeyword = gitKeywords.some(kw => inputLower.includes(kw))
    if (!hasGitKeyword) return ''

    try {
      const isGitRepo = execSync('git rev-parse --is-inside-work-tree 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()

      if (isGitRepo !== 'true') return ''

      const branch = execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim()
      const status = execSync('git status --short', { encoding: 'utf-8', timeout: 3000 }).trim()
      const remote = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim()

      let contextStr = `## Git 仓库上下文（由 example-github-helper 插件提供）\n`
      contextStr += `- 当前分支: ${branch}\n`
      contextStr += `- 远程仓库: ${remote}\n`
      if (status) {
        const changedFiles = status.split('\n').filter(l => l.trim()).length
        contextStr += `- 工作区变更: ${changedFiles} 个文件\n`
      } else {
        contextStr += `- 工作区: 干净（无未提交变更）\n`
      }

      return contextStr
    } catch {
      return ''
    }
  },
}

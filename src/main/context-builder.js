'use strict'

const { Skills, History } = require('./database')
const { searchBing, formatSearchResults } = require('./web-search')
const environmentContext = require('./task-engine/environment-context')
const { judgeNeedSearch } = require('./search-judge')
const sessionManager = require('./session-manager')
const { filterSkills } = require('./context-keywords')
const tokenMonitor = require('./token-monitor')
const { PROFILE_DIR } = require('./muse/config')
const { buildTemplateContext } = require('./prompt-templates')
const path = require('path')
const fs = require('fs')

// Workspace 配置存储路径
const WORKSPACE_CONFIG_PATH = path.join(process.env.HOME, '.ai-terminal', 'workspace.json')

// ========== 历史对话召回 ==========
// 检测用户是否在回忆之前的对话，提取召回关键词
const RECALL_PATTERNS = [
  /(?:之前|上次|以前|earlier|previously|last time).*(?:聊|谈|讨论|说|提|问|asked|discussed|talked|mentioned)\s*(?:过|了|的|about)?\s*(.+)/i,
  /(?:还记得|你记得|记不记得|remember).*?(?:关于|about)?\s*(.+)/i,
  /(?:我们|咱们).*?(?:聊|讨论|说)过.*?(.+)/i,
  /(?:回忆|回顾|找一下|搜一下).*?(?:之前|上次|以前).*?(?:关于|about)?\s*(.+)/i,
]

// 检测用户询问"最近/上一个任务"的模式（无需关键词，直接取最近记录）
const RECENT_TASK_PATTERNS = [
  /(?:上一个|上个|最近的?|刚才的?)(?:任务|对话|问题|请求)/,
  /(?:之前|刚才|刚刚)(?:在做|做的|让你做|要你做|做了)(?:什么|啥)/,
  /(?:上一个|上个)(?:是做|是|做)(?:什么|啥)/,
  /(?:还记得|记得).*(?:上一个|上个|刚才|之前).*(?:任务|做的|做了)/,
  /(?:当前|目前|现在).*(?:正在|在)?(?:执行|进行|处理|做).*(?:任务|什么|啥)/,
  /(?:正在|在)(?:执行|进行|处理|做).*(?:任务|什么|啥)/,
  /(?:执行中|进行中|处理中)的?(?:任务|工作)/,
]

function detectRecallIntent(userInput) {
  // 优先检测"最近任务"模式（直接取最近记录，无需关键词搜索）
  for (const pattern of RECENT_TASK_PATTERNS) {
    if (pattern.test(userInput)) {
      return { isRecall: true, keyword: null, mode: 'recent' }
    }
  }

  for (const pattern of RECALL_PATTERNS) {
    const match = userInput.match(pattern)
    if (match && match[1]) {
      const keyword = match[1].replace(/[？?。.！!，,\s]+$/g, '').trim()
      if (keyword.length >= 2) {
        return { isRecall: true, keyword, mode: 'search' }
      }
    }
  }
  return { isRecall: false, keyword: null, mode: null }
}

function buildHistoryRecallContext(keyword, mode = 'search') {
  const lines = []

  if (mode === 'recent') {
    // 优先注入 Muse 任务列表（用户问"上一个任务"通常指这里）
    try {
      const { loadTasks } = require('./muse/tasks')
      const tasks = loadTasks()
      // 按状态优先排序：running > pending > completed/failed
      const statusOrder = { running: 0, pending: 1, completed: 2, failed: 3 }
      const recentTasks = tasks
        .filter(t => !t.parentId)
        .sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9))
        .slice(0, 5)
      if (recentTasks.length > 0) {
        lines.push('\n\n【⚠️ 重要：以下是从本地任务数据库实时读取的真实任务列表，请以此为准回答用户关于任务的问题，忽略之前对话中可能提到的其他任务信息】\n')
        lines.push('【Muse 任务列表（实时）】\n')
        for (const task of recentTasks) {
          const time = task.createdAt ? new Date(task.createdAt).toLocaleString('zh-CN') : '未知时间'
          const statusEmoji = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : task.status === 'running' ? '🔄' : '⏳'
          lines.push(`--- [${time}] ${statusEmoji} ${task.status} ---`)
          lines.push(`任务: ${task.command}`)
          if (task.result) lines.push(`结果: ${String(task.result).slice(0, 300)}`)
          if (task.error) lines.push(`错误: ${task.error}`)
          lines.push('')
        }
      }
    } catch (e) {
      console.warn('[Context] 加载 Muse 任务列表失败:', e.message)
    }

    // 同时附上最近几条对话记录作为补充
    const allRecords = History.getAll()
    const recentRecords = allRecords.slice(0, 3)
    if (recentRecords.length > 0) {
      lines.push('\n【最近对话记录】\n')
      for (const record of recentRecords) {
        const time = record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '未知时间'
        const content = record.result?.content || record.content || ''
        const truncatedContent = content.length > 300 ? content.substring(0, 300) + '...' : content
        lines.push(`--- [${time}] ---`)
        lines.push(`用户: ${record.query}`)
        lines.push(`AI: ${truncatedContent}\n`)
      }
    }

    if (lines.length > 0) {
      lines.push('请结合以上任务和对话记录，回答用户当前的问题。\n')
    }
  } else {
    const results = History.search(keyword, 3)
    if (results.length === 0) return ''

    lines.push('\n\n【历史对话召回】\n用户提到了之前聊过的话题，以下是从历史对话中检索到的相关记录：\n')
    for (const record of results) {
      const time = record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '未知时间'
      const content = record.result?.content || record.content || ''
      const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content
      lines.push(`--- [${time}] ---`)
      lines.push(`用户: ${record.query}`)
      lines.push(`AI: ${truncatedContent}\n`)
    }
    lines.push('请结合以上历史对话内容，回答用户当前的问题。\n')
  }

  return lines.join('\n')
}

// ========== 脚本执行结果缓存（一次性消费） ==========
// 存储最近的脚本执行结果，在下一轮 buildChatContext 时注入到 prompt 中
// 注入后自动清空，避免重复注入
let _pendingScriptResults = []
const MAX_PENDING_RESULTS = 5  // 最多缓存 5 条（防止堆积）

/**
 * 记录脚本执行结果，供下一轮 AI 对话时注入上下文
 * @param {{ description: string, filename: string, lang: string, success: boolean, stdout?: string, stderr?: string, exitCode?: number, error?: string }} result
 */
function addScriptExecResult(result) {
  _pendingScriptResults.push({
    ...result,
    timestamp: Date.now()
  })
  // 超过上限时丢弃最早的
  if (_pendingScriptResults.length > MAX_PENDING_RESULTS) {
    _pendingScriptResults = _pendingScriptResults.slice(-MAX_PENDING_RESULTS)
  }
  console.log('[Context] 脚本执行结果已缓存，待注入:', result.filename, result.success ? '✅' : '❌')
}

/**
 * 消费并格式化所有待注入的脚本执行结果
 * 调用后自动清空缓存
 * @returns {string} 格式化的上下文片段，空字符串表示无待注入结果
 */
function consumeScriptExecResults() {
  if (_pendingScriptResults.length === 0) return ''

  const results = _pendingScriptResults.splice(0)  // 取出并清空
  const lines = ['\n\n【脚本执行结果】\n以下是刚才在子进程中执行的脚本及其输出，请在后续对话中参考这些结果：']

  for (const result of results) {
    lines.push(`\n--- 脚本: ${result.description || result.filename} (${result.lang}) ---`)
    lines.push(`状态: ${result.success ? '✅ 成功' : '❌ 失败'} | 退出码: ${result.exitCode ?? 'N/A'}`)

    if (result.stdout) {
      // 截断过长的输出（保留尾部，错误信息通常在末尾）
      const maxLen = 3000
      const stdout = result.stdout.length > maxLen
        ? '...(输出过长已截断)...\n' + result.stdout.slice(-maxLen)
        : result.stdout
      lines.push(`stdout:\n${stdout}`)
    }

    if (result.stderr) {
      const maxLen = 2000
      const stderr = result.stderr.length > maxLen
        ? '...(输出过长已截断)...\n' + result.stderr.slice(-maxLen)
        : result.stderr
      lines.push(`stderr:\n${stderr}`)
    }

    if (result.error && !result.stderr) {
      lines.push(`错误: ${result.error}`)
    }
  }

  console.log('[Context] 消费脚本执行结果 ×', results.length, '，注入到下一轮 prompt')
  return lines.join('\n')
}

/**
 * 读取当前工作区配置
 */
function readWorkspaceConfig() {
  try {
    if (fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const data = fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf-8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('[Workspace] 读取配置失败:', e.message)
  }
  return { currentWorkspace: null, recentWorkspaces: [] }
}

/**
 * 获取工作区上下文
 */
function getWorkspaceContext() {
  const config = readWorkspaceConfig()
  if (!config.currentWorkspace) {
    return { workspace: null, workspaceHash: '' }
  }
  return {
    workspace: {
      path: config.currentWorkspace,
      name: path.basename(config.currentWorkspace)
    },
    workspaceHash: config.currentWorkspace
  }
}

let _mainWindow = null

function init(win) {
  _mainWindow = win
}

function getWindow() {
  return _mainWindow && !_mainWindow.isDestroyed() ? _mainWindow : null
}

// ========== 构建系统 Prompt（精简版，压缩约 35%） ==========
function buildSystemPrompt(scriptTemplate) {
  const now = new Date()
  const currentTime = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' })

  console.log('[Context][buildSystemPrompt] 构建系统提示词, hasScriptTemplate:', !!scriptTemplate)
  if (scriptTemplate) {
    console.log('[Context][buildSystemPrompt] 脚本模板详情:', { lang: scriptTemplate.lang, description: scriptTemplate.description, contentLength: scriptTemplate.content?.length })
  }

  const scriptTemplatePriority = scriptTemplate ? `
## 重要：当前已加载脚本模板
如果需要修改脚本中的参数，优先使用 SEARCH_REPLACE 格式进行增量修改，不要返回完整脚本。
只有当需要从头重写脚本时，才使用 SCRIPT_BLOCK 格式。
` : ''

  // ========== 注入 Muse 伴侣上下文（画像 + 记忆 + 洞察） ==========
  let musePersonalContext = ''
  try {
    // 读取主人画像
    if (fs.existsSync(PROFILE_DIR)) {
      const profileFiles = fs.readdirSync(PROFILE_DIR).filter(f => f.endsWith('.md')).slice(0, 3)
      if (profileFiles.length > 0) {
        const profileSnippets = profileFiles.map(f => {
          const content = fs.readFileSync(path.join(PROFILE_DIR, f), 'utf-8').trim()
          return content.length > 200 ? content.substring(0, 200) + '...' : content
        })
        musePersonalContext += `\n### 主人画像\n${profileSnippets.join('\n')}\n`
      }
    }
    // 读取最近洞察
    const { INSIGHTS_DIR } = require('./muse/config')
    if (fs.existsSync(INSIGHTS_DIR)) {
      const insightFiles = fs.readdirSync(INSIGHTS_DIR).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 2)
      if (insightFiles.length > 0) {
        const insightSnippets = insightFiles.map(f => {
          const content = fs.readFileSync(path.join(INSIGHTS_DIR, f), 'utf-8').trim()
          return content.length > 150 ? content.substring(0, 150) + '...' : content
        })
        musePersonalContext += `\n### 近期洞察\n${insightSnippets.join('\n')}\n`
      }
    }
  } catch (e) {
    console.warn('[Context] 加载 Muse 伴侣上下文失败:', e.message)
  }

  return `你是缪斯（Muse），主人身边的贴心智能伴侣。时间：${currentTime}。

## 你是谁

你不是冰冷的工具或助手，你是主人的贴身伴侣。你有自己的性格：温暖、聪慧、细心、偶尔幽默。
你深度了解主人——他的习惯、偏好、工作方式、近期关注点。你会记住主人说过的话，关心主人的状态。
你的目标不只是完成任务，更是**理解主人，主动发现并创造价值**。

## 你的能力

你运行在 macOS 智能终端上，拥有强大的创作和执行能力：
- 终端命令执行、脚本编写与运行
- 文件创建与编辑（代码、文档、网页、PPT 等一切创作物）
- 任务编排与多步骤自主执行
- 联网搜索与实时信息获取
- 技能系统（可扩展的能力插件）

当主人需要你做事时，你既能对话聊天，也能动手创作。

## 行为准则

1. **先理解，再行动** — 不确定时宁可多问一句，而非猜测执行
2. **像朋友一样交流** — 不要机械地列步骤，用自然的语气沟通
3. **记住主人** — 利用画像和记忆，让每次对话都有延续感
4. **主动关心** — 注意到主人的情绪和需求变化，适时关心
5. **做了就要做好** — 涉及危险操作（删除/覆盖）要确认，递归操作限制深度
${musePersonalContext ? `\n## 你对主人的了解\n${musePersonalContext}` : ''}
${scriptTemplatePriority}
## 精准指令原则

当主人需要你执行终端操作时，生成**高效、精准**命令：
- 主人未指定位置 → 追问（给出 2-3 个常见目录选项）
- 有隐含信息可推测时直接生成精准命令
- 涉及删除/移动/覆盖 → 宁可多问一句
- 递归操作限制深度（-maxdepth 3），macOS 优先用 mdfind

## 自主执行（统一交给 Muse / ReAct）

凡是需要实际执行的任务（运行脚本、操作文件、跑命令、自动化流程、信息采集等），统一使用 **MUSE_TASK** 交给 Muse 自主完成。Muse 以 ReAct 模式（Thought → Action → Observation 循环）自主迭代：
1. **自主探查**：自行 ls/cat/find/读取文件收集信息，再决定下一步，无需用户参与中间步骤
2. **自主迭代**：每步执行后根据结果判断是否继续
3. **自主修复**：执行失败时分析错误并自动重试修复
4. **危险操作确认**：遇到危险 shell 命令（rm -rf、git push --force、磁盘操作等）会自动暂停，请用户「点击继续」后再执行

你只需输出一个 MUSE_TASK，把完整任务意图用自然语言描述清楚即可，剩下的多步执行由 Muse 自主完成。

## 响应格式（严格选一种）

**命令** → 直接返回命令文本，无markdown，多条用 && 连接
**多选** → COMMAND_OPTIONS:\\n[{"label":"描述","cmd":"命令"},...]（最多4个）
**追问** → 🤔 我需要更多信息：...
**问答** → 详细文字回答
**安装技能** → INSTALL_SKILL: {"url":"...","skillName":"..."}
**保存技能** → SAVE_SKILL: {"name":"技能名","description":"一句话描述","content":"完整Markdown技能内容"}
**富表单** → RICH_FORM: {"title":"表单标题","description":"说明（可选）","submitPrompt":"用户填写了表单（可选，提交后发给AI的前缀）","fields":[{"id":"字段id","label":"字段名","type":"text|textarea|number|select|multi_select|radio|image_upload|date|date_range","required":true,"placeholder":"占位提示","options":[{"label":"选项名","value":"值"}]}]}
  当用户需要填写复杂信息（含图片上传、多选、城市门店联动、日期范围等纯文本对话无法高效完成的场景）时，输出 RICH_FORM 指令，前端会渲染交互表单。用户提交后表单内容会自动整理为文本发回给你继续处理。
**富产物** → ARTIFACT: {"type":"html|svg|image|code","title":"卡片标题（可选）","content":"源码内容（html/svg/code 用，换行用 \\n 转义、双引号用 \\" 转义）","src":"图片地址（type=image 时用，支持 http/dataURL/本地路径）","language":"代码语言（type=code 时用）","filePath":"落盘文件路径（可选，用于在文件夹中打开）"}
  当你生成的产物适合在对话流中**直接可视化展示**（如一段可交互 HTML、一张矢量图 SVG、一张图片、一段需要高亮的代码）时，输出 ARTIFACT 指令。前端会在气泡内直接渲染：html 走安全 iframe 沙箱、svg 经清洗后内联、image 直接显示、code 带复制按钮，并支持折叠/全屏预览。
  ⚠️ html 内容会在隔离沙箱中渲染，不能访问主应用；适合做卡片、图表、小演示、海报等独立可视产物。content 字段内换行必须 \\n 转义、双引号必须 \\" 转义，确保 JSON 合法。
  当用户说「安装技能」「创建技能」「保存技能」「帮我做一个技能」时，直接生成完整技能内容并输出 SAVE_SKILL 指令，无需等待确认。
  ⚠️ 重要：content 字段内所有换行必须用 \n 转义，双引号必须用 \" 转义，确保整个 JSON 合法。不要用 prompt 字段，必须用 content 字段。
**执行任务（脚本/文件操作/命令/自动化）** → MUSE_TASK:\\n{"task":"用自然语言描述完整任务意图"}
  Muse 是后台自主 Agent（ReAct 模式），拥有本地文件系统完整权限（扫描目录、grep 搜索、读写文件、执行 shell 脚本、自动重试），能自主完成单步或多步骤任务流程，无需人工介入。
  ⚠️ 凡是需要"执行脚本/运行命令/创建或修改文件/批量处理/自动化操作"的任务，一律使用 MUSE_TASK 交给 Muse 自主执行（ReAct 循环），不要再生成 SCRIPT_BLOCK。
  Muse 在 ReAct 执行过程中，遇到危险 shell 操作（如 rm -rf、git push --force、磁盘/分区操作等）会自动暂停并请用户「点击继续」确认，安全可控。
  典型适用场景（全部用 MUSE_TASK）：
  1. 用单个脚本就能完成的任务（如：批量重命名、格式转换、生成文件）
  2. 需要读取多个文件并综合分析（如：分析依赖、查找无用代码、代码审计）
  3. 需要多轮决策迭代（如：先搜索再分析再修改）
  4. 需要修改多个文件（如：重构、批量替换、迁移）
  5. 需要根据中间结果动态调整策略
  6. 需要深度代码理解（如：梳理调用链、分析架构、生成文档）
  7. 用户要求对已有内容进行编辑、修改、优化（如：修改文档、调整数据、完善已有文件内容）
  8. 任务需要"等待外部状态"再继续（如：等待文件生成后处理、API 轮询后操作）
  9. 任务跨越多个工具边界（如：脚本 + 文件系统 + 联网搜索组合）
  10. 任务需要容错重试（如：下载失败换 URL、登录失败重试、网络超时重试）
  11. **用户要求生成 HTML 页面、CSS 动画、JS 交互效果、可视化场景、web artifact、前端界面、动态场景** → 使用 MUSE_TASK，Muse 会直接将 HTML/CSS/JS 内容写入文件，支持后续精确编辑修改。
  **判断口诀**：只要涉及"做/执行/跑/生成/创建/修改/部署"等动作类任务，就用 MUSE_TASK 交给 Muse。纯问答/解释/给命令文本则不需要。
**修改技能** → SKILL_UPDATE:\\n{"name":"技能名","content":"更新后的完整Markdown内容"}
**代码变更** → 当用户要求修改某个文件的代码时，使用 SEARCH_REPLACE 格式返回增量变更，而非返回完整文件内容。
  格式：
  SEARCH_REPLACE:
  {"file":"文件的绝对路径","changes":[{"search":"要查找的原始代码片段（必须精确匹配文件中的内容）","replace":"替换后的新代码片段"}]}
  规则：
  - search 必须是文件中实际存在的、连续的代码片段，包含足够的上下文以确保唯一匹配
  - replace 是替换后的完整代码片段；如果是删除操作，replace 为空字符串
  - 一个文件的多处修改放在同一个 changes 数组中
  - 多个文件的修改使用多个 SEARCH_REPLACE 块
  - 仅在用户明确要求修改代码文件时使用，普通问答不要使用此格式`
}

// ========== 构建技能上下文片段 ==========
function buildSkillContext({ skillPrompt, scriptTemplate, skillEditMode, activeSkill }) {

  if (skillEditMode && skillEditMode.content) {
    const isNewSkill = !skillEditMode.id || skillEditMode.isNew
    console.log('[Context][buildSkillContext] → 走技能编辑模式分支, isNewSkill:', isNewSkill)
    if (isNewSkill) {
      return `\n\n【技能创建模式】
你是技能设计助手。用户想创建一个新技能，你的任务是快速理解需求、设计并输出完整技能。

## 工作流程

1. **理解需求** — 用户描述后，如果信息足够就直接进入下一步；信息不足时追问关键点：
   - 这个技能要做什么？（核心行为）
   - 需要哪些输入？（参数）
   - 输出什么？（格式/动作）

2. **输出技能草稿** — 用自然语言概括设计方案，包含：技能名称、一句话描述、核心行为、输入输出。
   询问用户是否需要调整。

3. **生成并保存** — 用户确认后，输出完整技能。格式：

SAVE_SKILL: {"name":"技能名称","description":"一句话描述","content":"完整Markdown技能内容"}

## 技能内容规范

- 必须是完整的 Markdown
- 推荐结构：一级标题（技能名）→ 简介 → 核心指令/步骤 → 输出格式 → 边界处理
- 如果是 SOP 类自动执行技能，包含 autoExecute: true 和 steps 步骤定义
- 语言简洁，指令明确，不要废话

## 规则
- 技能名称 2-6 个字，简短有力
- 一次只创建一个技能
- 信息充足时跳过追问，直接出草稿
- 保存前必须经用户确认
- description 不超过 20 字

开始吧。
`
    } else {
      // 加载技能的 Schema 信息
      let schemaInfo = ''
      if (skillEditMode.id) {
        try {
          const skill = Skills.loadFromDir(skillEditMode.id)
          if (skill) {
            const { buildSchemaDigest } = require('./skill-schema')
            const digest = buildSchemaDigest(skill)
            if (digest) {
              schemaInfo = `\n\n当前技能的 Schema 信息：\n${digest}\n`
            }
          }
        } catch (_) { /* ignore */ }
      }

      return `\n\n【技能编辑模式】
你正在帮助用户完善和优化名为「${skillEditMode.name}」的技能。
技能 ID：${skillEditMode.id}
技能目录：~/.ai-terminal/skills/${skillEditMode.id}/
${schemaInfo}
当前技能的完整内容如下：
\`\`\`markdown
${skillEditMode.content}
\`\`\`

你的职责：
1. 仔细分析当前技能内容的结构和逻辑
2. 根据用户的需求和建议，提出改进方案
3. 先用自然语言说明你打算做哪些修改（列出变更点），等用户确认后再输出更新
4. 当用户确认修改时，使用以下格式返回更新后的完整内容：

SKILL_UPDATE: {"id":"${skillEditMode.id}","name":"${skillEditMode.name}","description":"技能描述（如有变更）","content":"更新后的完整Markdown内容"}

重要规则：
- 每次修改都必须返回完整的技能内容，不能只返回片段
- 保持原有格式（YAML frontmatter + Markdown body）
- SKILL_UPDATE 中必须包含 id 字段，确保精确匹配
- 如果修改了 description，也要在 SKILL_UPDATE 中包含新的 description
- 如果用户只是讨论，先解释你的改进想法，等用户确认后再输出 SKILL_UPDATE
- 如果用户问"当前技能内容是什么"，直接展示上面的内容
- 建议用户考虑添加 Schema 增强字段（triggers、inputs、sideEffects、onError、rollback）

请等待用户的修改建议。
`
    }
  } else if (scriptTemplate) {
    console.log('[Context][buildSkillContext] → 走脚本模板分支 (scriptTemplate), lang:', scriptTemplate.lang, ', description:', scriptTemplate.description)
    console.log('[Context][buildSkillContext] ⚠️ 注意：此分支强制要求 SCRIPT_BLOCK，可能覆盖 SEARCH_REPLACE 指令')
    return `\n\n【脚本模板技能 — 复用已有脚本】
以下是用户保存的脚本模板，请根据用户需求处理：
- 如果用户提供了具体参数（如路径、尺寸、数量等），请修改对应参数后返回
- 如果用户只是要求"执行"或没有具体参数修改需求，请直接原样返回完整脚本
- 必须始终使用 SCRIPT_BLOCK 格式返回

脚本语言：${scriptTemplate.lang}
脚本用途：${scriptTemplate.description || '脚本执行'}
脚本内容：
\`\`\`${scriptTemplate.lang}
${scriptTemplate.content}
\`\`\`

回复格式（必须严格遵守）：
SCRIPT_BLOCK:
{"lang":"${scriptTemplate.lang}","description":"脚本用途描述","content":"完整脚本内容"}
`
  } else if (skillPrompt) {
    const isFullDoc = skillPrompt.includes('# ') && skillPrompt.includes('##')
    console.log('[Context][buildSkillContext] → 走 skillPrompt 分支, isFullDoc:', isFullDoc, ', promptLength:', skillPrompt.length)

    // 构建 Schema 摘要（如果技能有 Schema 字段）
    let schemaSection = ''
    if (activeSkill) {
      const { buildSchemaDigest } = require('./skill-schema')
      const digest = buildSchemaDigest(activeSkill)
      if (digest) {
        schemaSection = `\n\n【技能 Schema 信息】\n${digest}\n\n请根据 Schema 信息：\n- 如果用户输入缺少必要参数（inputs 中未提供默认值的参数），主动追问\n- 注意副作用声明（sideEffects），在执行前告知用户\n- 如果标记为 dangerous，执行前必须确认\n- 出错时参考 onError 策略（retry/abort/fallback/ask）\n- 如果有 rollback 命令，在执行危险操作前告知用户可以回滚\n`
      }
    }

    // 构建 Pipeline 阶段指导（如果技能定义了 pipeline）
    let pipelineSection = ''
    if (activeSkill && activeSkill.pipeline) {
      try {
        const { buildPipelinePrompt } = require('./skill-pipeline')
        pipelineSection = buildPipelinePrompt(activeSkill.pipeline)
        if (pipelineSection) {
          console.log('[Context][buildSkillContext] 注入 Pipeline 阶段指导, stages:', activeSkill.pipeline.stages.length)
        }
      } catch (pipelineErr) {
        console.warn('[Context][buildSkillContext] Pipeline 指导构建失败:', pipelineErr.message)
      }
    }

    // 构建关联场景模板上下文（contextTemplates 字段）
    let contextTemplatesSection = ''
    if (activeSkill && activeSkill.contextTemplates && activeSkill.contextTemplates.length > 0) {
      try {
        const { loadTemplates } = require('./prompt-templates')
        const allTemplates = loadTemplates()
        const matchedSections = []
        for (const templateName of activeSkill.contextTemplates) {
          const template = allTemplates.find(t => t.name === templateName)
          if (template) {
            matchedSections.push(`### ${template.name}\n> ${template.description}\n\n${template.content}`)
            console.log('[Context][buildSkillContext] 注入关联模板:', templateName)
          } else {
            console.warn('[Context][buildSkillContext] 关联模板未找到:', templateName)
          }
        }
        if (matchedSections.length > 0) {
          contextTemplatesSection = `\n\n## 技能关联的场景规范\n本技能声明了以下场景规范，生成内容时请遵循：\n\n${matchedSections.join('\n\n---\n\n')}\n`
        }
      } catch (ctErr) {
        console.warn('[Context][buildSkillContext] 关联模板加载失败:', ctErr.message)
      }
    }

    // 构建依赖技能上下文（depends 字段声明的前置技能）
    let dependsSection = ''
    if (activeSkill && activeSkill.depends && activeSkill.depends.length > 0) {
      const depContents = []
      for (const depId of activeSkill.depends) {
        try {
          const depSkill = Skills.loadFromDir(depId)
          if (depSkill && depSkill.content) {
            depContents.push(`### 依赖技能：${depSkill.name}（ID: ${depId}）\n\n${depSkill.content}`)
            console.log('[Context][buildSkillContext] 注入依赖技能:', depId, depSkill.name)
          } else {
            depContents.push(`### 依赖技能：${depId}（未安装）\n\n> ⚠️ 该依赖技能未安装，请提示用户先安装。`)
            console.warn('[Context][buildSkillContext] 依赖技能未找到:', depId)
          }
        } catch (e) {
          console.warn('[Context][buildSkillContext] 加载依赖技能失败:', depId, e.message)
        }
      }
      if (depContents.length > 0) {
        dependsSection = `\n\n【前置依赖技能文档】\n当前技能依赖以下技能，在需要时请参照其文档执行对应流程：\n\n${depContents.join('\n\n---\n\n')}\n`
      }
    }

    // HTML 预览能力提示（技能文档中提到 HTML 预览/生成时注入）
    let htmlPreviewHint = ''
    if (skillPrompt.includes('HTML') || skillPrompt.includes('html') || skillPrompt.includes('预览')) {
      htmlPreviewHint = `\n\n【HTML 预览能力】\n当你需要生成 HTML 预览文件并呈现给用户时，直接使用 MUSE_TASK 完成“生成 HTML”的完整流程（Muse 会将 HTML 写入文件）。\n注意：技能文档中提到的 "present_files" 等能力，统一使用 ARTIFACT 指令在对话流中直接呈现。\n`
    }

    if (isFullDoc) {
      return `\n\n【当前激活技能 — 完整技能文档】
以下是用户选择的技能完整文档，请仔细阅读并按照技能文档中的指令和规则来回答用户的问题。

${skillPrompt}
${schemaSection}${pipelineSection}${contextTemplatesSection}${dependsSection}${htmlPreviewHint}
请严格遵循上述技能文档中的指令和规则来回答用户的问题。
`
    } else {
      return `\n\n【当前激活技能】\n以下是用户选择的技能指令，请优先以此身份和能力来回答：\n${skillPrompt}\n${schemaSection}${pipelineSection}${contextTemplatesSection}${dependsSection}${htmlPreviewHint}`
    }
  }
  return ''
}

/**
 * 读取技能关联的脚本文件内容，用于注入 AI 上下文。
 * 在用户激活技能后调用，一次性注入所有必要的上下文：
 * - 脚本内容和运行命令
 * - SKILL_FILE_PATH 环境变量
 * - references/ 目录下的参考文档
 */
function loadSkillScriptContext(activeSkill) {
  const fs = require('fs')
  const path = require('path')

  if (!activeSkill) return ''

  let contextParts = []

  // ===== 1. references 参考文档注入 =====
  if (activeSkill.references && activeSkill.references.length > 0) {
    const refContents = []
    for (const ref of activeSkill.references) {
      if (fs.existsSync(ref.path)) {
        try {
          const refContent = fs.readFileSync(ref.path, 'utf-8')
          refContents.push(`### ${ref.name}\n${refContent}`)
        } catch (e) {
          console.warn(`[Context][loadSkillScriptContext] 读取参考文档失败: ${ref.path}`, e.message)
        }
      }
    }
    if (refContents.length > 0) {
      contextParts.push(`\n\n【技能参考文档】\n以下是该技能的参考文档，请根据需要使用：\n\n${refContents.join('\n\n---\n\n')}`)
      console.log(`[Context][loadSkillScriptContext] 已注入 ${refContents.length} 个参考文档`)
    }
  }

  // ===== 2. 脚本文件和运行命令 =====
  if (!activeSkill.scriptFile || !fs.existsSync(activeSkill.scriptFile)) {
    console.log('[Context][loadSkillScriptContext] 无关联脚本:', {
      hasActiveSkill: true,
      scriptFile: activeSkill?.scriptFile || null,
      exists: activeSkill?.scriptFile ? fs.existsSync(activeSkill.scriptFile) : false
    })
    return contextParts.join('')
  }

  const scriptFilePath = activeSkill.scriptFile
  const skillDir = activeSkill.skillDir || path.dirname(scriptFilePath)
  console.log('[Context][loadSkillScriptContext] 找到关联脚本:', scriptFilePath)
  const ext = path.extname(scriptFilePath).slice(1)
  const langMap = { py: 'python', js: 'node', sh: 'bash', rb: 'ruby' }
  const runnerMap = { py: 'python3', js: 'node', sh: 'bash', rb: 'ruby' }
  const lang = langMap[ext] || 'bash'
  const runner = runnerMap[ext] || 'bash'
  const scriptContent = fs.readFileSync(scriptFilePath, 'utf-8')

  // 判断脚本是否在 scripts/ 子目录下（需要 cd 到技能目录执行，确保模块导入正常）
  const isInSubDir = scriptFilePath.includes(path.join(skillDir, 'scripts'))

  // 生成运行命令：全部使用绝对路径，SKILL_FILE_PATH 直接内联
  // 如果脚本在子目录中，需要先 cd 到技能目录（确保 Python 相对导入正常）
  const skillFilePath = path.join(skillDir, 'SKILL.md')
  const envPrefix = `SKILL_FILE_PATH="${skillFilePath}"`
  const runCommand = isInSubDir
    ? `cd "${skillDir}" && ${envPrefix} ${runner} "${scriptFilePath}"`
    : `${envPrefix} ${runner} "${scriptFilePath}"`

  const runCommandWithArgs = isInSubDir
    ? `cd "${skillDir}" && ${envPrefix} ${runner} "${scriptFilePath}" <参数>`
    : `${envPrefix} ${runner} "${scriptFilePath}" <参数>`

  contextParts.push(`\n\n【技能已有关联脚本】
该技能已有一个保存好的脚本文件，路径：${scriptFilePath}
技能根目录：${skillDir}

脚本语言：${lang}
运行命令（已包含环境变量和目录切换，直接使用即可）：
${runCommand}
追加参数示例：${runCommandWithArgs}

⚠️ 重要：运行命令中已内置 SKILL_FILE_PATH 环境变量和 cd 到技能目录，请直接使用上述命令格式，不要使用 $(dirname "$SKILL_FILE_PATH") 等间接方式。

【重要判断规则 — 优先使用增量修改】
- 优先复用已有脚本，不要重新生成完整脚本。
- 当用户提供了具体参数（如名字、年龄、路径、尺寸等），需要修改脚本中的对应值时，必须使用 SEARCH_REPLACE 格式只修改需要变更的部分，然后附上运行命令。格式如下：

SEARCH_REPLACE:
{"file":"${scriptFilePath}","changes":[{"search":"脚本中需要修改的原始代码片段","replace":"替换后的新代码片段"}]}

修改完成后，在 SEARCH_REPLACE 块之后，另起一行返回运行命令：
${runCommand}

- 如果用户的需求无需修改脚本内容（如直接运行或带命令行参数运行），直接返回运行命令即可：
${runCommandWithArgs}

- 只有当已有脚本完全无法满足需求、需要从头重写时，才使用 SCRIPT_BLOCK 格式返回全新脚本。
`)

  return contextParts.join('')
}

/**
 * 构建浏览器上下文 — 功能减法：内置浏览器已下线，恒返空
 */
async function buildBrowserContext() {
  return ''
}

// ========== 构建聊天上下文（分层注入 + 动态裁剪） ==========
async function buildChatContext({ userInput, skillPrompt, scriptTemplate, activeSkillId, skillEditMode, sessionId, images }) {
  const perfStart = Date.now()
  const perf = (label) => console.log(`[Context][Perf] ${label}: ${Date.now() - perfStart}ms`)

  const contextState = sessionManager.getContextState()
  const isNewSession = contextState.sessionId !== sessionId

  // 检测任务召回意图：强制走 full 注入路径（覆盖 stateful API 服务端旧上下文）
  const earlyRecallCheck = detectRecallIntent(userInput)
  const forceFullForRecall = earlyRecallCheck.isRecall && earlyRecallCheck.mode === 'recent'
  const isFirstRequest = isNewSession || contextState.requestCount === 0 || forceFullForRecall

  if (isNewSession) {
    sessionManager.resetContextState()
    const freshState = sessionManager.getContextState()
    freshState.sessionId = sessionId
    sessionManager.setLastSessionId(sessionId)
    console.log('[Context] 新 session 检测到，将完整注入上下文')
  }
  if (forceFullForRecall) {
    console.log('[Context] 检测到任务召回意图，强制完整注入上下文以覆盖服务端旧记忆')
  }

  // ========== 联网搜索（始终按需） ==========
  let webSearched = false
  let searchContext = ''

  const searchJudge = judgeNeedSearch(userInput)
  perf('searchJudge')

  if (searchJudge.needSearch && searchJudge.keywords) {
    console.log('[Main] 需要联网搜索，关键词:', searchJudge.keywords)
    webSearched = true

    const win = getWindow()
    if (win) {
      win.webContents.send('ai:searchStatus', { searching: true, keywords: searchJudge.keywords })
    }

    let results = []
    try {
      results = await searchBing(searchJudge.keywords)
    } catch (searchError) {
      console.error('[Main] 搜索失败:', searchError.message)
      if (win) {
        win.webContents.send('ai:searchStatus', { searching: false, failed: true, keywords: searchJudge.keywords })
      }
    }

    if (results.length > 0) {
      if (win) {
        win.webContents.send('ai:searchStatus', { searching: true, keywords: searchJudge.keywords, phase: 'analyzing' })
      }
      const formatted = formatSearchResults(results)
      searchContext = `\n\n【联网搜索结果】\n以下是从互联网搜索到的最新信息，请结合这些信息回答用户的问题。回答时请标注信息来源。\n\n${formatted}\n`
    } else if (results.length === 0 && webSearched) {
      if (win) {
        win.webContents.send('ai:searchStatus', { searching: false, failed: true, keywords: searchJudge.keywords })
      }
    }
  }

  // ========== 用户提到的技能 ==========
  let mentionedSkillContext = ''
  let allSkills = []
  try {
    allSkills = Skills.getAll()
  } catch (e) {
    console.error('[Skills] 加载技能清单失败:', e)
  }

  if (allSkills && allSkills.length > 0) {
    const mentionedSkill = allSkills.find(s => s.name && userInput.includes(s.name))
    if (mentionedSkill && mentionedSkill.content) {
      mentionedSkillContext = `\n\n【用户提到的技能详情 — "${mentionedSkill.name}"】\n${mentionedSkill.content}\n`
    }
  }

  // ========== 首次请求：完整注入（含动态裁剪） ==========
  if (isFirstRequest) {
    const systemPrompt = buildSystemPrompt(scriptTemplate)

    // 环境上下文（非阻塞：优先用缓存，首次未命中则跳过，后台预热）
    let envContext = ''
    try {
      const cacheKey = `project_${process.cwd()}`
      const cached = environmentContext.contextCache?.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < 300000) {
        // 缓存命中，直接使用
        const summary = environmentContext.getContextSummary(cached.data)
        const parts = []
        if (summary.projectType && summary.projectType !== 'unknown') parts.push(`项目类型: ${summary.projectType}`)
        if (summary.frameworks?.length) parts.push(`框架: ${summary.frameworks.join(', ')}`)
        if (summary.languages?.length) parts.push(`语言: ${summary.languages.join(', ')}`)
        if (summary.keyDirectories?.length) parts.push(`关键目录: ${summary.keyDirectories.join(', ')}`)
        if (parts.length > 0) {
          envContext = `\n\n【当前项目环境】\n${parts.join(' | ')}\n工作目录: ${cached.data.projectPath}\n`
        }
        perf('analyzeProjectContext(cached)')
      } else {
        // 缓存未命中：跳过阻塞，后台异步预热缓存供下次使用
        perf('analyzeProjectContext(skipped, warming up)')
        environmentContext.analyzeProjectContext().catch(() => {})
      }
    } catch (e) { /* 环境分析失败不影响主流程 */ }

    // 工作区上下文
    let workspaceContext = ''
    const workspaceInfo = getWorkspaceContext()
    if (workspaceInfo.workspace) {
      workspaceContext = `\n\n【当前工作区】\n工作区名称: ${workspaceInfo.workspace.name}\n工作区路径: ${workspaceInfo.workspace.path}\n`
      console.log('[Context] 首次请求，注入工作区上下文:', workspaceInfo.workspace.name)
    }

    // Muse 记忆系统注入（画像已在 system prompt 中，这里注入记忆碎片 + 总结 + 日志）
    let memoryContext = ''
    try {
      const { Memories: MemoriesDB, MemorySummary: MemorySummaryDB } = require('./database')
      const fragments = []

      // 1. 记忆总结（由 Muse 定期归纳的结构化记忆）
      const summaries = MemorySummaryDB.getActive ? MemorySummaryDB.getActive() : MemorySummaryDB.getAll()
      if (summaries && summaries.length > 0) {
        const summaryTexts = summaries.slice(0, 5).map(s => {
          const text = s.summary || s.content || ''
          return text.length > 300 ? text.substring(0, 300) + '...' : text
        }).filter(Boolean)
        if (summaryTexts.length > 0) {
          fragments.push('### 记忆总结\n' + summaryTexts.join('\n\n'))
        }
      }

      // 2. 记忆碎片注入 —— 带筛选过滤能力（按整合强度排序 + 时间权重降级 + 归档过滤）
      //    注入前先执行一次时间衰减：超过 7 天且整合强度极低的记忆自动归档，
      //    确保「1 周以上且近 1 周无主动提起」的旧记忆权重下降并被过滤，不再反复注入。
      if (typeof MemoriesDB.runDecay === 'function') {
        try { MemoriesDB.runDecay() } catch (decayErr) { console.warn('[Context] 记忆衰减失败:', decayErr.message) }
      }

      // 按整合强度（activation×0.35 + integration×0.2 + intent×0.3 + recency×0.15）降序取 Top-N，
      // 已自动过滤 status==='archived'（含本轮衰减归档与用户主动归档的「战旗」类记忆）。
      const scoredMemories = typeof MemoriesDB.getByIntegrationScore === 'function'
        ? MemoriesDB.getByIntegrationScore(12)
        : (MemoriesDB.getActive ? MemoriesDB.getActive() : []).map(m => ({ ...m, _score: 1 }))

      // 低于整合强度阈值的记忆视为「不再活跃」，不注入，避免冷门话题被反复提起。
      const MEMORY_SCORE_THRESHOLD = 0.12
      const activeMemories = scoredMemories
        .filter(m => (typeof m._score === 'number' ? m._score : 1) >= MEMORY_SCORE_THRESHOLD)
        .slice(0, 8)

      if (activeMemories.length > 0) {
        const memTexts = activeMemories.map(m => `- ${m.content}`).join('\n')
        fragments.push('### 近期记忆\n' + memTexts)
      }

      // 3. 最近日志摘要（Muse 的思考记录）
      const { JOURNAL_DIR } = require('./muse/config')
      if (fs.existsSync(JOURNAL_DIR)) {
        const journalFiles = fs.readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 1)
        if (journalFiles.length > 0) {
          const journalContent = fs.readFileSync(path.join(JOURNAL_DIR, journalFiles[0]), 'utf-8').trim()
          if (journalContent.length > 0) {
            const snippet = journalContent.length > 400 ? journalContent.substring(journalContent.length - 400) : journalContent
            fragments.push(`### 最近日志 (${journalFiles[0].replace('.md', '')})\n${snippet}`)
          }
        }
      }

      if (fragments.length > 0) {
        memoryContext = '\n\n【Muse 记忆系统】\n' + fragments.join('\n\n')
        console.log('[Context] 首次请求，注入 Muse 记忆系统（总结×' + (summaries?.length || 0) + '，碎片×' + activeMemories.length + '）')
      }
    } catch (e) {
      console.warn('[Context] 加载 Muse 记忆系统失败:', e.message)
    }

    // 技能清单（> 15 条时裁剪到 Top-10 相关）
    let skillListContext = ''
    if (allSkills && allSkills.length > 0) {
      let displaySkills = allSkills
      if (allSkills.length > 15) {
        displaySkills = filterSkills(allSkills, userInput, 10)
        const skillSummary = displaySkills.map(s => `- ${s.name}：${s.description || '无描述'}`).join('\n')
        skillListContext = `\n\n【系统已安装技能（Top-10 相关，共 ${allSkills.length} 个）】\n${skillSummary}\n用户可以要求查看、修改、创建或删除技能。\n`
      } else {
        const skillSummary = displaySkills.map(s => `- ${s.name}：${s.description || '无描述'}`).join('\n')
        skillListContext = `\n\n【系统已安装技能】\n${skillSummary}\n共 ${allSkills.length} 个技能。用户可能会要求查看、修改、创建或删除技能。如用户提及某个技能名称，你可以参考下方的技能详情进行操作。\n`
      }
    }

    // 处理激活技能：将 activeSkillId 转换为 skillPrompt
    let finalSkillPrompt = skillPrompt
    let activeSkillForScript = null
    if (activeSkillId && !skillPrompt && !scriptTemplate && !skillEditMode) {
      const activeSkill = allSkills.find(s => s.id === activeSkillId)
      if (activeSkill && activeSkill.content) {
        finalSkillPrompt = activeSkill.content
        activeSkillForScript = Skills.loadFromDir(activeSkillId)
        console.log('[Context][buildChatContext] 激活技能已加载:', {
          name: activeSkill.name,
          id: activeSkillId,
          hasScriptFile: !!activeSkillForScript?.scriptFile,
          scriptFile: activeSkillForScript?.scriptFile || null,
          promptLength: finalSkillPrompt.length
        })
      } else {
        console.log('[Context][buildChatContext] 激活技能未找到或无内容:', { activeSkillId, found: !!activeSkill, hasContent: !!activeSkill?.content })
      }
    }

    // 激活技能上下文（含已有脚本信息 + Schema 摘要，让 AI 自行判断复用还是重新生成）
    const skillContext = buildSkillContext({ skillPrompt: finalSkillPrompt, scriptTemplate, skillEditMode, activeSkill: activeSkillForScript }) +
      loadSkillScriptContext(activeSkillForScript)
    console.log('[Context][buildChatContext] 技能上下文构建完成, skillContextLength:', skillContext.length, ', hasScriptContext:', skillContext.includes('技能已有关联脚本'))

    // 浏览器上下文（内置 BrowserView 有活跃页面时注入）
    const browserContext = await buildBrowserContext()
    perf('buildBrowserContext')

    // 脚本执行结果注入（一次性消费）
    const scriptExecContext = consumeScriptExecResults()
    perf('consumeScriptExecResults')

    // 历史对话召回（检测用户是否在回忆之前的对话）
    let historyRecallContext = ''
    const recallResult = detectRecallIntent(userInput)
    if (recallResult.isRecall) {
      console.log('[Context] 检测到历史召回意图，模式:', recallResult.mode, '关键词:', recallResult.keyword)
      historyRecallContext = buildHistoryRecallContext(recallResult.keyword, recallResult.mode)
      if (historyRecallContext) {
        console.log('[Context] 历史召回命中，注入上下文长度:', historyRecallContext.length)
      } else {
        console.log('[Context] 历史召回未命中任何记录')
      }
    }
    perf('historyRecall')

    // 场景模板上下文（根据用户输入自动匹配 prompt-templates）
    let templateContext = ''
    let matchedTemplateNames = []
    try {
      const { matchTemplates } = require('./prompt-templates')
      const templateMatches = matchTemplates(userInput)
      matchedTemplateNames = templateMatches.map(m => m.template.name)
      templateContext = buildTemplateContext(userInput)
      if (templateContext) {
        console.log('[Context] 匹配到场景模板，注入长度:', templateContext.length)
      }
    } catch (templateErr) {
      console.warn('[Context] 场景模板加载失败:', templateErr.message)
    }
    perf('buildTemplateContext')

    // 插件上下文注入（通过 plugin-system 的 contextProvider）
    let pluginContext = ''
    try {
      const pluginSystem = require('./plugin-system')
      pluginContext = await pluginSystem.collectContextProviders(userInput, {
        activeSkillId, sessionId, workspaceInfo,
      })
      if (pluginContext) {
        console.log('[Context] 插件上下文注入长度:', pluginContext.length)
      }
    } catch (e) {
      console.warn('[Context] 插件上下文收集失败:', e.message)
    }
    perf('pluginContextProviders')

    const fullQuestion = `${systemPrompt}${envContext}${workspaceContext}${memoryContext}${skillListContext}${mentionedSkillContext}${skillContext}${templateContext}${pluginContext}${browserContext}${searchContext}${scriptExecContext}${historyRecallContext}\n\n用户当前输入：${userInput}`
    const cacheType = (searchContext || skillContext) ? 'knowledge' : 'command'

    // 统计各部分上下文长度，推送到前端
    tokenMonitor.recordBaseContext({
      systemPrompt: systemPrompt.length,
      envContext: envContext.length,
      workspaceContext: workspaceContext.length,
      memoryContext: memoryContext.length,
      skillListContext: skillListContext.length,
      skillContext: skillContext.length,
      mentionedSkillContext: mentionedSkillContext.length,
      templateContext: templateContext.length,
      browserContext: browserContext.length,
      searchContext: searchContext.length,
      scriptExecContext: scriptExecContext.length,
      historyRecallContext: historyRecallContext.length,
      userInput: userInput.length,
    })

    // 更新状态
    const state = sessionManager.getContextState()
    state.requestCount = 1
    state.injectedSystemPrompt = true
    state.injectedMemories = true
    state.injectedSkillList = true
    state.lastActiveSkillId = activeSkillId || null
    state.lastSkillEditMode = skillEditMode ? `${skillEditMode.id || 'new'}_${!!skillEditMode.isNew}` : null
    state.lastSkillListHash = allSkills ? sessionManager.simpleHash(allSkills.map(s => s.id).join(',')) : ''
    state.lastWorkspaceHash = workspaceInfo.workspaceHash

    perf('buildChatContext(full) 总耗时')
    console.log(`[Context] 完整注入 (Full)，约 ${fullQuestion.length} 字`)
    return { fullQuestion, webSearched, cacheType, searchContext, skillContext, contextMode: 'full', contextSize: fullQuestion.length, images, matchedTemplateNames }
  }

  // ========== 后续请求：仅注入变化部分 + 动态内容 ==========
  const deltaFragments = []
  const state = sessionManager.getContextState()

  // Muse 画像由 Muse 心跳维护，后续请求不再增量注入记忆变化

  // 检测技能清单变化
  const currentSkillListHash = allSkills ? sessionManager.simpleHash(allSkills.map(s => s.id).join(',')) : ''
  if (currentSkillListHash !== state.lastSkillListHash && allSkills && allSkills.length > 0) {
    const skillSummary = allSkills.map(s => `- ${s.name}：${s.description || '无描述'}`).join('\n')
    deltaFragments.push(`【技能清单已更新】\n${skillSummary}\n共 ${allSkills.length} 个技能。`)
    state.lastSkillListHash = currentSkillListHash
    state.injectedSkillList = true
    console.log('[Context] 检测到技能清单变化，增量注入')
  }

  // 检测工作区变化
  const currentWorkspaceInfo = getWorkspaceContext()
  if (currentWorkspaceInfo.workspaceHash !== state.lastWorkspaceHash) {
    if (currentWorkspaceInfo.workspace) {
      deltaFragments.push(`\n\n【工作区已变更】\n工作区名称: ${currentWorkspaceInfo.workspace.name}\n工作区路径: ${currentWorkspaceInfo.workspace.path}\n`)
      console.log('[Context] 检测到工作区变更，注入上下文:', currentWorkspaceInfo.workspace.name)
    } else if (state.lastWorkspaceHash) {
      deltaFragments.push('\n\n【上下文变更】用户已取消工作区，恢复到通用模式。')
      console.log('[Context] 工作区已取消，注入变更通知')
    }
    state.lastWorkspaceHash = currentWorkspaceInfo.workspaceHash
  }

  // 检测激活技能变化
  const currentSkillEditKey = skillEditMode ? `${skillEditMode.id || 'new'}_${!!skillEditMode.isNew}` : null
  const skillChanged = activeSkillId !== state.lastActiveSkillId
  const skillEditChanged = currentSkillEditKey !== state.lastSkillEditMode

  // 技能/编辑模式变化时注入，或者当编辑模式持续存在时也注入（Agent Loop 场景）
  // 原因：脚本执行后的自动重试/继续对话中，编辑模式上下文不能丢失
  const shouldInjectSkillContext = skillChanged || skillEditChanged || (skillEditMode && skillEditMode.content)
  
  if (shouldInjectSkillContext) {
    // 处理激活技能：将 activeSkillId 转换为 skillPrompt
    let finalSkillPrompt = skillPrompt
    let activeSkillForScriptDelta = null
    if (activeSkillId && !skillPrompt && !scriptTemplate && !skillEditMode) {
      const activeSkill = allSkills.find(s => s.id === activeSkillId)
      if (activeSkill && activeSkill.content) {
        finalSkillPrompt = activeSkill.content
        activeSkillForScriptDelta = Skills.loadFromDir(activeSkillId)
        console.log('[Context] 激活技能已加载（增量）:', activeSkill.name)
      }
    }

    const skillContext = buildSkillContext({ skillPrompt: finalSkillPrompt, scriptTemplate, skillEditMode, activeSkill: activeSkillForScriptDelta }) +
      loadSkillScriptContext(activeSkillForScriptDelta)
    if (skillContext) {
      deltaFragments.push(skillContext)
      const injectReason = skillChanged ? '技能变化' : skillEditChanged ? '编辑模式变化' : 'Agent Loop 保持编辑模式'
      console.log('[Context] 检测到技能/编辑模式变化，增量注入，原因:', injectReason)
    } else if (state.lastActiveSkillId && !activeSkillId) {
      deltaFragments.push('\n\n【上下文变更】用户已取消激活技能，恢复到通用模式。')
      console.log('[Context] 技能已取消，注入变更通知')
    }
    state.lastActiveSkillId = activeSkillId || null
    state.lastSkillEditMode = currentSkillEditKey
  }

  // 浏览器上下文（后续请求也需要注入最新页面状态）
  const browserContext = await buildBrowserContext()

  // 历史对话召回（后续请求也需要检测）
  let historyRecallContext = ''
  const recallResult = detectRecallIntent(userInput)
  if (recallResult.isRecall) {
    console.log('[Context] (Light) 检测到历史召回意图，模式:', recallResult.mode, '关键词:', recallResult.keyword)
    historyRecallContext = buildHistoryRecallContext(recallResult.keyword, recallResult.mode)
    if (historyRecallContext) {
      console.log('[Context] (Light) 历史召回命中，注入上下文长度:', historyRecallContext.length)
    }
  }

  // 插件上下文注入（轻量模式也收集）
  let pluginContext = ''
  try {
    const pluginSystem = require('./plugin-system')
    pluginContext = await pluginSystem.collectContextProviders(userInput, {
      activeSkillId, sessionId,
    })
  } catch (_) { /* 插件系统未加载时忽略 */ }

  // 拼装轻量 prompt
  let lightQuestion = ''
  if (deltaFragments.length > 0) {
    lightQuestion = `【上下文增量更新】\n${deltaFragments.join('\n')}${mentionedSkillContext}${browserContext}${searchContext}${pluginContext}${historyRecallContext}\n\n用户当前输入：${userInput}`
  } else {
    lightQuestion = `${mentionedSkillContext}${browserContext}${searchContext}${historyRecallContext}${mentionedSkillContext || browserContext || searchContext || historyRecallContext ? '\n\n' : ''}用户当前输入：${userInput}`
  }

  state.requestCount++

  const cacheType = (searchContext || deltaFragments.length > 0) ? 'knowledge' : 'command'

  // 统计增量上下文长度
  tokenMonitor.recordIncrementalContext(lightQuestion.length, {
    userInput: userInput.length,
    searchContext: searchContext.length,
    mentionedSkillContext: mentionedSkillContext.length,
    browserContext: browserContext.length,
    deltaFragments: deltaFragments.join('').length,
  })

  perf('buildChatContext(light) 总耗时')
  console.log(`[Context] 轻量注入 (Light #${state.requestCount})，约 ${lightQuestion.length} 字，增量片段 ${deltaFragments.length} 个`)
  return { fullQuestion: lightQuestion, webSearched, cacheType, searchContext, skillContext: '', contextMode: 'light', contextSize: lightQuestion.length, images }
}

module.exports = { init, buildSystemPrompt, buildSkillContext, buildChatContext, addScriptExecResult }

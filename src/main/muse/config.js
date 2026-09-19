// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const fs = require('fs')
const path = require('path')

// 节点级并集合并学习图谱：有正文者优先，都有则取更新时间新的
function mergeLearningMaps(legacyFile, targetFile) {
  const pickNode = (a, b) => {
    const aHas = a.content && a.content.trim()
    const bHas = b.content && b.content.trim()
    if (aHas && !bHas) return a
    if (bHas && !aHas) return b
    return String(b.updatedAt || 0) >= String(a.updatedAt || 0) ? b : a
  }
  const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'))
  const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
  if (!Array.isArray(legacy) || !Array.isArray(target)) return false
  const merged = []
  for (const legacyMap of legacy) {
    const targetMap = target.find(map => map.id === legacyMap.id)
    if (!targetMap) { merged.push(legacyMap); continue }
    const nodes = new Map()
    for (const node of legacyMap.nodes) nodes.set(node.id, node)
    for (const node of targetMap.nodes) {
      nodes.set(node.id, nodes.has(node.id) ? pickNode(nodes.get(node.id), node) : node)
    }
    merged.push({
      ...legacyMap,
      nodes: [...nodes.values()],
      currentNodeId: targetMap.currentNodeId || legacyMap.currentNodeId,
      updatedAt: targetMap.updatedAt,
    })
  }
  for (const targetMap of target) {
    if (!legacy.some(map => map.id === targetMap.id)) merged.push(targetMap)
  }
  const temporaryFile = `${targetFile}.tmp`
  fs.writeFileSync(temporaryFile, JSON.stringify(merged, null, 2), 'utf8')
  fs.renameSync(temporaryFile, targetFile)
  return true
}

// 一次性迁移：旧版数据目录 ~/.ai-terminal → ~/.folio
// - 新目录不存在：整体改名
// - 两目录并存（新目录已被先行初始化）：合并学习图谱，缺失子目录补齐；旧目录保留作备份
try {
  const legacyHome = path.join(process.env.HOME, '.ai-terminal')
  const folioHome = path.join(process.env.HOME, '.folio')
  if (fs.existsSync(legacyHome)) {
    if (!fs.existsSync(folioHome)) {
      fs.renameSync(legacyHome, folioHome)
      console.log('[Muse] 已迁移数据目录 ~/.ai-terminal → ~/.folio')
    } else {
      const legacyStore = path.join(legacyHome, 'muse', 'learning-maps.json')
      const targetStore = path.join(folioHome, 'muse', 'learning-maps.json')
      if (fs.existsSync(legacyStore)) {
        if (!fs.existsSync(targetStore)) {
          fs.mkdirSync(path.dirname(targetStore), { recursive: true })
          fs.renameSync(legacyStore, targetStore)
        } else if (mergeLearningMaps(legacyStore, targetStore)) {
          console.log('[Muse] 已合并旧版学习图谱数据到 ~/.folio')
        }
      }
      for (const entry of fs.readdirSync(legacyHome)) {
        if (!fs.existsSync(path.join(folioHome, entry))) {
          fs.renameSync(path.join(legacyHome, entry), path.join(folioHome, entry))
        }
      }
      console.log('[Muse] 旧目录 ~/.ai-terminal 保留作备份，确认无误后可手动删除')
    }
  }
} catch (error) {
  console.warn('[Muse] 数据目录迁移失败:', error.message)
}

const MUSE_HOME = path.join(process.env.HOME, '.folio/muse')
// ReAct 工具的默认工作目录（从模块位置反推项目根目录：src/main/muse → ../../../../）
const PROJECT_DIR = process.env.WORKSPACE_PATH || path.resolve(__dirname, '../../../../')
const JOURNAL_DIR = path.join(MUSE_HOME, 'journal')
const WORKSPACE_DIR = path.join(MUSE_HOME, 'workspace')
const INSIGHTS_DIR = path.join(MUSE_HOME, 'insights')
const PROFILE_DIR = path.join(MUSE_HOME, 'profile')
const TASKS_FILE = path.join(MUSE_HOME, 'tasks.json')
const GOALS_FILE = path.join(MUSE_HOME, 'goals.json')
const AUTONOMY_STATE_FILE = path.join(MUSE_HOME, 'autonomy-state.json')
const SOUL_FILE = path.join(MUSE_HOME, 'SOUL.md')
const SYSLOG_DIR = path.join(MUSE_HOME, 'syslog')
const ERROR_LOG_DIR = path.join(MUSE_HOME, 'error-logs')
const REACT_LOG_DIR = path.join(MUSE_HOME, 'react-logs')

const HEARTBEAT_INTERVAL = 2 * 60 * 1000 // 2 分钟

// 任务执行配置
const MAX_SCRIPT_RETRIES = 3           // 脚本最大重试次数
const MAX_REPAIR_ATTEMPTS = 2          // 子任务自动修复次数
const SCRIPT_TIMEOUT = 120000          // 脚本执行超时(毫秒)
const TASK_COMMAND_DISPLAY_LENGTH = 50 // 任务命令显示长度

// AI 调用超时配置
const AI_TIMEOUT_SHORT = 30000         // 短期 AI 调用(30秒)：简单分析、策略判断
const AI_TIMEOUT_NORMAL = 60000        // 标准 AI 调用(60秒)：任务分析、对话分析
const AI_TIMEOUT_LONG = 120000         // 长期 AI 调用(120秒)：脚本生成、复杂任务
const AI_TIMEOUT_VERY_LONG = 180000    // 超长 AI 调用(180秒)：晨间回顾、复杂脚本

// 探索配置
const EXPLORE_COOLDOWN = 30 * 60 * 1000     // 探索冷却期(30分钟)
const MAX_DAILY_EXPLORES = 10               // 每日最大探索次数
const EXPLORE_HISTORY_FILE = path.join(MUSE_HOME, 'explore-history.json')

// 上下文配置
const MAX_PROFILE_LENGTH = 200         // 画像截取长度
const MAX_RECENT_CHATS = 3             // 最近对话条数
const MAX_UNREAD_LETTERS_THRESHOLD = 5 // 未读信件阈值
const MAX_MEMORIES_DISPLAY = 5         // 最大记忆显示数
const MAX_PROFILES_DISPLAY = 3         // 最大画像维度数

// 大文件分块分析配置
const CHUNK_LINES = 500                    // 每块行数
const LARGE_FILE_THRESHOLD = 800           // 超过此行数视为大文件，触发分块
const CHUNK_MERGE_BATCH_SIZE = 5           // 合并摘要时的批次大小
const CHUNK_SUMMARY_MAX_CHARS = 15000      // 合并后摘要超过此字符数则分层合并

// 任务配置
const MAX_FEEDBACK_HISTORY = 20        // 反馈历史最大长度
const MAX_MODIFICATION_HISTORY = 20    // 修改历史最大长度
const MAX_TASKS_ARCHIVE_DAYS = 30      // 任务归档天数

// 对话式任务迭代配置
const WAITING_REPLY_TIMEOUT = 24 * 60 * 60 * 1000  // 等待回复超时(24小时)
const PREVIEW_FILE_EXTENSIONS = ['.svg', '.html', '.htm', '.css', '.md', '.png', '.jpg', '.gif', '.pdf']  // 支持预览的文件类型
const PREVIEW_FILE_MAX_SIZE = 50000    // 预览文件最大字节数(50KB)

// 自主探索配置
const MEMORY_CONSOLIDATION_THRESHOLD = 5  // 触发记忆归纳的碎片条数
const AUTONOMY_EVALUATE_INTERVAL = 10     // 每N个任务评估一次自主等级

module.exports = {
  MUSE_HOME,
  JOURNAL_DIR,
  WORKSPACE_DIR,
  PROJECT_DIR,
  INSIGHTS_DIR,
  PROFILE_DIR,
  TASKS_FILE,
  GOALS_FILE,
  AUTONOMY_STATE_FILE,
  SOUL_FILE,
  SYSLOG_DIR,
  ERROR_LOG_DIR,
  REACT_LOG_DIR,
  HEARTBEAT_INTERVAL,
  // 任务执行配置
  MAX_SCRIPT_RETRIES,
  MAX_REPAIR_ATTEMPTS,
  SCRIPT_TIMEOUT,
  TASK_COMMAND_DISPLAY_LENGTH,
  // AI 调用超时配置
  AI_TIMEOUT_SHORT,
  AI_TIMEOUT_NORMAL,
  AI_TIMEOUT_LONG,
  AI_TIMEOUT_VERY_LONG,
  // 探索配置
  EXPLORE_COOLDOWN,
  MAX_DAILY_EXPLORES,
  EXPLORE_HISTORY_FILE,
  // 上下文配置
  MAX_PROFILE_LENGTH,
  MAX_RECENT_CHATS,
  MAX_UNREAD_LETTERS_THRESHOLD,
  MAX_MEMORIES_DISPLAY,
  MAX_PROFILES_DISPLAY,
  // 大文件分块分析配置
  CHUNK_LINES,
  LARGE_FILE_THRESHOLD,
  CHUNK_MERGE_BATCH_SIZE,
  CHUNK_SUMMARY_MAX_CHARS,
  // 任务配置
  MAX_FEEDBACK_HISTORY,
  MAX_MODIFICATION_HISTORY,
  MAX_TASKS_ARCHIVE_DAYS,
  // 对话式任务迭代配置
  WAITING_REPLY_TIMEOUT,
  PREVIEW_FILE_EXTENSIONS,
  PREVIEW_FILE_MAX_SIZE,
  // 自主探索配置
  MEMORY_CONSOLIDATION_THRESHOLD,
  AUTONOMY_EVALUATE_INTERVAL
}

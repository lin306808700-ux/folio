'use strict'

const path = require('path')

const MUSE_HOME = path.join(process.env.HOME, '.ai-terminal/muse')
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
const MAX_SKILLS_DISPLAY = 10          // 最大技能显示数
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
  MAX_SKILLS_DISPLAY,
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

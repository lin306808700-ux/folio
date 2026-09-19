'use strict'

/**
 * Muse 模块入口
 * 统一导出所有功能模块
 */

const { init, getStatus } = require('./core')
const { loadTasks, saveTasks, addTask, addSubtask, getSubtasks, updateTaskStatus, suspendTask, resumeTask, areAllSubtasksCompleted, TASKS_FILE } = require('./tasks')
const { loadInitialContext, gatherOwnerContext, getMuseSessionId } = require('./context')
const { sendLetter, setMainWindow } = require('./mailbox')
const { startHeartbeat, stopHeartbeat, pauseHeartbeat, restartHeartbeat, getHeartbeatStatus, heartbeat, getInternalState } = require('./heartbeat')
const { executeCommand, executeTaskFromList, executeSubtasksSequentially } = require('./command')
const { processReply, processTaskFeedback } = require('./feedback')
const { morningReview } = require('./morning')
const { analyzeConversation } = require('./conversation')
const { proactiveExplore, getExploreStats } = require('./explore')
const { archiveOldTasks, getArchiveStats, cleanOldArchives } = require('./archive')
const { chunkedAnalyzeFile, isLargeFile, getFileLineCount, readFileChunks } = require('./chunk-analyzer')
const { MUSE_HOME, JOURNAL_DIR, WORKSPACE_DIR, INSIGHTS_DIR, PROFILE_DIR } = require('./config')

module.exports = {
  // 初始化
  init,
  getStatus,
  setMainWindow,
  
  // 任务管理
  loadTasks,
  saveTasks,
  addTask,
  addSubtask,
  getSubtasks,
  updateTaskStatus,
  suspendTask,
  resumeTask,
  areAllSubtasksCompleted,
  TASKS_FILE,
  
  // 上下文
  loadInitialContext,
  gatherOwnerContext,
  getMuseSessionId,
  
  // 信箱
  sendLetter,
  
  // 心跳
  startHeartbeat,
  stopHeartbeat,
  pauseHeartbeat,
  restartHeartbeat,
  getHeartbeatStatus,
  getInternalState,
  heartbeat,
  
  // 指令执行
  executeCommand,
  executeTaskFromList,
  executeSubtasksSequentially,
  
  // 反馈处理
  processReply,
  processTaskFeedback,
  
  // 晨间回顾
  morningReview,
  
  // 对话分析
  analyzeConversation,
  
  // 主动探索
  proactiveExplore,
  getExploreStats,
  
  // 任务归档
  archiveOldTasks,
  getArchiveStats,
  cleanOldArchives,
  
  // 大文件分块分析
  chunkedAnalyzeFile,
  isLargeFile,
  getFileLineCount,
  readFileChunks,
  
  // 路径常量
  MUSE_HOME,
  JOURNAL_DIR,
  WORKSPACE_DIR,
  INSIGHTS_DIR,
  PROFILE_DIR
}

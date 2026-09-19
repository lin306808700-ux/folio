// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * Muse Agent - 精简入口
 * 所有功能已迁移至 muse/ 模块
 */

const { MUSE_HOME, JOURNAL_DIR, WORKSPACE_DIR, INSIGHTS_DIR, PROFILE_DIR, TASKS_FILE } = require('./muse/config')
const { gatherOwnerContext } = require('./muse/context')
const { loadTasks, saveTasks, addTask, getPendingTask, updateTaskStatus, addSubtask, getSubtasks, areAllSubtasksCompleted, suspendTask, resumeTask } = require('./muse/tasks')
const { sendLetter } = require('./muse/mailbox')
const { startHeartbeat, stopHeartbeat, pauseHeartbeat, restartHeartbeat, getHeartbeatStatus, heartbeat } = require('./muse/heartbeat')
const { SOUL_PROMPT, parseMuseResponse } = require('./muse/prompt')
const { processReply, processTaskFeedback } = require('./muse/feedback')
const { morningReview } = require('./muse/morning')
const { analyzeConversation } = require('./muse/conversation')
const { proactiveExplore } = require('./muse/explore')
const { executeCommand } = require('./muse/command')
const { chunkedAnalyzeFile, isLargeFile } = require('./muse/chunk-analyzer')
const { writeJournal, writeInsight, updateProfile, createInWorkspace, getStatus } = require('./muse/core')
const { collectSyslog, readSyslog } = require('./muse/syslog')

// ========== 初始化 ==========

function init(mainWindow) {
  const { init: coreInit } = require('./muse/core')
  coreInit(mainWindow)
}

// ========== 导出 ==========

module.exports = {
  init,
  getStatus,
  
  // 心跳
  startHeartbeat,
  stopHeartbeat,
  pauseHeartbeat,
  restartHeartbeat,
  getHeartbeatStatus,
  heartbeat,
  
  // 信箱
  sendLetter,
  
  // 任务
  loadTasks,
  saveTasks,
  addTask,
  getPendingTask,
  updateTaskStatus,
  addSubtask,
  getSubtasks,
  areAllSubtasksCompleted,
  suspendTask,
  resumeTask,
  
  // 上下文
  gatherOwnerContext,
  
  // 反馈
  processReply,
  processTaskFeedback,
  
  // 晨间回顾与对话分析
  morningReview,
  analyzeConversation,
  
  // 主动探索
  proactiveExplore,
  
  // 指令执行
  executeCommand,
  
  // 大文件分块分析
  chunkedAnalyzeFile,
  isLargeFile,
  
  // 系统日志
  collectSyslog,
  readSyslog,

  // 工具
  writeJournal,
  writeInsight,
  updateProfile,
  createInWorkspace,
  
  // 常量
  MUSE_HOME,
  JOURNAL_DIR,
  WORKSPACE_DIR,
  INSIGHTS_DIR,
  PROFILE_DIR,
  TASKS_FILE,
  
  // Prompt
  SOUL_PROMPT,
  parseMuseResponse
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 任务归档模块
 * 定期清理已完成/已关闭的任务，防止 tasks.json 无限增长
 */

const fs = require('fs')
const path = require('path')
const { loadTasks, saveTasks } = require('./tasks')
const { MUSE_HOME, MAX_TASKS_ARCHIVE_DAYS } = require('./config')

const ARCHIVE_DIR = path.join(MUSE_HOME, 'archive')
const ARCHIVE_INDEX_FILE = path.join(ARCHIVE_DIR, 'index.json')

/**
 * 初始化归档目录
 */
function initArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  }
}

/**
 * 加载归档索引
 */
function loadArchiveIndex() {
  try {
    if (fs.existsSync(ARCHIVE_INDEX_FILE)) {
      const data = fs.readFileSync(ARCHIVE_INDEX_FILE, 'utf8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.warn('[Muse] 加载归档索引失败:', err.message)
  }
  return { archives: [], totalArchivedTasks: 0 }
}

/**
 * 保存归档索引
 */
function saveArchiveIndex(index) {
  try {
    fs.writeFileSync(ARCHIVE_INDEX_FILE, JSON.stringify(index, null, 2), 'utf8')
  } catch (err) {
    console.error('[Muse] 保存归档索引失败:', err.message)
  }
}

/**
 * 归档旧任务
 * @param {number} daysOld - 归档多少天前的任务（默认使用配置值）
 * @returns {object} 归档结果统计
 */
function archiveOldTasks(daysOld = MAX_TASKS_ARCHIVE_DAYS) {
  console.log(`[Muse] 📦 开始归档 ${daysOld} 天前的任务...`)
  
  initArchiveDir()
  
  const tasks = loadTasks()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)
  const cutoffTime = cutoffDate.getTime()
  
  // 分离需要归档的任务和保留的任务
  const tasksToArchive = []
  const tasksToKeep = []
  
  for (const task of tasks) {
    const completedAt = task.completedAt || task.closedAt
    const shouldArchive = (
      (task.status === 'completed' || task.status === 'closed' || task.status === 'failed') &&
      completedAt &&
      new Date(completedAt).getTime() < cutoffTime
    )
    
    if (shouldArchive) {
      tasksToArchive.push(task)
    } else {
      tasksToKeep.push(task)
    }
  }
  
  if (tasksToArchive.length === 0) {
    console.log('[Muse] 📦 没有需要归档的任务')
    return { archived: 0, remaining: tasks.length }
  }
  
  // 生成归档文件名（按日期）
  const archiveDate = new Date().toISOString().split('T')[0]
  const archiveFile = path.join(ARCHIVE_DIR, `tasks-${archiveDate}.json`)
  
  // 如果今天的归档文件已存在，追加内容
  let existingArchive = []
  if (fs.existsSync(archiveFile)) {
    try {
      existingArchive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'))
    } catch (err) {
      console.warn('[Muse] 读取现有归档文件失败，将创建新文件')
    }
  }
  
  // 保存归档
  const allArchived = [...existingArchive, ...tasksToArchive]
  fs.writeFileSync(archiveFile, JSON.stringify(allArchived, null, 2), 'utf8')
  
  // 更新活跃任务列表
  saveTasks(tasksToKeep)
  
  // 更新归档索引
  const index = loadArchiveIndex()
  index.archives.push({
    file: archiveFile,
    date: archiveDate,
    taskCount: tasksToArchive.length,
    archivedAt: new Date().toISOString()
  })
  index.totalArchivedTasks += tasksToArchive.length
  saveArchiveIndex(index)
  
  console.log(`[Muse] 📦 已归档 ${tasksToArchive.length} 个任务到 ${archiveFile}`)
  console.log(`[Muse] 📦 剩余活跃任务: ${tasksToKeep.length} 个`)
  
  return {
    archived: tasksToArchive.length,
    remaining: tasksToKeep.length,
    archiveFile
  }
}

/**
 * 获取归档统计信息
 */
function getArchiveStats() {
  initArchiveDir()
  
  const index = loadArchiveIndex()
  const tasks = loadTasks()
  
  // 统计活跃任务状态
  const activeStats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    executing: tasks.filter(t => t.status === 'executing').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    suspended: tasks.filter(t => t.status === 'suspended').length,
    closed: tasks.filter(t => t.status === 'closed').length
  }
  
  return {
    active: activeStats,
    archived: {
      totalTasks: index.totalArchivedTasks,
      archiveFiles: index.archives.length,
      recentArchives: index.archives.slice(-5) // 最近 5 次归档
    }
  }
}

/**
 * 清理旧归档文件（可选）
 * @param {number} daysOld - 清理多少天前的归档文件
 */
function cleanOldArchives(daysOld = 90) {
  initArchiveDir()
  
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)
  
  const index = loadArchiveIndex()
  const oldArchives = index.archives.filter(a => new Date(a.date) < cutoffDate)
  
  if (oldArchives.length === 0) {
    console.log('[Muse] 🗑️ 没有需要清理的归档文件')
    return { cleaned: 0 }
  }
  
  // 删除旧归档文件
  for (const archive of oldArchives) {
    try {
      if (fs.existsSync(archive.file)) {
        fs.unlinkSync(archive.file)
      }
    } catch (err) {
      console.warn('[Muse] 删除归档文件失败:', archive.file, err.message)
    }
  }
  
  // 更新索引
  index.archives = index.archives.filter(a => new Date(a.date) >= cutoffDate)
  saveArchiveIndex(index)
  
  console.log(`[Muse] 🗑️ 已清理 ${oldArchives.length} 个旧归档文件`)
  return { cleaned: oldArchives.length }
}

/**
 * 即时归档已完成的任务（由 updateTaskStatus 在任务终态时调用）
 * @param {Array} tasksToArchive - 要归档的任务数组
 */
function archiveCompletedTask(tasksToArchive) {
  if (!tasksToArchive || tasksToArchive.length === 0) return

  initArchiveDir()

  const archiveDate = new Date().toISOString().split('T')[0]
  const archiveFile = path.join(ARCHIVE_DIR, `tasks-${archiveDate}.json`)

  // 读取今天已有的归档
  let existingArchive = []
  if (fs.existsSync(archiveFile)) {
    try {
      existingArchive = JSON.parse(fs.readFileSync(archiveFile, 'utf8'))
    } catch {
      existingArchive = []
    }
  }

  // 追加并写入
  const allArchived = [...existingArchive, ...tasksToArchive]
  fs.writeFileSync(archiveFile, JSON.stringify(allArchived, null, 2), 'utf8')

  // 更新归档索引
  const index = loadArchiveIndex()
  const todayEntry = index.archives.find(a => a.date === archiveDate)
  if (todayEntry) {
    todayEntry.taskCount += tasksToArchive.length
  } else {
    index.archives.push({
      file: archiveFile,
      date: archiveDate,
      taskCount: tasksToArchive.length,
      archivedAt: new Date().toISOString()
    })
  }
  index.totalArchivedTasks += tasksToArchive.length
  saveArchiveIndex(index)
}

module.exports = {
  archiveOldTasks,
  archiveCompletedTask,
  getArchiveStats,
  cleanOldArchives,
  ARCHIVE_DIR
}

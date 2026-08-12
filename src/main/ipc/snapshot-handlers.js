'use strict'

const { ipcMain } = require('electron')
const fileSnapshot = require('../file-snapshot')

/**
 * 注册文件快照相关的 IPC 处理器
 * 供前端调用：查询快照列表、执行回滚、删除快照
 */
function register() {
  // 获取所有快照列表
  ipcMain.handle('snapshot:list', async () => {
    try {
      const snapshots = fileSnapshot.listSnapshots()
      return { success: true, snapshots }
    } catch (error) {
      console.error('[SnapshotHandler] 获取快照列表失败:', error.message)
      return { success: false, error: error.message, snapshots: [] }
    }
  })

  // 回滚到指定时间点（将该时间点之后的所有快照反向覆盖）
  ipcMain.handle('snapshot:rollback', async (_, { timestamp }) => {
    try {
      console.log('[SnapshotHandler] 执行回滚到时间点:', new Date(timestamp).toLocaleString())
      const result = fileSnapshot.rollbackToTimestamp(timestamp)
      return { success: result.success, ...result }
    } catch (error) {
      console.error('[SnapshotHandler] 回滚失败:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 回滚单个快照
  ipcMain.handle('snapshot:rollbackOne', async (_, { snapshotId }) => {
    try {
      console.log('[SnapshotHandler] 回滚单个快照:', snapshotId)
      const result = fileSnapshot.rollbackSnapshot(snapshotId)
      return { success: result.success, ...result }
    } catch (error) {
      console.error('[SnapshotHandler] 回滚失败:', error.message)
      return { success: false, error: error.message }
    }
  })

  // 删除指定快照
  ipcMain.handle('snapshot:delete', async (_, { snapshotId }) => {
    try {
      const deleted = fileSnapshot.deleteSnapshot(snapshotId)
      return { success: deleted }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  console.log('[SnapshotHandler] IPC 处理器已注册')
}

module.exports = { register }

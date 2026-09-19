// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 插件 IPC 处理器
 * 提供前端管理插件的能力：列表/启用/禁用/安装/卸载/重载
 */

function register(ipcMain) {
  const pluginSystem = require('../plugin-system')

  // 获取所有插件列表
  ipcMain.handle('plugins:list', () => {
    try {
      const plugins = pluginSystem.listAll()
      return { success: true, data: plugins }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有注册的工具
  ipcMain.handle('plugins:tools', () => {
    try {
      const tools = pluginSystem.getAllTools()
      return { success: true, data: tools }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 启用/禁用插件
  ipcMain.handle('plugins:setEnabled', (event, { name, enabled }) => {
    try {
      const result = pluginSystem.setEnabled(name, enabled)
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 从目录安装插件
  ipcMain.handle('plugins:installFromDir', (event, { sourceDir }) => {
    try {
      const result = pluginSystem.installFromDir(sourceDir)
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 选择插件目录（通过系统对话框）
  ipcMain.handle('plugins:selectDir', async () => {
    const { dialog } = require('electron')
    const result = await dialog.showOpenDialog({
      title: '选择插件目录',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths.length) {
      return { success: false, canceled: true }
    }
    return { success: true, dirPath: result.filePaths[0] }
  })

  // 卸载插件
  ipcMain.handle('plugins:uninstall', (event, { name }) => {
    try {
      const result = pluginSystem.uninstall(name)
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 重新加载所有插件（热重载）
  ipcMain.handle('plugins:reload', () => {
    try {
      pluginSystem.unloadAll()
      const result = pluginSystem.loadAll()
      return { success: true, data: result }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 执行插件注册的工具
  ipcMain.handle('plugins:executeTool', async (event, { toolName, params }) => {
    try {
      const result = await pluginSystem.executeTool(toolName, params || {})
      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  })
}

module.exports = { register }

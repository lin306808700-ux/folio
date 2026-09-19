// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 设置相关 IPC handlers
 *
 * 安装后用户在应用内填写模型配置，持久化到 userData，
 * 保存后自动重启应用使配置生效。
 */

const { ipcMain, app } = require('electron')
const settingsStore = require('../settings-store')

function register() {
  ipcMain.handle('settings:get', () => {
    const settings = settingsStore.loadSettings()
    return {
      settings: settings || {
        provider: 'qoder',
        openai: { baseUrl: '', apiKey: '', model: '' },
      },
      // 开发环境不强制引导（可用 .env）；
      // 打包后必须通过应用内设置提供配置
      configured: !app.isPackaged || settingsStore.isConfigured(settings) || settingsStore.isEnvConfigured(),
      settingsPath: settingsStore.getSettingsPath(),
    }
  })

  ipcMain.handle('settings:save', (_event, settings) => {
    try {
      const saved = settingsStore.saveSettings(settings || {})
      // 给 IPC 响应留出送达时间后重启，使新配置生效
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 150)
      return { success: true, settings: saved, configured: settingsStore.isConfigured(saved) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { register }

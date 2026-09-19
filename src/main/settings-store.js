// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 应用设置持久化存储
 *
 * 配置保存在 userData 目录（asar 之外），安装后由用户在应用内填写：
 * - macOS:   ~/Library/Application Support/Folio/muse-settings.json
 * - Windows: %APPDATA%/Folio/muse-settings.json
 * - Linux:   ~/.config/Folio/muse-settings.json
 *
 * 启动时（index.js 加载业务模块之前）将配置注入 process.env，
 * model-provider.js 照常从环境变量读取，无需改动调用链。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

// 与 package.json build.productName 保持一致
const PRODUCT_NAME = 'Folio'
const SETTINGS_FILE = 'muse-settings.json'

/**
 * 手动解析 userData 目录（等价于 app.getPath('userData')）。
 * 必须在 app ready 之前可用，因此不依赖 Electron API。
 */
function resolveUserDataDir() {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', PRODUCT_NAME)
    case 'win32':
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), PRODUCT_NAME)
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), PRODUCT_NAME)
  }
}

function getSettingsPath() {
  return path.join(resolveUserDataDir(), SETTINGS_FILE)
}

/** 读取持久化设置；不存在或损坏时返回 null */
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'))
  } catch (_) {
    return null
  }
}

/** 保存设置（自动创建目录），返回实际保存的对象 */
function saveSettings(settings) {
  const normalized = {
    // 默认走本机 Qoder CLI；兼容旧配置：非 openai 一律归一到 qoder（aistudio 已移除）
    provider: settings.provider === 'openai' ? 'openai' : 'qoder',
    openai: {
      baseUrl: (settings.openai?.baseUrl || '').trim(),
      apiKey: (settings.openai?.apiKey || '').trim(),
      model: (settings.openai?.model || '').trim(),
    },
  }
  const dir = resolveUserDataDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getSettingsPath(), JSON.stringify(normalized, null, 2), 'utf-8')
  return normalized
}

/** 当前 provider 的关键配置是否完整 */
function isConfigured(settings) {
  if (!settings || !settings.provider) return false
  if (settings.provider === 'openai') return !!(settings.openai?.apiKey)
  // qoder 零配置：登录态由本机 qodercli login 管理，未登录时调用层报友好错误
  return true
}

/** 环境变量（开发 .env / 外部注入）是否已提供完整配置 */
function isEnvConfigured() {
  const provider = process.env.MUSE_MODEL_PROVIDER
  if (provider === 'openai') return !!process.env.MUSE_API_KEY
  return true // qoder 零配置
}

/**
 * 将设置注入 process.env（不覆盖已存在的环境变量，
 * 开发环境 .env / 显式 env 仍然优先生效）。
 * 返回注入结果，便于日志与诊断。
 */
function applySettingsToEnv(settings) {
  if (!settings) return { applied: false, provider: process.env.MUSE_MODEL_PROVIDER || 'openai' }

  const set = (key, value) => {
    if (value === undefined || value === null || value === '') return
    if (process.env[key] === undefined) process.env[key] = String(value)
  }

  // 旧配置（如 aistudio）归一到 qoder，避免注入已移除的 provider
  set('MUSE_MODEL_PROVIDER', settings.provider === 'openai' ? 'openai' : 'qoder')
  if (settings.provider === 'openai') {
    set('MUSE_API_BASE_URL', settings.openai?.baseUrl)
    set('MUSE_API_KEY', settings.openai?.apiKey)
    set('MUSE_MODEL', settings.openai?.model)
  }
  // qoder 模式无密钥可注入，仅标记 provider；可选环境变量 MUSE_QODER_MODEL/MUSE_QODER_BIN 由用户自行设置
  return { applied: true, provider: settings.provider }
}

module.exports = {
  getSettingsPath,
  loadSettings,
  saveSettings,
  isConfigured,
  isEnvConfigured,
  applySettingsToEnv,
}

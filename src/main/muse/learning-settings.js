// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 学习图谱的本地偏好：目前只有「后台章节预制」开关。
// 预制会持续调用模型，必须是用户可见、可关闭的能力，而不是写死的后台行为。

const fs = require('fs')
const path = require('path')
const { MUSE_HOME } = require('./config')

const SETTINGS_FILE = path.join(MUSE_HOME, 'learning-settings.json')
const DEFAULTS = { prefetchEnabled: true }

function getSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS }
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS }
    return { ...DEFAULTS, ...parsed }
  } catch (error) {
    console.warn('[Muse] 读取学习图谱偏好失败:', error.message)
    return { ...DEFAULTS }
  }
}

function updateSettings(patch = {}) {
  const next = { ...getSettings() }
  if (typeof patch.prefetchEnabled === 'boolean') next.prefetchEnabled = patch.prefetchEnabled
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
    const temporaryFile = `${SETTINGS_FILE}.tmp`
    fs.writeFileSync(temporaryFile, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(temporaryFile, SETTINGS_FILE)
  } catch (error) {
    console.warn('[Muse] 保存学习图谱偏好失败:', error.message)
  }
  return next
}

module.exports = { SETTINGS_FILE, getSettings, updateSettings }

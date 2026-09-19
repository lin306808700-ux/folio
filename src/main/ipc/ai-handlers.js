// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const { callAI } = require('../../shared/ai-client')

const museRouter = require('../muse/router')

const museAgent = require('../muse-agent')

function register(ipcMain, mainWindow) {
  // AI 调用 — 由 Muse Router 接管
  ipcMain.handle('ai:call', async (event, params) => {
    return await museRouter.handleInput(params)
  })

  // AI 流式调用 — 由 Muse Router 接管
  ipcMain.handle('ai:stream', async (event, params) => {
    await museRouter.handleInputStream(params)
    return { success: true }
  })

  // AI 中断流式响应
  ipcMain.handle('ai:abortStream', async () => {
    return museRouter.abortStream()
  })

  // AI 问候语
  ipcMain.handle('ai:greeting', async () => {
    const now = new Date()
    const hour = now.getHours()
    let timeGreeting = ''
    if (hour < 6) timeGreeting = '夜深了'
    else if (hour < 9) timeGreeting = '早上好'
    else if (hour < 12) timeGreeting = '上午好'
    else if (hour < 14) timeGreeting = '中午好'
    else if (hour < 18) timeGreeting = '下午好'
    else if (hour < 22) timeGreeting = '晚上好'
    else timeGreeting = '夜深了'

    // 从 Muse profile 读取画像作为问候语参考
    const fs = require('fs')
    const { PROFILE_DIR } = require('../muse/config')
    let profileHint = ''
    try {
      if (fs.existsSync(PROFILE_DIR)) {
        const files = fs.readdirSync(PROFILE_DIR).filter(f => f.endsWith('.md')).slice(0, 3)
        if (files.length > 0) {
          const snippets = files.map(f => {
            const content = fs.readFileSync(require('path').join(PROFILE_DIR, f), 'utf-8').trim()
            return content.length > 150 ? content.substring(0, 150) + '...' : content
          })
          profileHint = '\n主人画像摘要：\n' + snippets.join('\n')
        }
      }
    } catch (e) { /* ignore */ }

    const prompt = `你是缪斯（Muse），主人身边的贴心智能伴侣。现在${timeGreeting}，请生成一条简短的问候语。

要求：
1. 一句话，不超过 50 字
2. 根据时间段自然问候（如早上好、夜深了注意休息等）
3. 如果有主人画像信息，可以自然地关联提及
4. 如果没有画像信息，给一句温暖或有趣的开场
5. 语气像老朋友，温暖但不刻意
6. 只返回问候语本身，不要有引号或前缀
${profileHint}`

    try {
      const content = await callAI(prompt, { sessionId: `greeting_${Date.now()}`, timeout: 15000 })
      return { success: true, content: content.trim() }
    } catch (e) {
      return { success: true, content: `${timeGreeting}！缪斯在你身边，随时准备好了 ✨` }
    }
  })

  // 记忆系统已移交 Muse 管理，Muse 心跳会自动观察对话并维护主人画像
}

module.exports = { register }

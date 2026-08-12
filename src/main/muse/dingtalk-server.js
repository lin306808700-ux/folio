'use strict'

/**
 * 钉钉 Outgoing 机器人服务
 * 接收来自钉钉群的消息，转给 Muse 处理后回复
 *
 * 配置方式：在 ~/.folio/muse/dingtalk.json 中添加：
 * {
 *   "webhook": "https://...",
 *   "secret": "SEC...",
 *   "outgoing_port": 7788,       // HTTP 监听端口，默认 7788
 *   "outgoing_token": "xxx"      // 钉钉 outgoing 机器人的 token（可选，用于验签）
 * }
 *
 * 钉钉群机器人配置：
 * 1. 在钉钉群 → 智能群助手 → 添加机器人 → 自定义机器人（outgoing）
 * 2. 消息接收地址填：http://你的IP:7788/dingtalk/outgoing
 * 3. token 填写与配置文件中 outgoing_token 一致的值
 */

const http = require('http')
const { loadConfig } = require('./dingtalk')
const { writeJournal } = require('./core')
const { callAI } = require('../../shared/ai-client')
const { SOUL_PROMPT, parseMuseResponse } = require('./prompt')
const { AI_TIMEOUT_NORMAL } = require('./config')

let _server = null
let _mainWindow = null

const DEFAULT_PORT = 7788
const OUTGOING_PATH = '/dingtalk/outgoing'

/**
 * 注入主窗口引用（用于推送消息到前端）
 */
function setMainWindow(win) {
  _mainWindow = win
}

/**
 * 解析钉钉 outgoing 消息体
 * 钉钉 outgoing 机器人 POST body 格式：
 * {
 *   "msgtype": "text",
 *   "text": { "content": "@机器人名 用户消息内容" },
 *   "msgId": "...",
 *   "createAt": 1234567890,
 *   "conversationId": "...",
 *   "conversationTitle": "群名称",
 *   "senderId": "...",
 *   "senderNick": "发送者昵称",
 *   "senderCorpId": "...",
 *   "sessionWebhook": "https://..."  // 可用于直接回复该会话
 * }
 */
function parseDingTalkMessage(body) {
  try {
    const data = JSON.parse(body)
    let content = ''

    if (data.msgtype === 'text' && data.text?.content) {
      // 去掉 @机器人名 前缀
      content = data.text.content.replace(/@\S+\s*/g, '').trim()
    } else if (data.msgtype === 'markdown' && data.markdown?.text) {
      content = data.markdown.text.replace(/@\S+\s*/g, '').trim()
    }

    return {
      content,
      senderNick: data.senderNick || '钉钉用户',
      conversationTitle: data.conversationTitle || '钉钉群',
      sessionWebhook: data.sessionWebhook || null,
      msgId: data.msgId || null,
      raw: data
    }
  } catch (e) {
    console.warn('[DingTalk-Server] 消息解析失败:', e.message)
    return null
  }
}

/**
 * 通过 sessionWebhook 直接回复钉钉会话（比走 webhook 更精准）
 */
async function replyToSession(sessionWebhook, text) {
  if (!sessionWebhook) return false

  const https = require('https')
  const httpModule = sessionWebhook.startsWith('https') ? https : http

  return new Promise((resolve) => {
    const body = JSON.stringify({
      msgtype: 'text',
      text: { content: text }
    })
    const parsed = new URL(sessionWebhook)
    const req = httpModule.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      let chunks = ''
      res.on('data', chunk => { chunks += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(chunks)
          resolve(result.errcode === 0)
        } catch {
          resolve(false)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.write(body)
    req.end()
  })
}

/**
 * 用 AI 分析钉钉消息意图
 * 返回 { intent, taskCommand, replyText, understood }
 * intent: 'task' | 'query' | 'chat' | 'feedback'
 */
async function analyzeIntent(content, senderNick) {
  const { gatherOwnerContext } = require('./context')
  const context = gatherOwnerContext()

  const prompt = `${SOUL_PROMPT}

主人通过钉钉群发来了一条消息，请分析意图并决定如何处理。

【发送者】${senderNick}
【消息内容】${content}

【当前任务数】${context.taskCount || 0} 个

请以 JSON 格式返回：
{
  "understood": "你对这条消息的理解（30字以内）",
  "intent": "task|query|chat|feedback",
  "taskCommand": "如果是 task，这里填写要下达给 Muse 的完整任务指令（其他 intent 留空）",
  "replyText": "立即回复给钉钉群的文字（简短，不超过100字）",
  "letterTitle": "如果是 task，发给主人的信件标题",
  "letterContent": "如果是 task，发给主人的信件内容（说明已收到任务、任务内容、预计处理）"
}

intent 说明：
- task：需要 Muse 执行的任务（如：帮我爬数据、生成报告、分析文件等）
- query：询问状态/信息（如：现在有几个任务、最近做了什么）
- chat：闲聊/问候
- feedback：对已有任务/产物的反馈或修改要求`

  try {
    const response = await callAI(prompt, {
      sessionId: `dingtalk_intent_${Date.now()}`,
      timeout: AI_TIMEOUT_NORMAL
    })
    return parseMuseResponse(response) || { intent: 'chat', replyText: '收到！', understood: content.slice(0, 30) }
  } catch (err) {
    console.warn('[DingTalk-Server] 意图分析失败:', err.message)
    return { intent: 'chat', replyText: '收到！', understood: content.slice(0, 30) }
  }
}

/**
 * 处理 query 意图：查询 Muse 当前状态
 */
async function handleQueryIntent(content, sessionWebhook) {
  const { loadTasks } = require('./tasks')
  const { gatherOwnerContext } = require('./context')
  const context = gatherOwnerContext()
  const tasks = loadTasks()

  const executingTasks = tasks.filter(t => t.status === 'executing' || t.status === 'pending')
  const waitingTasks = tasks.filter(t => t.status === 'waiting_reply')

  const statusLines = [
    `📊 当前状态：`,
    `- 执行中/待执行：${executingTasks.length} 个`,
    `- 等待确认：${waitingTasks.length} 个`,
    `- 总任务数：${tasks.length} 个`
  ]

  if (executingTasks.length > 0) {
    statusLines.push(`\n🔧 进行中：`)
    executingTasks.slice(0, 3).forEach(t => {
      statusLines.push(`- ${t.command?.slice(0, 40) || t.id}`)
    })
  }

  return statusLines.join('\n')
}

/**
 * 处理来自钉钉的消息：先分析意图，再按意图处理
 */
async function handleIncomingMessage(message) {
  const { content, senderNick, conversationTitle, sessionWebhook } = message

  if (!content) {
    console.log('[DingTalk-Server] 收到空消息，忽略')
    return
  }

  console.log(`[DingTalk-Server] 收到来自 ${senderNick}（${conversationTitle}）的消息: ${content.slice(0, 100)}`)
  writeJournal(`**钉钉消息**: 来自 ${senderNick}（${conversationTitle}）\n内容: ${content}`, 'dingtalk')

  // 推送到前端
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('muse:dingtalkMessage', {
      from: senderNick,
      group: conversationTitle,
      content,
      at: new Date().toISOString()
    })
  }

  // AI 分析意图
  const analysis = await analyzeIntent(content, senderNick)
  console.log(`[DingTalk-Server] 意图分析: ${analysis.intent} — ${analysis.understood}`)

  const dingtalk = require('./dingtalk')

  try {
    switch (analysis.intent) {
      case 'task': {
        // 下达任务给 Muse
        const { addTask } = require('./tasks')
        const { sendLetter } = require('./mailbox')
        const { restartHeartbeat } = require('./heartbeat')

        const taskCommand = analysis.taskCommand || content
        addTask(taskCommand, 'high', { source: 'dingtalk', senderNick })

        // 发信给主人（在 Folio 中可见）
        sendLetter({
          title: analysis.letterTitle || `📨 收到钉钉任务`,
          content: analysis.letterContent || `来自 ${senderNick} 的任务：\n${taskCommand}`,
          priority: 'high',
          source: 'dingtalk'
        })

        // 唤醒心跳立即执行
        restartHeartbeat()

        // 回复钉钉群
        const taskReply = analysis.replyText || `✅ 收到！已将任务加入队列，完成后通知你。`
        await sendToGroup(sessionWebhook, taskReply, dingtalk)

        writeJournal(`**钉钉任务下达**: ${taskCommand}\n来自: ${senderNick}`, 'task')
        break
      }

      case 'query': {
        const statusText = await handleQueryIntent(content, sessionWebhook)
        await sendToGroup(sessionWebhook, statusText, dingtalk)
        break
      }

      case 'feedback': {
        // 找到最近 waiting_reply 的任务，转给 feedback 处理
        const { loadTasks } = require('./tasks')
        const { Letters } = require('../database')
        const { processTaskFeedback } = require('./feedback')

        const tasks = loadTasks()
        const waitingTask = tasks.find(t => t.status === 'waiting_reply')

        if (waitingTask) {
          // 构造一个虚拟信件，走 processTaskFeedback 流程
          const fakeLetter = {
            id: `dingtalk_feedback_${Date.now()}`,
            source: 'task',
            taskId: waitingTask.id,
            title: `钉钉反馈: ${content.slice(0, 30)}`
          }
          await processTaskFeedback(fakeLetter, content)
          await sendToGroup(sessionWebhook, analysis.replyText || '✅ 收到反馈，正在处理...', dingtalk)
        } else {
          await sendToGroup(sessionWebhook, '当前没有等待确认的任务。', dingtalk)
        }
        break
      }

      case 'chat':
      default: {
        const chatReply = analysis.replyText || '嗯嗯，收到了 😊'
        await sendToGroup(sessionWebhook, chatReply, dingtalk)
        break
      }
    }
  } catch (err) {
    console.error('[DingTalk-Server] 处理消息失败:', err.message)
    try {
      await sendToGroup(sessionWebhook, `❌ 处理失败: ${err.message}`, dingtalk)
    } catch {}
  }
}

/**
 * 发送消息到钉钉群：优先 sessionWebhook，降级走 webhook
 */
async function sendToGroup(sessionWebhook, text, dingtalk) {
  if (sessionWebhook) {
    const replied = await replyToSession(sessionWebhook, text)
    if (replied) return
  }
  await dingtalk.sendText(text)
}

/**
 * 获取本机局域网 IP（取第一个非 127.x 的 IPv4 地址）
 */
function getLocalIP() {
  const os = require('os')
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

/**
 * 启动 HTTP 服务
 */
function startServer(mainWindow) {
  if (_server) {
    console.log('[DingTalk-Server] 服务已在运行')
    return
  }

  if (mainWindow) _mainWindow = mainWindow

  const config = loadConfig()
  const port = config?.outgoing_port || DEFAULT_PORT
  const token = config?.outgoing_token || null

  _server = http.createServer((req, res) => {
    // 只处理 POST /dingtalk/outgoing
    if (req.method !== 'POST' || req.url !== OUTGOING_PATH) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      // token 验证（钉钉 Outgoing 机器人的 token 在 POST body 中）
      if (token) {
        try {
          const data = JSON.parse(body)
          if (data.token !== token) {
            console.warn('[DingTalk-Server] token 验证失败')
            res.writeHead(403)
            res.end(JSON.stringify({ errcode: 403, errmsg: 'token mismatch' }))
            return
          }
        } catch {
          console.warn('[DingTalk-Server] 解析 body 失败，跳过 token 验证')
        }
      }

      // 立即返回 200，避免钉钉超时重试
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))

      // 异步处理消息
      const message = parseDingTalkMessage(body)
      if (message) {
        handleIncomingMessage(message).catch(err => {
          console.error('[DingTalk-Server] 异步处理异常:', err.message)
        })
      }
    })

    req.on('error', (err) => {
      console.error('[DingTalk-Server] 请求错误:', err.message)
      res.writeHead(500)
      res.end()
    })
  })

  _server.listen(port, '0.0.0.0', () => {
    // 优先用配置里的固定 host，否则自动获取当前本机 IP
    const host = config?.outgoing_host || getLocalIP()
    const outgoingUrl = `http://${host}:${port}${OUTGOING_PATH}`
    console.log(`[DingTalk-Server] Outgoing 服务已启动 → 钉钉接收地址: ${outgoingUrl}`)
    if (!config?.outgoing_host) {
      console.log(`[DingTalk-Server] 提示：IP 会随网络变化，可在 dingtalk.json 中配置 "outgoing_host" 固定地址`)
    }
  })

  _server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[DingTalk-Server] 端口 ${port} 已被占用，outgoing 服务未启动`)
    } else {
      console.error('[DingTalk-Server] 服务错误:', err.message)
    }
    _server = null
  })
}

/**
 * 停止 HTTP 服务
 */
function stopServer() {
  if (!_server) return
  _server.close(() => {
    console.log('[DingTalk-Server] 服务已停止')
  })
  _server = null
}

/**
 * 获取服务状态
 */
function getServerStatus() {
  const config = loadConfig()
  const port = config?.outgoing_port || DEFAULT_PORT
  return {
    running: !!_server,
    port,
    path: OUTGOING_PATH,
    url: `http://0.0.0.0:${port}${OUTGOING_PATH}`
  }
}

module.exports = {
  startServer,
  stopServer,
  getServerStatus,
  setMainWindow,
  DEFAULT_PORT,
  OUTGOING_PATH
}

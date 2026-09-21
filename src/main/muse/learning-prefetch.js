// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 学习图谱「活的书」后台预生成管线。
// 目标：用户打开节点时章节内容已就绪，无需等待实时撰写。
//
// 策略：
// - 以每个图谱的 currentNodeId 为起点 BFS，优先预生成当前位置子树，再覆盖其余节点。
// - 串行生成（底层 callAIStream 本就排队），每章之间留间隔，避免占满资源。
// - 交互式调用（聊天/提问/手动撰写）优先：开跑前检测 isAiBusy 让路；
//   用户手动请求同一节点时通过 abortCallsByLabel 抢占中断当前预生成。
// - 用户下钻新建的子节点没有 content，会被自动纳入队列，实现「书自己长出来」。
// - 失败节点按次数退避，超过上限直接跳过：否则一个永远失败的节点会占住队首，
//   把后面所有章节都饿死。
// - 整条管线受本地偏好开关控制，用户关掉即停。

const { callAIStream, isAiBusy, abortCallsByLabel } = require('../../shared/ai-client')
const { isProviderErrorText } = require('../../shared/ai-error')
const { buildLearningPrompt } = require('./learning-prompts')
const { getSettings } = require('./learning-settings')
const learningMaps = require('./learning-maps').store

const LABEL = 'prefetch'
const GENERATE_INTERVAL_MS = 8000 // 两章之间的喘息间隔
const START_DELAY_MS = 15000 // 启动后延迟开跑，避开应用初始化高峰
const MAX_ATTEMPTS = 3 // 同一节点连续失败多少次后放弃
const BACKOFF_STEP_MS = 60000 // 退避基数：第 n 次失败后冷却 n 分钟

let _getWindow = null
let _timer = null
let _startTimeout = null
let _current = null // { mapId, nodeId, title, controller }
let _bump = null // 用户插队目标 { mapId, nodeId }
let _doneSession = 0
// nodeId -> { attempts, until }：失败退避记录
const _failures = new Map()

// 计算节点从根到自身的标题路径
function getNodePath(map, nodeId) {
  const byId = new Map(map.nodes.map(node => [node.id, node]))
  const titles = []
  const visited = new Set()
  let cursor = byId.get(nodeId)
  while (cursor && !visited.has(cursor.id)) {
    titles.unshift(cursor.title)
    visited.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return titles.join(' > ')
}

function isBlocked(nodeId) {
  const record = _failures.get(nodeId)
  if (!record) return false
  if (record.attempts >= MAX_ATTEMPTS) return true
  return Date.now() < record.until
}

// 汇总所有图谱中缺正文的节点，按「当前位置子树优先」排序
function buildQueue() {
  const queue = []
  for (const map of learningMaps.list()) {
    const byParent = new Map()
    map.nodes.forEach(node => {
      const key = node.parentId || '__root__'
      byParent.set(key, [...(byParent.get(key) || []), node])
    })

    const ordered = []
    const visited = new Set()
    const walk = id => {
      (byParent.get(id) || []).forEach(child => {
        if (visited.has(child.id)) return
        visited.add(child.id)
        ordered.push(child)
        walk(child.id)
      })
    }
    // 先当前位置节点及其子树，再其余节点
    if (map.currentNodeId) {
      const currentNode = map.nodes.find(node => node.id === map.currentNodeId)
      if (currentNode && !visited.has(currentNode.id)) {
        visited.add(currentNode.id)
        ordered.push(currentNode)
      }
      walk(map.currentNodeId)
    }
    map.nodes.forEach(node => {
      if (!visited.has(node.id)) {
        visited.add(node.id)
        ordered.push(node)
      }
    })

    ordered
      .filter(node => !(node.content && node.content.trim()))
      .filter(node => !isBlocked(node.id))
      .forEach(node => queue.push({ mapId: map.id, mapTitle: map.title, map, node }))
  }

  // 插队目标置顶
  if (_bump) {
    const idx = queue.findIndex(item => item.mapId === _bump.mapId && item.node.id === _bump.nodeId)
    if (idx > 0) {
      const [item] = queue.splice(idx, 1)
      queue.unshift(item)
    } else if (idx === -1) {
      _bump = null // 目标已有正文、不存在或正在退避，清掉
    }
  }
  return queue
}

// 已放弃的节点数（连续失败超上限），用于向用户说明「这几章暂缓」
function stalledCount() {
  let count = 0
  _failures.forEach(record => {
    if (record.attempts >= MAX_ATTEMPTS) count += 1
  })
  return count
}

function getStatus() {
  return {
    active: Boolean(_current),
    current: _current ? { mapId: _current.mapId, nodeId: _current.nodeId, title: _current.title } : null,
    queueLeft: buildQueue().length,
    stalled: stalledCount(),
    enabled: getSettings().prefetchEnabled,
    doneSession: _doneSession,
  }
}

function emitStatus(extra = {}) {
  try {
    const win = _getWindow ? _getWindow() : null
    if (win && !win.isDestroyed()) {
      win.webContents.send('muse:learning:prefetchStatus', { ...getStatus(), ...extra })
    }
  } catch (_) { /* 窗口状态竞态忽略 */ }
}

function recordFailure(nodeId) {
  const record = _failures.get(nodeId) || { attempts: 0, until: 0 }
  record.attempts += 1
  record.until = Date.now() + BACKOFF_STEP_MS * record.attempts
  _failures.set(nodeId, record)
  if (record.attempts >= MAX_ATTEMPTS) {
    console.warn(`[LearningPrefetch] 章节连续失败 ${record.attempts} 次，暂时跳过该节点`)
  }
}

async function generateOne(item) {
  const controller = new AbortController()
  _current = { mapId: item.mapId, nodeId: item.node.id, title: item.node.title, controller }
  emitStatus()

  try {
    const prompt = buildLearningPrompt({
      kind: 'content',
      mapTitle: item.mapTitle,
      nodePath: getNodePath(item.map, item.node.id),
      nodeTitle: item.node.title,
    })
    let content = ''
    for await (const frame of callAIStream(prompt, { signal: controller.signal, label: LABEL })) {
      content = frame.content || content
    }
    // 被交互请求抢占中断 → 不算失败、不落盘，下一轮队列仍在，稍后重试
    if (controller.signal.aborted) return
    // 上游偶发把额度/鉴权错误当正文吐出来。这类文本一旦落盘就成了一段不可读的
    // 「章节」，而且 content 非空会让队列判定它「已写好」，永远不再重试。
    // 所以按失败处理：记退避，留待恢复后重跑。
    if (isProviderErrorText(content)) {
      console.warn(`[LearningPrefetch] ${item.node.title} 返回的是上游报错，已丢弃`)
      recordFailure(item.node.id)
    } else if (content && content.trim()) {
      learningMaps.updateNode(item.mapId, item.node.id, { content })
      _failures.delete(item.node.id)
      _doneSession += 1
      if (_bump && _bump.nodeId === item.node.id) _bump = null
      console.log(`[LearningPrefetch] 已预制章节: ${item.node.title}（本次会话 ${_doneSession} 章）`)
      emitStatus({ lastDone: { mapId: item.mapId, nodeId: item.node.id } })
    } else {
      recordFailure(item.node.id)
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.warn(`[LearningPrefetch] 预生成失败 ${item.node.title}:`, error.message)
      recordFailure(item.node.id)
    }
  } finally {
    _current = null
  }
}

function tick() {
  if (_current) return
  if (!getSettings().prefetchEnabled) return
  // 有交互调用在用 AI（聊天/提问/ReAct 等）→ 让路
  if (isAiBusy([LABEL])) return
  const queue = buildQueue()
  if (queue.length === 0) return
  generateOne(queue[0]).catch(() => {})
}

function start(getWindow, { delayMs = START_DELAY_MS, intervalMs = GENERATE_INTERVAL_MS } = {}) {
  if (getWindow) _getWindow = getWindow
  if (_timer || _startTimeout) return
  if (!getSettings().prefetchEnabled) {
    console.log('[LearningPrefetch] 后台预生成已关闭，跳过启动')
    return
  }
  _startTimeout = setTimeout(() => {
    _startTimeout = null
    tick()
    _timer = setInterval(tick, intervalMs)
  }, delayMs)
  console.log('[LearningPrefetch] 后台预生成管线已启动')
}

function stop() {
  if (_startTimeout) { clearTimeout(_startTimeout); _startTimeout = null }
  if (_timer) { clearInterval(_timer); _timer = null }
  if (_current) _current.controller.abort()
}

// 偏好切换：关掉立即停（并丢弃在跑的那章），开启立即接上
function setEnabled(enabled) {
  if (enabled) {
    // 用户重新打开时清掉退避记录，给之前失败的章节一次机会
    _failures.clear()
    stop()
    start(null)
  } else {
    stop()
  }
  emitStatus()
  return getStatus()
}

// 用户手动撰写/打开节点时插队：优先该节点；若后台正在写同一章则让位
function bump(mapId, nodeId) {
  _bump = { mapId, nodeId }
  if (_current && _current.mapId === mapId && _current.nodeId === nodeId) {
    _current.controller.abort()
  }
}

// 交互式 AI 调用开始前调用：抢占中断正在进行的预生成，避免用户排队等待
function preemptForInteractive() {
  return abortCallsByLabel(LABEL)
}

module.exports = { start, stop, setEnabled, bump, getStatus, preemptForInteractive, buildQueue, LABEL }

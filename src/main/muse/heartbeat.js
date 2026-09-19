// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const { HEARTBEAT_INTERVAL, MAX_TASKS_ARCHIVE_DAYS, AI_TIMEOUT_SHORT, WAITING_REPLY_TIMEOUT } = require('./config')
const { loadTasks, getPendingTask, getSubtasks, updateTaskStatus, areAllSubtasksCompleted } = require('./tasks')
const { gatherOwnerContext, getMuseSessionId } = require('./context')
const { sendLetter } = require('./mailbox')
const { executeTaskFromList, executeSubtasksSequentially } = require('./command')
const { parseMuseResponse } = require('./prompt')
const { proactiveExplore } = require('./explore')
const { archiveOldTasks } = require('./archive')
const { callAI } = require('../../shared/ai-client')
const { Letters } = require('../database')
const { getActiveGoals, getNextExploreStep, completeExploreStep, areAllStepsCompleted, completeGoal, addExploreStep, getById } = require('./goals')
const { consolidateMemories, runDecay } = require('./knowledge')

let _heartbeatTimer = null
let _heartbeatCount = 0
let _archiveTimer = null
let _lastArchiveDate = null
let _lastConsolidationDate = null

// 异步互斥锁：防止心跳并发执行（带超时自动释放）
const LOCK_TIMEOUT = 10 * 60 * 1000 // 10 分钟超时自动释放，防止死锁

class AsyncLock {
  constructor() {
    this._locked = false
    this._waiting = []
    this._lockedAt = null
  }

  async acquire() {
    // 检查是否超时死锁，自动释放
    if (this._locked && this._lockedAt) {
      const elapsed = Date.now() - this._lockedAt
      if (elapsed > LOCK_TIMEOUT) {
        console.warn(`[Muse] ⚠️ 锁超时 ${Math.round(elapsed / 1000)}s，强制释放`)
        this._locked = false
        this._lockedAt = null
        this._waiting = []
      }
    }

    if (!this._locked) {
      this._locked = true
      this._lockedAt = Date.now()
      return
    }
    // 已有锁，等待释放
    return new Promise(resolve => {
      this._waiting.push(resolve)
    })
  }

  release() {
    if (!this._locked) {
      console.warn('[Muse] ⚠️ 尝试释放未持有的锁')
      return
    }
    if (this._waiting.length > 0) {
      // 有等待者，转移锁
      const next = this._waiting.shift()
      this._lockedAt = Date.now()
      next()
    } else {
      // 无等待者，释放锁
      this._locked = false
      this._lockedAt = null
    }
  }

  isLocked() {
    // 检查超时
    if (this._locked && this._lockedAt) {
      const elapsed = Date.now() - this._lockedAt
      if (elapsed > LOCK_TIMEOUT) {
        console.warn(`[Muse] ⚠️ isLocked 检测到锁超时 ${Math.round(elapsed / 1000)}s，强制释放`)
        this._locked = false
        this._lockedAt = null
        this._waiting = []
      }
    }
    return this._locked
  }

  getWaitCount() {
    return this._waiting.length
  }
}

const _executionLock = new AsyncLock()

/**
 * 设置任务执行状态（供外部调用）
 * @deprecated 使用 _executionLock 替代
 */
function setExecutingTask(value) {
  console.warn('[Muse] ⚠️ setExecutingTask 已废弃，请使用 AsyncLock')
}

/**
 * 设置思考状态（供外部调用）
 * @deprecated 使用 _executionLock 替代
 */
function setThinking(value) {
  console.warn('[Muse] ⚠️ setThinking 已废弃，请使用 AsyncLock')
}

/**
 * 获取内部状态（供调试）
 */
function getInternalState() {
  return {
    isExecutingTask: _executionLock.isLocked(),
    isThinking: _executionLock.isLocked(),
    heartbeatCount: _heartbeatCount,
    lockWaitCount: _executionLock.getWaitCount()
  }
}

/**
 * 启动心跳循环
 */
function startHeartbeat() {
  if (_heartbeatTimer) {
    console.log('[Muse] 心跳已在运行，跳过')
    return
  }
  console.log(`[Muse] ❤️ 启动心跳循环，间隔 ${HEARTBEAT_INTERVAL / 1000}s`)
  
  // 启动时立即执行一次心跳
  heartbeat().catch(err => {
    console.error('[Muse] 启动心跳异常:', err.message)
  })
  
  // 然后按间隔循环
  _heartbeatTimer = setInterval(() => {
    heartbeat().catch(err => {
      console.error('[Muse] 心跳异常:', err.message)
    })
  }, HEARTBEAT_INTERVAL)
  
  // 启动每日归档检查（每天凌晨 3 点）
  startArchiveScheduler()
}

/**
 * 停止心跳循环
 */
function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer)
    _heartbeatTimer = null
    console.log('[Muse] 心跳已停止')
  }
  stopArchiveScheduler()
}

/**
 * 暂停心跳（保留状态，可以随时重启）
 */
function pauseHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer)
    _heartbeatTimer = null
    console.log('[Muse] ⏸️ 心跳已暂停')
    return { success: true, paused: true }
  }
  console.log('[Muse] ⏸️ 心跳已在暂停状态')
  return { success: true, paused: true }
}

/**
 * 重启心跳（立即执行一次心跳）
 */
function restartHeartbeat() {
  console.log('[Muse] 🔄 重启心跳')
  
  // 立即执行一次心跳
  heartbeat().catch(err => {
    console.error('[Muse] 重启心跳异常:', err.message)
  })
  
  // 然后按间隔循环
  _heartbeatTimer = setInterval(() => {
    heartbeat().catch(err => {
      console.error('[Muse] 心跳异常:', err.message)
    })
  }, HEARTBEAT_INTERVAL)
  
  return { success: true, restarted: true }
}

/**
 * 获取心跳状态
 */
function getHeartbeatStatus() {
  return {
    isRunning: !!_heartbeatTimer,
    interval: HEARTBEAT_INTERVAL / 1000,
    archiveSchedulerRunning: !!_archiveTimer,
    lastArchiveDate: _lastArchiveDate
  }
}

/**
 * 启动归档调度器（每天凌晨 3 点执行）
 */
function startArchiveScheduler() {
  if (_archiveTimer) {
    console.log('[Muse] 归档调度器已在运行，跳过')
    return
  }
  
  console.log('[Muse] 📦 启动归档调度器（每日凌晨 3 点）')
  
  // 计算距离下一个凌晨 3 点的毫秒数
  function getNextArchiveTime() {
    const now = new Date()
    const next = new Date(now)
    next.setHours(3, 0, 0, 0)
    
    // 如果今天的 3 点已过，设置为明天 3 点
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
    
    return next
  }
  
  function scheduleNext() {
    const nextTime = getNextArchiveTime()
    const delay = nextTime.getTime() - Date.now()
    
    console.log(`[Muse] 📦 下次归档时间: ${nextTime.toLocaleString()}（${Math.round(delay / 3600000)} 小时后）`)
    
    _archiveTimer = setTimeout(() => {
      runArchiveCheck()
      scheduleNext() // 递归调度下一次
    }, delay)
  }
  
  // 立即检查一次（如果是首次启动）
  runArchiveCheck()
  scheduleNext()
}

/**
 * 停止归档调度器
 */
function stopArchiveScheduler() {
  if (_archiveTimer) {
    clearTimeout(_archiveTimer)
    _archiveTimer = null
    console.log('[Muse] 📦 归档调度器已停止')
  }
}

/**
 * 执行归档检查
 */
async function runArchiveCheck() {
  const today = new Date().toISOString().split('T')[0]
  
  // 避免同一天重复归档
  if (_lastArchiveDate === today) {
    console.log('[Muse] 📦 今日已执行归档，跳过')
    return
  }
  
  console.log('[Muse] 📦 执行每日归档检查...')
  
  try {
    const result = archiveOldTasks(MAX_TASKS_ARCHIVE_DAYS)
    _lastArchiveDate = today
    
    if (result.archived > 0) {
      console.log(`[Muse] 📦 归档完成: ${result.archived} 个任务`)
      
      // 发送通知
      sendLetter({
        title: '📦 任务归档完成',
        content: `已自动归档 ${result.archived} 个旧任务（${MAX_TASKS_ARCHIVE_DAYS} 天前）。\n\n剩余活跃任务: ${result.remaining} 个。`,
        priority: 'low',
        source: 'system'
      })
    }
  } catch (err) {
    console.error('[Muse] 归档检查失败:', err.message)
  }
}

/**
 * 心跳一次：轻量级自主决策 + 任务执行
 * 使用异步锁确保并发安全
 */
async function heartbeat() {
  _heartbeatCount++

  // 尝试获取锁（非阻塞检查）
  if (_executionLock.isLocked()) {
    console.log(`[Muse] ❤️ 心跳 #${_heartbeatCount} 跳过：正在执行任务（锁已被占用）`)
    return
  }

  // 获取执行锁
  await _executionLock.acquire()

  try {
    // 加载任务列表
    const tasks = loadTasks()
    
    // 检查 waiting_reply 超时：超过 24 小时未回复的任务自动恢复为 pending
    const waitingTasks = tasks.filter(t => t.status === 'waiting_reply' && t.waitingSince)
    for (const waitingTask of waitingTasks) {
      const elapsed = Date.now() - new Date(waitingTask.waitingSince).getTime()
      if (elapsed > WAITING_REPLY_TIMEOUT) {
        console.log(`[Muse] ⏰ waiting_reply 超时（${Math.round(elapsed / 3600000)}h），自动恢复:`, waitingTask.id)
        updateTaskStatus(waitingTask.id, {
          status: 'pending',
          waitingReason: null,
          waitingSince: null
        })
        sendLetter({
          title: `⏰ 等待超时，自动继续`,
          content: `主人，之前的问题你没有回复，我先按自己的判断继续执行了。\n\n任务: ${waitingTask.command.slice(0, 200)}`,
          priority: 'normal',
          source: 'task',
          taskId: waitingTask.id
        })
      }
    }

    // 检查无子任务的僵尸 executing 任务：超过 30 分钟且当前无执行锁（说明进程已退出但状态未更新）
    // 如果执行锁还在占用中，说明任务可能还在跑（如增量生成模式），不要强行挂起
    const ZOMBIE_TASK_THRESHOLD = 30 * 60 * 1000
    const zombieTasks = tasks.filter(t => t.status === 'executing' && (!t.subtasks || t.subtasks.length === 0) && t.startedAt)
    for (const zombie of zombieTasks) {
      const elapsed = Date.now() - new Date(zombie.startedAt).getTime()
      if (elapsed > ZOMBIE_TASK_THRESHOLD) {
        const elapsedMin = Math.round(elapsed / 60000)
        console.log(`[Muse] ⚠️ 任务执行超时（${elapsedMin}min），挂起:`, zombie.id)
        updateTaskStatus(zombie.id, {
          status: 'suspended',
          suspendedAt: new Date().toISOString(),
          suspendReason: `执行超时 ${elapsedMin} 分钟，已自动挂起`
        })
        sendLetter({
          title: `⚠️ 任务执行超时已挂起`,
          content: `主人，以下任务已执行 ${elapsedMin} 分钟仍未完成，已自动挂起等待您处理。\n\n**任务**: ${zombie.command.slice(0, 200)}\n\n您可以回复「继续」重新执行，或「取消」放弃此任务。`,
          priority: 'high',
          source: 'task',
          taskId: zombie.id
        })
      }
    }

    // 每日首次心跳：记忆归纳 + 衰减
    const today = new Date().toISOString().slice(0, 10)
    if (_lastConsolidationDate !== today) {
      _lastConsolidationDate = today
      console.log('[Muse] 🧠 执行每日记忆维护...')
      try { runDecay() } catch (e) { console.warn('[Muse] 记忆衰减失败:', e.message) }
      try { await consolidateMemories() } catch (e) { console.warn('[Muse] 记忆归纳失败:', e.message) }
    }

    // 优先检查是否有主人的待办任务（包括子任务）
    const pendingTask = getPendingTask()
    if (pendingTask) {
      console.log('[Muse] 📋 发现待办任务:', pendingTask.id, pendingTask.type ? `(${pendingTask.type})` : '')
      
      // 如果是决策任务，跳过（等待主人回复）
      if (pendingTask.type === 'decision') {
        console.log('[Muse] ⏸️ 决策任务等待主人回复，跳过')
      } else {
        await executeTaskFromList(pendingTask)
      }
      return
    }

    // 跳过 waiting_reply 状态的任务（等待主人回复，不要自动执行）
    const stillWaiting = tasks.filter(t => t.status === 'waiting_reply')
    if (stillWaiting.length > 0) {
      console.log(`[Muse] ⏸️ ${stillWaiting.length} 个任务等待主人回复，跳过执行`)
    }

    // 检查执行中的父任务，是否有待执行或卡住的子任务
    const executingTasks = tasks.filter(t => t.status === 'executing' && t.subtasks && t.subtasks.length > 0)
    
    for (const executingTask of executingTasks) {
      const subtasks = getSubtasks(executingTask.id)
      
      // 修复僵尸子任务：状态为 executing 但启动超过 15 分钟，视为僵尸
      const ZOMBIE_THRESHOLD = 15 * 60 * 1000
      for (const st of subtasks) {
        if (st.status === 'executing' && st.startedAt) {
          const elapsed = Date.now() - new Date(st.startedAt).getTime()
          if (elapsed > ZOMBIE_THRESHOLD) {
            console.log(`[Muse] 🔧 修复僵尸子任务（executing ${Math.round(elapsed / 60000)}min → pending）:`, st.id)
            updateTaskStatus(st.id, { status: 'pending', startedAt: null })
          }
        }
      }
      
      const pendingSubtasks = subtasks.filter(st => st.status === 'pending' || st.status === 'executing')
      
      if (pendingSubtasks.length > 0) {
        console.log('[Muse] 🔄 发现执行中任务的待执行子任务，继续:', executingTask.id)
        await executeSubtasksSequentially(executingTask.id)
        return
      }
    }

    // 检查挂起的任务（子任务失败导致的）
    const suspendedTasks = tasks.filter(t => t.status === 'suspended' && t.subtasks && t.subtasks.length > 0)
    
    for (const suspendedTask of suspendedTasks) {
      const failedSubtasks = getSubtasks(suspendedTask.id).filter(st => st.status === 'failed')
      const pendingSubtasks = getSubtasks(suspendedTask.id).filter(st => st.status === 'pending')
      
      // 如果有 pending 的子任务（主人修改后重新设为 pending），继续执行
      if (pendingSubtasks.length > 0) {
        console.log('[Muse] 🔄 发现主人修改的子任务，继续执行:', suspendedTask.id)
        await executeSubtasksSequentially(suspendedTask.id)
        break
      }
      
      // 如果所有子任务都完成了（旧逻辑兼容）
      if (areAllSubtasksCompleted(suspendedTask.id)) {
        console.log('[Muse] ✅ 父任务的所有子任务已完成，恢复:', suspendedTask.id)
        
        // 收集所有子任务结果
        const subtasks = getSubtasks(suspendedTask.id)
        const results = subtasks.map(st => ({
          command: st.command,
          result: st.result
        }))

        // 恢复父任务并标记完成
        updateTaskStatus(suspendedTask.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          result: { subtasks: results }
        })

        // 通知主人
        sendLetter({
          title: `✅ 复杂任务完成`,
          content: `主人的任务已完成！\n\n共执行了 ${subtasks.length} 个子任务：\n${subtasks.map(st => `- ${st.command}`).join('\n')}\n\n请查收成果。`,
          priority: 'normal',
          source: 'task'
        })

        console.log('[Muse] ✅ 复杂任务已全部完成:', suspendedTask.id)
      }
      // 如果所有子任务都失败了，通知主人
      else if (failedSubtasks.length > 0) {
        console.log('[Muse] ⚠️ 父任务有失败的子任务:', suspendedTask.id)
      }
    }

        // 没有待办任务，先尝试 syslog 分析（每天最多一次）
    const { analyzeSyslog, shouldAnalyzeToday } = require('./syslog-analyzer')
    if (shouldAnalyzeToday()) {
      console.log('[Muse] 📊 触发每日 syslog 分析...')
      await analyzeSyslog()
      return
    }

    // 目标驱动决策：检查是否有活跃目标需要推进
    const activeGoals = getActiveGoals()
    if (activeGoals.length > 0) {
      const goal = activeGoals[0]
      const nextStep = getNextExploreStep(goal.id)

      if (nextStep) {
        // 有未探索步骤 → 主动探索
        console.log(`[Muse] 🎯 目标驱动探索: ${goal.title} → ${nextStep.topic}`)
        try {
          const exploreResult = await proactiveExplore(nextStep.topic, { goalId: goal.id })
          if (exploreResult.success) {
            completeExploreStep(goal.id, nextStep.stepIndex, {
              title: nextStep.topic,
              summary: exploreResult.result?.summary || ''
            })
            sendLetter({
              title: `🎯 探索进展: ${nextStep.topic}`,
              content: `主人，我在推进「${goal.title}」目标时探索了 **${nextStep.topic}**。

${exploreResult.result?.summary || '探索完成'}${exploreResult.result?.keyFindings?.length ? '\n\n关键发现:\n' + exploreResult.result.keyFindings.map(f => '- ' + f).join('\n') : ''}`,
              priority: 'normal',
              source: 'goal'
            })
          }
        } catch (e) {
          console.warn('[Muse] 目标探索失败:', e.message)
        }
        return
      }

      // 所有步骤完成 → 检查是否需要扩展或完成
      if (areAllStepsCompleted(goal.id)) {
        const insights = goal.insights || []
        const insightList = insights.map((i, idx) => `${idx + 1}. ${i.title}: ${i.summary}`).join('\n')

        // AI 判断：扩展新步骤 or 完成目标
        const goalPrompt = `你是缪斯。你正在推进一个长期目标。

【目标】${goal.title}
【方向】${goal.direction}
【已完成步骤】${goal.exploreSteps?.length || 0} 步
【已积累洞察】
${insightList || '暂无'}

请判断下一步：
1. expand - 目标尚未充分探索，需要新增步骤（返回 nextSteps 数组）
2. complete - 目标已充分探索，可以完成（返回 completionSummary）
3. idle - 暂时无法判断，等待主人输入

JSON: {"action":"expand|complete|idle","nextSteps":["新步骤1","新步骤2"],"completionSummary":"完成总结","letterToOwner":"想对主人说的话"}`

        try {
          const resp = await callAI(goalPrompt, { sessionId: getMuseSessionId(), timeout: AI_TIMEOUT_SHORT })
          const goalDecision = parseMuseResponse(resp)
          if (goalDecision) {
            if (goalDecision.action === 'expand' && goalDecision.nextSteps?.length > 0) {
              for (const step of goalDecision.nextSteps) {
                addExploreStep(goal.id, step)
              }
              console.log(`[Muse] 🎯 目标扩展 ${goalDecision.nextSteps.length} 个新步骤`)
              return
            }
            if (goalDecision.action === 'complete') {
              completeGoal(goal.id)
              sendLetter({
                title: `🎯 目标完成: ${goal.title}`,
                content: `主人，目标「${goal.title}」已完成探索！\n\n${goalDecision.completionSummary || ''}\n\n共完成 ${goal.exploreSteps?.length || 0} 个探索步骤，积累了 ${insights.length} 条洞察。`,
                priority: 'normal',
                source: 'goal'
              })
              console.log(`[Muse] 🎯 目标完成: ${goal.title}`)
              return
            }
          }
        } catch (e) {
          console.warn('[Muse] 目标决策失败:', e.message)
        }
        return
      }
    }

    // 常规自主决策（无活跃目标时的轻量决策）
    console.log('[Muse] 🤔 无待办任务和目标，开始自主决策...')
    const context = gatherOwnerContext()

    // 精简版 profile（截取 200 字）
    const profileBrief = (context.profile || '').slice(0, 200)
    // 最近 3 条对话
    const recentChats = (context.recentHistory || '').split('\n---\n').slice(0, 3).join('\n')
    // 未读信件数
    const unreadCount = Letters.getUnreadCount()
    // 活跃目标数
    const goalCount = activeGoals.length

    const prompt = `你是缪斯（Muse）。现在做一次快速扫描。

【主人近期关注】
${profileBrief || '（暂无画像）'}

【最近对话】
${recentChats || '（暂无对话）'}

【待读信件】${unreadCount} 封
【活跃目标】${goalCount} 个

决定下一步行动，JSON:
{"action":"idle|explore|letter|suggest_goal","topic":"探索主题","letterTitle":"信件标题","letterContent":"信件内容","priority":"low|normal|high","goalTitle":"建议的目标标题","goalDescription":"目标描述","goalDirection":"目标方向"}

规则:
- 大多数时候应该 idle，不要制造噪音
- 只有真正有价值的发现才发 letter
- 如果待读信件超过 5 封，不要再发新信，优先 idle
- explore 在主人近期有明确兴趣点时触发，主动搜索并积累洞察
- suggest_goal 在发现主人有值得长期跟进的方向时触发
- 返回纯 JSON，不要解释`

    const response = await callAI(prompt, {
      sessionId: getMuseSessionId(),
      timeout: AI_TIMEOUT_SHORT
    })

    const result = parseMuseResponse(response)
    if (!result || !result.action) {
      console.log('[Muse] 心跳解析失败，跳过')
      return
    }

    console.log(`[Muse] 心跳决策: ${result.action}`)

    switch (result.action) {
      case 'explore':
        // 探索已启用：主动搜索并积累洞察
        console.log('[Muse] 🔍 主动探索:', result.topic)
        try {
          const exploreResult = await proactiveExplore(result.topic)
          if (exploreResult.success && exploreResult.result?.shouldCreateInsight) {
            sendLetter({
              title: `🔍 探索发现: ${result.topic}`,
              content: `${exploreResult.result.summary || ''}\n\n${exploreResult.result.keyFindings?.length ? '关键发现:\n' + exploreResult.result.keyFindings.map(f => '- ' + f).join('\n') : ''}`,
              priority: 'normal',
              source: 'explore'
            })
          }
        } catch (e) {
          console.warn('[Muse] 探索执行失败:', e.message)
        }
        break

      case 'letter':
        if (result.letterTitle && result.letterContent) {
          console.log('[Muse] ✉️ 发送主动信件:', result.letterTitle)
          sendLetter({
            title: result.letterTitle,
            content: result.letterContent,
            priority: result.priority || 'normal',
            source: 'heartbeat'
          })
        }
        break

      case 'suggest_goal':
        if (result.goalTitle) {
          console.log('[Muse] 🎯 建议新目标:', result.goalTitle)
          sendLetter({
            title: `🎯 建议新目标: ${result.goalTitle}`,
            content: `主人，我注意到你最近在关注「${result.goalDirection || result.goalTitle}」相关的方向，建议我们设定一个长期目标来系统性地探索。\n\n**目标**: ${result.goalTitle}\n**描述**: ${result.goalDescription || ''}\n**方向**: ${result.goalDirection || ''}\n\n如果你同意，回复「开始」我就开始探索。也可以告诉我你想调整的方向。`,
            priority: 'normal',
            source: 'goal_suggestion'
          })
        }
        break

      case 'idle':
      default:
        console.log('[Muse] 💤 无事可做，休息')
        break
    }
  } catch (err) {
    console.error('[Muse] 心跳执行失败:', err.message)
  } finally {
    // 释放执行锁
    _executionLock.release()
  }
}

module.exports = {
  startHeartbeat,
  stopHeartbeat,
  pauseHeartbeat,
  restartHeartbeat,
  getHeartbeatStatus,
  heartbeat,
  setExecutingTask,
  setThinking,
  getInternalState
}

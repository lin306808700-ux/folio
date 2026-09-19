#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 生成内置「AI Agent 实现原理」图谱：
// 1) 在 ~/.folio/muse/learning-maps.json 中创建/合并 learn_map_builtin_agent 节点树
// 2) 逐章调用 AI（与预生成同一链路）撰写正文，每章完成后原子落盘，可中断续跑
// 生成完毕后执行 scripts/export-builtin-maps.js 固化进 builtin-learning-maps.json。
//
// 用法：
//   node scripts/generate-builtin-agent-map.js            # 全量（跳过已有正文）
//   node scripts/generate-builtin-agent-map.js --limit 1  # 只生成 1 章（验证用）
//   node scripts/generate-builtin-agent-map.js --only agent_node_005

const fs = require('fs')
const os = require('os')
const path = require('path')
const { callAIStream } = require('../src/shared/ai-client')
const { buildLearningPrompt } = require('../src/main/muse/learning-prompts')

const MAP_ID = 'learn_map_builtin_agent'
const MAP_TITLE = 'AI Agent 实现原理'
const MAP_DESC = '以 Claude Code 为参考实现，拆解主流编码 Agent 的内部机制：核心循环、工具系统、上下文工程、执行规划、多智能体编排与主流实现横评。'
const DATA_FILE = path.join(os.homedir(), '.folio/muse/learning-maps.json')

// 全书定位说明，注入每章生成提示词，保证风格与事实基准一致
const BOOK_PREAMBLE = [
  '本书名为《AI Agent 实现原理》，读者是想搞懂主流编码 Agent 内部实现的资深工程师。',
  '全书以 Claude Code（Anthropic 的终端编码 Agent）为参考实现：业界没有事实标准的地方，以 Claude Code 的设计为准，并明确说明这是参考实现的做法。',
  '写本章时请贴合该定位：优先讲具体机制、结构与实现细节，不要写成泛泛的科普。',
].join('\n')

// ========== 书目大纲（49 章） ==========
// 约定：parentId 必须出现在前面的条目中；根节点 parentId 为 null
const OUTLINE = [
  { id: 'agent_node_001', parentId: null, title: 'AI Agent 实现原理', summary: '全书导读：Agent 是什么、由哪些子系统构成、为什么以 Claude Code 为参考实现。' },

  { id: 'agent_node_010', parentId: 'agent_node_001', title: 'Agent 基础', summary: 'Agent 的定义边界、核心循环与 ReAct 范式。' },
  { id: 'agent_node_011', parentId: 'agent_node_010', title: '什么是 AI Agent：与聊天机器人、工作流的边界', summary: 'Agent 的判定标准：自主决策 + 工具执行 + 多步循环。' },
  { id: 'agent_node_012', parentId: 'agent_node_010', title: '核心循环：模型 → 工具 → 观察', summary: 'Agent 主循环的结构、终止条件与每一环的职责。' },
  { id: 'agent_node_013', parentId: 'agent_node_010', title: 'ReAct 范式：思考-行动-观察', summary: 'ReAct 的提出、协议形态与在纯文本协议下的落地。' },
  { id: 'agent_node_014', parentId: 'agent_node_010', title: 'Agent 形态演进：从 AutoGPT 到编码 Agent', summary: '三代 Agent 形态的能力跃迁与失败教训。' },

  { id: 'agent_node_020', parentId: 'agent_node_001', title: '工具调用机制', summary: '工具定义、调用协议、并行执行，以及 Claude Code 内置工具拆解。' },
  { id: 'agent_node_021', parentId: 'agent_node_020', title: '工具定义与 JSON Schema', summary: '工具描述如何影响模型调用质量；schema 设计要点。' },
  { id: 'agent_node_022', parentId: 'agent_node_020', title: '调用协议与结果回填', summary: '原生 function calling 与纯文本协议解析、错误回填机制。' },
  { id: 'agent_node_023', parentId: 'agent_node_020', title: '并行工具调用', summary: '并行调用的收益、竞态风险与实现约束。' },
  { id: 'agent_node_024', parentId: 'agent_node_020', title: 'Claude Code 工具拆解：文件读写与编辑', summary: 'Read/Write/Edit/SearchReplace 类工具的原子性与精确匹配设计。' },
  { id: 'agent_node_025', parentId: 'agent_node_020', title: 'Claude Code 工具拆解：Bash 与代码检索', summary: 'Bash 执行、Grep/Glob 检索与 LSP 的分层检索策略。' },
  { id: 'agent_node_026', parentId: 'agent_node_020', title: '工具集设计原则', summary: '粒度、命名、错误信息如何决定 Agent 的可用性上限。' },

  { id: 'agent_node_030', parentId: 'agent_node_001', title: '上下文工程', summary: '上下文预算、系统提示词、压缩与外部记忆。' },
  { id: 'agent_node_031', parentId: 'agent_node_030', title: '上下文窗口与 token 预算', summary: '上下文的构成、预算分配与超限后果。' },
  { id: 'agent_node_032', parentId: 'agent_node_030', title: '系统提示词设计', summary: '以 Claude Code 为例：身份、规则、工具指引的分层组织。' },
  { id: 'agent_node_033', parentId: 'agent_node_030', title: '上下文压缩：Compaction 策略', summary: '自动压缩的触发时机、摘要保留什么、丢失什么。' },
  { id: 'agent_node_034', parentId: 'agent_node_030', title: '外部记忆：CLAUDE.md 与 AGENTS.md', summary: '项目级记忆文件的加载机制与写入约定。' },
  { id: 'agent_node_035', parentId: 'agent_node_030', title: '按需加载：不要预载所有上下文', summary: '惰性检索优先于全量注入的工程理由。' },
  { id: 'agent_node_036', parentId: 'agent_node_030', title: '长期记忆与 RAG', summary: '向量检索在 Agent 记忆体系中的位置与失效场景。' },

  { id: 'agent_node_040', parentId: 'agent_node_001', title: '执行与规划', summary: 'Plan 模式、任务分解、错误恢复、权限模型与人机协作。' },
  { id: 'agent_node_041', parentId: 'agent_node_040', title: 'Plan 模式：先想清楚再动手', summary: '只读规划阶段的产出物与进入执行的门槛。' },
  { id: 'agent_node_042', parentId: 'agent_node_040', title: '任务分解与 TODO 驱动执行', summary: 'TODO 列表作为执行状态机的设计与纠偏作用。' },
  { id: 'agent_node_043', parentId: 'agent_node_040', title: '错误恢复：重试、降级与熔断', summary: '瞬时错误重试、协议解析失败降级与熔断退出策略。' },
  { id: 'agent_node_044', parentId: 'agent_node_040', title: '权限模型与安全沙箱', summary: 'Claude Code 的权限层级、命令黑名单与跳过授权的代价。' },
  { id: 'agent_node_045', parentId: 'agent_node_040', title: '人机协作检查点', summary: '何时必须问用户：不可逆操作、歧义需求与成本门槛。' },

  { id: 'agent_node_050', parentId: 'agent_node_001', title: '多智能体编排', summary: '子代理模式、Orchestrator-Worker 与多智能体的适用边界。' },
  { id: 'agent_node_051', parentId: 'agent_node_050', title: '子代理模式：Claude Code Task 工具', summary: '子代理的上下文隔离、结果回传与典型使用场景。' },
  { id: 'agent_node_052', parentId: 'agent_node_050', title: 'Orchestrator-Worker 模式', summary: '主控拆分任务、worker 并行执行与结果聚合的实现。' },
  { id: 'agent_node_053', parentId: 'agent_node_050', title: '上下文隔离与结果聚合', summary: '为什么隔离上下文是多智能体的核心价值。' },
  { id: 'agent_node_054', parentId: 'agent_node_050', title: '多智能体的边界：什么时候不该拆', summary: '通信开销、一致性成本与单代理足够的情形。' },

  { id: 'agent_node_060', parentId: 'agent_node_001', title: '能力扩展', summary: 'MCP、Hooks、Skill 体系与会话持久化。' },
  { id: 'agent_node_061', parentId: 'agent_node_060', title: 'MCP：Model Context Protocol', summary: 'MCP 的架构、传输层与工具暴露机制。' },
  { id: 'agent_node_062', parentId: 'agent_node_060', title: 'Hooks 机制：生命周期注入点', summary: '事件钩子的触发时机与典型用法（校验、审计、自动化）。' },
  { id: 'agent_node_063', parentId: 'agent_node_060', title: 'Skill 体系：把知识与流程打包', summary: 'Skill 的目录结构、触发机制与渐进式披露。' },
  { id: 'agent_node_064', parentId: 'agent_node_060', title: '会话管理：持久化与恢复', summary: '会话存储格式、resume 机制与上下文重建。' },

  { id: 'agent_node_070', parentId: 'agent_node_001', title: '主流实现横评', summary: 'Codex CLI、Cursor、Devin、Aider、LangGraph 与开源生态的实现对比。' },
  { id: 'agent_node_071', parentId: 'agent_node_070', title: 'Codex CLI：OpenAI 的终端 Agent', summary: '沙箱模型、审批模式与 Claude Code 的差异。' },
  { id: 'agent_node_072', parentId: 'agent_node_070', title: 'Cursor：IDE 内嵌 Agent', summary: 'Tab 补全、Composer 与代码库索引的实现取舍。' },
  { id: 'agent_node_073', parentId: 'agent_node_070', title: 'Devin 与云端 Agent', summary: '云端执行环境、长时任务与规划-执行分离架构。' },
  { id: 'agent_node_074', parentId: 'agent_node_070', title: 'Aider：最小编辑循环', summary: 'repo map、edit format 与极简循环的设计哲学。' },
  { id: 'agent_node_075', parentId: 'agent_node_070', title: 'LangGraph 与框架流派', summary: '图编排框架的状态模型与自建循环的对比。' },
  { id: 'agent_node_076', parentId: 'agent_node_070', title: '开源生态：Cline、OpenHands、Continue', summary: '开源编码 Agent 的实现路线与社区演化。' },
  { id: 'agent_node_077', parentId: 'agent_node_070', title: '对比总结：实现选型的收敛点', summary: '横评结论：主流实现在哪些设计上已经收敛。' },

  { id: 'agent_node_080', parentId: 'agent_node_001', title: '实战：自建 Agent', summary: '从零实现最小 Agent，以及评估、成本与安全要点。' },
  { id: 'agent_node_081', parentId: 'agent_node_080', title: '最小可用 Agent：100 行实现', summary: '主循环 + 两个工具的最小实现与可扩展点。' },
  { id: 'agent_node_082', parentId: 'agent_node_080', title: '评估与可观测性', summary: '任务成功率评估、轨迹回放与日志埋点设计。' },
  { id: 'agent_node_083', parentId: 'agent_node_080', title: '成本与延迟优化', summary: '缓存、模型分级、上下文裁剪的成本杠杆。' },
  { id: 'agent_node_084', parentId: 'agent_node_080', title: 'Agent 安全要点', summary: '提示注入、命令注入与数据泄漏的防御清单。' },
]

// ========== 数据文件读写（原子写） ==========

function loadMaps() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveMaps(maps) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  const tmp = `${DATA_FILE}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(maps, null, 2), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
}

function ensureMap() {
  const maps = loadMaps()
  let map = maps.find(m => m.id === MAP_ID)
  const now = new Date().toISOString()
  if (!map) {
    map = {
      id: MAP_ID,
      title: MAP_TITLE,
      description: MAP_DESC,
      builtIn: true,
      currentNodeId: OUTLINE[0].id,
      createdAt: now,
      updatedAt: now,
      nodes: [],
    }
    maps.push(map)
  }
  const existing = new Map(map.nodes.map(n => [n.id, n]))
  for (const item of OUTLINE) {
    if (!existing.has(item.id)) {
      existing.set(item.id, {
        id: item.id,
        parentId: item.parentId,
        title: item.title,
        status: item.parentId ? 'unexplored' : 'learning',
        summary: item.summary,
        evidence: '',
        nextStep: '',
        content: '',
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  map.nodes = [...existing.values()]
  map.updatedAt = now
  saveMaps(maps)
  return map
}

function nodePath(map, nodeId) {
  const byId = new Map(map.nodes.map(n => [n.id, n]))
  const chain = []
  let cur = byId.get(nodeId)
  while (cur) {
    chain.unshift(cur.title)
    cur = cur.parentId ? byId.get(cur.parentId) : null
  }
  return chain.join(' → ')
}

// ========== 章节生成 ==========

async function generateChapter(map, node) {
  const prompt = [
    BOOK_PREAMBLE,
    '',
    buildLearningPrompt({
      kind: 'content',
      mapTitle: MAP_TITLE,
      nodePath: nodePath(map, node.id),
      nodeTitle: node.title,
    }),
  ].join('\n')

  const stream = callAIStream(prompt, { label: 'builtin-agent-gen', timeout: 600000 })
  let content = ''
  for await (const frame of stream) {
    content = frame.content || content
    if (frame.streamEnd) break
  }
  return content.trim()
}

function isValidContent(text) {
  return text.length >= 600 && text.includes('##')
}

async function main() {
  const args = process.argv.slice(2)
  const onlyIdx = args.indexOf('--only')
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity

  const map = ensureMap()
  const pending = OUTLINE
    .map(item => map.nodes.find(n => n.id === item.id))
    .filter(n => !n.content || !n.content.trim())
    .filter(n => !onlyId || n.id === onlyId)
    .slice(0, limit)

  console.log(`图谱「${MAP_TITLE}」共 ${map.nodes.length} 节点，本次待生成 ${pending.length} 章`)
  if (pending.length === 0) return

  let done = 0
  let failed = 0
  for (const node of pending) {
    const tag = `[${done + failed + 1}/${pending.length}] ${node.title}`
    try {
      let content = await generateChapter(map, node)
      if (!isValidContent(content)) {
        console.warn(`${tag} 首产物不合格（${content.length} 字），重试一次`)
        content = await generateChapter(map, node)
      }
      if (!isValidContent(content)) {
        failed += 1
        console.error(`${tag} 失败：内容长度 ${content.length}，跳过`)
        continue
      }
      node.content = content
      node.updatedAt = new Date().toISOString()
      saveMaps(loadMaps().map(m => (m.id === MAP_ID ? map : m)))
      done += 1
      console.log(`${tag} 完成（${content.length} 字）`)
    } catch (error) {
      failed += 1
      console.error(`${tag} 异常：${error.message}`)
    }
  }
  console.log(`本轮结束：成功 ${done}，失败 ${failed}，剩余 ${map.nodes.filter(n => !n.content || !n.content.trim()).length} 章无正文`)
}

main().catch(error => {
  console.error('生成终止:', error)
  process.exit(1)
})

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 内置示例图谱「AI Agent 实现原理」的节点大纲 —— 它是**一份伪造的三个月自学现场记录**。
//
// 为什么需要这份伪造数据：Folio 的核心主张（有分母、有横向生态、有色块与复习提醒）
// 只有在「一份被真实用过三个月的图谱」上才看得出来。空白新图谱无法展示衰减、覆盖度
// 与门户边，所以随仓库发布一份完全体样本，作为产品形态的最好案例。
//
// 三条时间线（数字是「多少天前」，注入时物化成绝对时间，见 learning-seeds.js）：
//   1. 第 1-5 周（created 92~60）：用户从关键词起手，靠下钻自己长出主干，origin = 'user'
//   2. 第 6 周（created 58）      ：铺领域骨架，AI 一次给出 7 大分支 23 个知识点，origin = 'canon'
//   3. 第 6 周至今（created 34~6）：按骨架推进，用平铺补同类、用跨域标门户、自己建节点
//
// status 是**当前**状态，reviewed 是最后一次状态变更（衰减起点）：
// 两个月前读过、之后再没碰的节点会自然褪色，这正是要展示的东西。

const MAP = {
  id: 'learn_map_builtin_agent_v2',
  title: 'AI Agent 实现原理',
  description: '以 Claude Code 为参考实现，拆解编码 Agent 的内部机制。这是一份写满三个月自学痕迹的完整示例：带领域骨架、跨域门户、圈选问答与复习衰减。',
  currentNodeId: 'user_retro',
  createdDaysAgo: 92,
  updatedDaysAgo: 2,
  canon: { generatedDaysAgo: 58, scaleEstimate: 150, source: 'ai' },
}

// 第一段：用户自己钻出来的主干（正文沿用既有章节，见 generate-builtin-3month-demo.js）
const USER_TRUNK = [
  { id: 'agent_root', parentId: null, title: 'AI Agent 实现原理', status: 'learning', created: 92, reviewed: 2, nextStep: '把评估与可观测补上——这是三个月里唯一一直没碰的板块。' },
  { id: 'agent_essence', parentId: 'agent_root', status: 'verified', verifiedBy: 'quiz', created: 92, reviewed: 4, evidence: '独立写出最小 Agent 循环，并解释清 MAX_STEPS 为什么不是可选项。' },
  { id: 'agent_react', parentId: 'agent_root', status: 'verified', verifiedBy: 'quiz', created: 91, reviewed: 6, evidence: '能说清 ReAct 的第一收益是可观测性，并给出解析器兜底方案。' },
  { id: 'react_loop', parentId: 'agent_react', status: 'understood', created: 89, reviewed: 41 },
  { id: 'react_stop', parentId: 'agent_react', status: 'understood', created: 88, reviewed: 74 },
  { id: 'agent_tools', parentId: 'agent_root', status: 'verified', verifiedBy: 'manual', created: 84, reviewed: 11, evidence: '把项目里 31 个工具合并到 9 个，模型选择正确率明显上升。' },
  { id: 'tool_fc', parentId: 'agent_tools', status: 'understood', created: 82, reviewed: 26 },
  { id: 'tool_desc', parentId: 'agent_tools', status: 'understood', created: 81, reviewed: 69 },
  { id: 'agent_memory', parentId: 'agent_root', status: 'understood', created: 78, reviewed: 77 },
  { id: 'mem_short', parentId: 'agent_memory', status: 'understood', created: 77, reviewed: 63 },
  { id: 'mem_long', parentId: 'agent_memory', status: 'learning', created: 76, reviewed: 33, nextStep: '重排还没动手，先拿 20 条真实查询把召回率量出来。' },
  { id: 'agent_planning', parentId: 'agent_root', status: 'learning', created: 70, reviewed: 8, nextStep: '重规划的触发条件还是拍脑袋，需要一个可量化的判据。' },
  { id: 'plan_decomp', parentId: 'agent_planning', status: 'understood', created: 68, reviewed: 58 },
  { id: 'plan_reflexion', parentId: 'agent_planning', status: 'learning', created: 66, reviewed: 24 },
  { id: 'agent_context', parentId: 'agent_root', status: 'understood', created: 62, reviewed: 37 },
  { id: 'agent_safety', parentId: 'agent_root', status: 'learning', created: 60, reviewed: 19 },
  { id: 'agent_eval', parentId: 'agent_root', status: 'unexplored', created: 60, reviewed: 0 },
]

// 第二段：第 6 周 AI 铺出的领域骨架。这 30 个节点是**分母**，与用户自己长出来的主干完全分开记录。
const CANON = [
  { id: 'canon_base', parentId: 'agent_root', title: '基础前提', status: 'understood', created: 58, reviewed: 46, summary: '模型能做什么、不能做什么，是后面所有工程手段的约束来源。' },
  { id: 'canon_llm_limit', parentId: 'canon_base', title: '模型能力边界', status: 'understood', created: 58, reviewed: 44, summary: '哪些判断可以交给模型，哪些必须由代码兜底。' },
  { id: 'canon_ctx_window', parentId: 'canon_base', title: '上下文窗口的物理约束', status: 'verified', verifiedBy: 'manual', created: 58, reviewed: 12, evidence: '算清了主循环每轮的 token 预算，据此定下压缩阈值。', summary: '窗口是硬约束，预算要按轮次分配而不是按总量用。' },
  { id: 'canon_prompt_ctl', parentId: 'canon_base', title: '提示工程里真正可控的部分', status: 'understood', created: 58, reviewed: 38, summary: '让模型的输出结构可解析，比让它的措辞更聪明更值钱。' },
  { id: 'canon_loop', parentId: 'agent_root', title: '循环范式全景', status: 'understood', created: 58, reviewed: 35, summary: 'ReAct 只是循环范式里的一种，选型取决于任务的可分解程度。' },
  { id: 'canon_loop_taxonomy', parentId: 'canon_loop', title: '循环范式谱系', status: 'verified', verifiedBy: 'quiz', created: 58, reviewed: 9, evidence: '能按「任务能否预先分解」在 ReAct 与 Plan-Execute 之间给出选型理由。', summary: 'ReAct / Plan-Execute / Reflexion 各自的适用场景与代价。' },
  { id: 'canon_error_recovery', parentId: 'canon_loop', title: '错误恢复与重试', status: 'understood', created: 58, reviewed: 30, summary: '区分瞬时错误与逻辑错误，前者重试、后者必须换路径。' },
  { id: 'canon_tool_rounds', parentId: 'canon_loop', title: '多轮工具调用的编排', status: 'unexplored', created: 58, summary: '依赖关系的工具调用如何串行、如何并行、如何回填中间结果。' },
  { id: 'canon_tooling', parentId: 'agent_root', title: '工具生态', status: 'understood', created: 58, reviewed: 27, summary: '工具不只是函数，它同时是权限边界与安全边界。' },
  { id: 'canon_tool_contract', parentId: 'canon_tooling', title: '工具契约设计', status: 'understood', created: 58, reviewed: 17, summary: '参数语义化、返回结构化，决定了模型能否稳定复用工具。' },
  { id: 'canon_tool_perm', parentId: 'canon_tooling', title: '最小授权与权限分层', status: 'understood', created: 58, reviewed: 15, summary: '读写分离、按目录授权、危险操作二次确认的工程落点。' },
  { id: 'canon_tool_sandbox', parentId: 'canon_tooling', title: '执行沙箱', status: 'unexplored', created: 58, summary: '容器、受限 shell 与文件系统隔离，控制一次误操作的爆炸半径。' },
  { id: 'canon_tool_idem', parentId: 'canon_tooling', title: '幂等与副作用控制', status: 'unexplored', created: 58, summary: '重试安全的前提：同一个工具调用重复执行不产生额外副作用。' },
  { id: 'canon_memory', parentId: 'agent_root', title: '记忆与检索', status: 'understood', created: 58, reviewed: 21, summary: '记忆不是存得多就好，写入与遗忘策略决定了检索质量。' },
  { id: 'canon_mem_forget', parentId: 'canon_memory', title: '记忆写入与遗忘策略', status: 'understood', created: 58, reviewed: 14, summary: '什么值得记、什么时候归档旧记忆，决定长期记忆是否可用。' },
  { id: 'canon_retrieval_rank', parentId: 'canon_memory', title: '检索质量与重排', status: 'learning', created: 58, reviewed: 6, nextStep: '向量召回 0.71 不够用，先上交叉编码器重排再评估。', summary: '召回靠向量，精度靠重排，两者必须分开评估。' },
  { id: 'canon_vector_db', parentId: 'canon_memory', title: '向量库选型与代价', status: 'unexplored', created: 58, summary: '本地库与托管库在延迟、成本、一致性上的取舍。' },
  { id: 'canon_multiagent', parentId: 'agent_root', title: '多智能体协作', status: 'unexplored', created: 58, summary: '拆分子代理的收益来自上下文隔离，而不是「人多好办事」。' },
  { id: 'canon_subagent_iso', parentId: 'canon_multiagent', title: '子代理的上下文隔离', status: 'learning', created: 58, reviewed: 7, nextStep: '给子代理的返回加结构化摘要，否则主循环还是被噪声塞满。', summary: '隔离的真正价值是让主循环只收到结论，而不是全部过程。' },
  { id: 'canon_orchestrate', parentId: 'canon_multiagent', title: '编排与结果聚合', status: 'unexplored', created: 58, summary: '主控拆分任务、并聚合子结果时的冲突处理。' },
  { id: 'canon_multi_boundary', parentId: 'canon_multiagent', title: '什么时候不该拆', status: 'unexplored', created: 58, summary: '通信与一致性成本超过收益的判定条件。' },
  { id: 'canon_safety', parentId: 'agent_root', title: '安全与监督', status: 'learning', created: 58, reviewed: 19, summary: 'Agent 的攻击面比聊天机器人宽得多：它能读、能写、能执行。' },
  { id: 'canon_injection', parentId: 'canon_safety', title: '提示注入防御', status: 'understood', created: 58, reviewed: 3, summary: '注入可以藏在工具返回值里，防御点必须落在数据进上下文的入口。' },
  { id: 'canon_oversight', parentId: 'canon_safety', title: '人类审批的检查点', status: 'unexplored', created: 58, summary: '不可逆操作、跨权限边界、成本突增，三类动作必须回到人。' },
  { id: 'canon_leak', parentId: 'canon_safety', title: '数据外泄与隔离边界', status: 'unexplored', created: 58, summary: '上下文里混入敏感数据后，模型可能把它写进日志或外部请求。' },
  { id: 'canon_production', parentId: 'agent_root', title: '评估与上线', status: 'unexplored', created: 58, summary: '没有评测集的 Agent 只能靠感觉迭代，这是最常见的工程债。' },
  { id: 'canon_eval_set', parentId: 'canon_production', title: '评测集与回归', status: 'unexplored', created: 58, summary: '把失败案例固化成可重复执行的评测任务，防止修一个坏一个。' },
  { id: 'canon_trace', parentId: 'canon_production', title: '轨迹追踪与可观测', status: 'unexplored', created: 58, summary: '记录每一步的输入、决策与工具结果，否则线上问题无从复现。' },
  { id: 'canon_cost', parentId: 'canon_production', title: '成本与延迟', status: 'unexplored', created: 58, summary: '缓存、模型分级、上下文裁剪三个成本杠杆的优先级。' },
  { id: 'canon_maturity', parentId: 'canon_production', title: '上线成熟度清单', status: 'unexplored', created: 58, summary: '从能跑到敢放给真实用户之间的自查项。' },
]

// 第三段：骨架铺开之后用户自己新增的节点（平铺补同类、跨域记门户、以及自建）
const USER_ADDED = [
  { id: 'user_mcp', parentId: 'agent_root', title: 'MCP：工具接入的标准化', status: 'learning', created: 34, reviewed: 5, nextStep: '拿一个现成 MCP server 接进来，对比自建工具的接入成本。', summary: '把工具接入从「写代码」变成「接协议」，收益在生态而不在自己。' },
  { id: 'user_autogpt', parentId: 'agent_root', title: 'AutoGPT 那一代的教训', status: 'understood', created: 30, reviewed: 9, summary: '早期自主 Agent 失败在缺少工具边界与终止条件，而不是模型不够强。' },
  { id: 'user_project', parentId: 'agent_root', title: '实战：写一个能查数据库的 Agent', status: 'learning', created: 20, reviewed: 3, nextStep: '把只读账号与 SQL 白名单补上，再考虑放开写权限。', summary: '自己的练手项目：从自然语言到 SQL，再到结果解读。' },
  { id: 'user_retro', parentId: 'agent_root', title: '复盘：我踩过的三个坑', status: 'understood', created: 11, reviewed: 2, summary: '工具粒度、无进展检测、压缩时丢目标——三个月里代价最大的三处。' },
  { id: 'user_cu_note', parentId: 'agent_root', title: 'Computer Use 实测笔记', status: 'unexplored', created: 6, summary: '留给下一个阶段：视觉操作类 Agent 的稳定性到底差在哪。' },
]

// 第 2 层：树边之外的连接边。peer = 同类对照，prereq = 前置依赖，portal = 跨域门户
const EDGES = [
  { nodeId: 'agent_react', type: 'peer', targetNodeId: 'canon_loop_taxonomy', targetTitle: '循环范式谱系', note: '同为循环范式，一个是我自己钻的，一个是骨架给的对照。' },
  { nodeId: 'agent_tools', type: 'peer', targetNodeId: 'canon_tool_contract', targetTitle: '工具契约设计', note: '工具「怎么切」与工具「怎么描述」是同一层的两个问题。' },
  { nodeId: 'agent_memory', type: 'peer', targetNodeId: 'canon_mem_forget', targetTitle: '记忆写入与遗忘策略', note: '短期记忆管窗口，写入与遗忘管长期层。' },
  { nodeId: 'agent_planning', type: 'peer', targetNodeId: 'canon_multiagent', targetTitle: '多智能体协作', note: '单代理靠规划分解，多代理靠编排分解。' },
  { nodeId: 'agent_safety', type: 'peer', targetNodeId: 'canon_injection', targetTitle: '提示注入防御', note: '安全边界的第一道防线就是注入防御。' },
  { nodeId: 'tool_fc', type: 'peer', targetNodeId: 'canon_tool_perm', targetTitle: '最小授权与权限分层', note: '协议负责表达意图，权限负责决定意图能否落地。' },
  { nodeId: 'agent_essence', type: 'prereq', targetNodeId: 'canon_llm_limit', targetTitle: '模型能力边界', note: '先知道模型不能做什么，才理解为什么要加循环。' },
  { nodeId: 'canon_ctx_window', type: 'prereq', targetNodeId: 'agent_context', targetTitle: '上下文工程', note: '窗口约束是上下文工程的问题起点。' },
  { nodeId: 'canon_retrieval_rank', type: 'prereq', targetNodeId: 'canon_mem_forget', targetTitle: '记忆写入与遗忘策略', note: '写入质量决定检索上限，重排救不了垃圾记忆。' },
  { nodeId: 'agent_tools', type: 'portal', targetTitle: '分布式系统', note: '工具重试语义与幂等性直接借用了分布式系统里那套结论。' },
  { nodeId: 'agent_memory', type: 'portal', targetTitle: '信息检索', note: '召回/重排两段式评估，是从搜索引擎那边搬过来的方法。' },
  { nodeId: 'canon_injection', type: 'portal', targetTitle: '网络安全', note: 'OWASP LLM Top 10 是这一块的公共基线，不看会重复造轮子。' },
  { nodeId: 'agent_planning', type: 'portal', targetTitle: '运筹学', note: '任务调度与资源约束下的规划，本质上是个调度问题。' },
  { nodeId: 'canon_cost', type: 'portal', targetTitle: '性能工程', note: '尾延迟与缓存命中率的分析框架，套到 Agent 上同样成立。' },
  { nodeId: 'canon_subagent_iso', type: 'portal', targetTitle: '操作系统', note: '子代理隔离与进程隔离是同一个思路：靠边界而不是靠自觉。' },
  { nodeId: 'react_stop', type: 'portal', targetTitle: '控制论', note: '无进展检测本质上是反馈系统的稳定性判据。' },
]

module.exports = { MAP, USER_TRUNK, CANON, USER_ADDED, EDGES }

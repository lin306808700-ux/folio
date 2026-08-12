'use strict'

/**
 * Skill Pipeline 编排引擎
 * 
 * 借鉴 Open Design 的 pipeline.stages 概念：
 * 技能可以定义多阶段工作流（discovery → plan → generate → critique），
 * 每个阶段有明确的目标、可用原子能力和完成条件。
 * 
 * 在 SKILL.md 的 YAML frontmatter 中声明：
 * 
 *   pipeline:
 *     stages:
 *       - id: discovery
 *         description: 收集用户需求和约束条件
 *         atoms: [ask-inputs, clarify]
 *       - id: plan
 *         description: 制定执行计划
 *         atoms: [todo-write, direction-picker]
 *       - id: generate
 *         description: 生成产物
 *         atoms: [file-write, code-gen]
 *       - id: critique
 *         description: 质量评审
 *         atoms: [craft-review]
 *         repeat: true
 *         until: "score>=4 || iterations>=3"
 * 
 * 原子能力（atoms）映射：
 *   ask-inputs     → 向用户收集必要的输入参数
 *   clarify        → 追问澄清模糊需求
 *   direction-picker → 提供多个方向让用户选择
 *   todo-write     → 生成分步执行计划
 *   file-write     → 创建或修改文件
 *   code-gen       → 生成代码
 *   live-artifact  → 生成可交互的 HTML/SVG 产物
 *   craft-review   → 执行 craft 质量规则评审
 *   diff-review    → 展示变更差异供用户确认
 */

// 已知的原子能力及其描述
const KNOWN_ATOMS = {
  'ask-inputs': '向用户收集必要的输入参数，通过追问获取缺失信息',
  'clarify': '追问澄清模糊或歧义的需求，确保理解正确',
  'direction-picker': '提供 2-4 个不同方向/方案，让用户选择偏好',
  'todo-write': '将任务拆解为分步执行计划，列出每步的目标和产出',
  'file-write': '创建或修改文件，输出完整的文件内容',
  'code-gen': '生成代码，遵循项目的编码规范和风格',
  'live-artifact': '生成可交互的 HTML/SVG 产物（使用 ARTIFACT 格式）',
  'craft-review': '执行 craft 质量规则评审，检查产物是否符合质量标准',
  'diff-review': '展示变更差异（before/after），供用户确认修改',
  'media-image': '生成图片资源',
  'media-video': '生成视频资源',
  'handoff': '将产物交付给下游系统或格式',
}

/**
 * 验证 pipeline 定义的合法性
 * @param {object} pipeline - frontmatter 中的 pipeline 对象
 * @returns {string[]} 错误列表，空数组表示合法
 */
function validatePipeline(pipeline) {
  const errors = []

  if (!pipeline || typeof pipeline !== 'object') {
    return errors // pipeline 是可选的
  }

  if (!pipeline.stages || !Array.isArray(pipeline.stages)) {
    errors.push('pipeline.stages 必须是数组')
    return errors
  }

  if (pipeline.stages.length === 0) {
    errors.push('pipeline.stages 不能为空')
    return errors
  }

  const seenIds = new Set()
  for (let index = 0; index < pipeline.stages.length; index++) {
    const stage = pipeline.stages[index]
    const prefix = `pipeline.stages[${index}]`

    if (!stage.id) {
      errors.push(`${prefix} 缺少 id 字段`)
      continue
    }

    if (seenIds.has(stage.id)) {
      errors.push(`${prefix} id "${stage.id}" 重复`)
    }
    seenIds.add(stage.id)

    if (!stage.description && !stage.desc) {
      errors.push(`${prefix} 缺少 description 字段`)
    }

    // atoms 可选但如果有必须是数组
    if (stage.atoms && !Array.isArray(stage.atoms)) {
      errors.push(`${prefix}.atoms 必须是数组`)
    }

    // repeat 阶段必须有 until 条件
    if (stage.repeat && !stage.until) {
      errors.push(`${prefix} 设置了 repeat=true 但缺少 until 终止条件`)
    }
  }

  return errors
}

/**
 * 构建 pipeline 阶段指导提示词
 * 注入到 skill context 中，指导 AI 按阶段推进工作流
 * 
 * @param {object} pipeline - frontmatter 中的 pipeline 对象
 * @returns {string} pipeline 指导提示词，无 pipeline 定义时返回空字符串
 */
function buildPipelinePrompt(pipeline) {
  if (!pipeline || !pipeline.stages || pipeline.stages.length === 0) {
    return ''
  }

  const sections = []
  sections.push('\n\n## 工作流阶段（Pipeline）')
  sections.push('')
  sections.push('本技能定义了多阶段工作流，请按以下阶段顺序推进，每个阶段完成后再进入下一阶段：')
  sections.push('')

  for (let index = 0; index < pipeline.stages.length; index++) {
    const stage = pipeline.stages[index]
    const stageNumber = index + 1
    const description = stage.description || stage.desc || stage.id

    sections.push(`### 阶段 ${stageNumber}：${stage.id}`)
    sections.push(`**目标**：${description}`)

    // 解析原子能力
    if (stage.atoms && stage.atoms.length > 0) {
      sections.push('**可用操作**：')
      for (const atom of stage.atoms) {
        const atomDesc = KNOWN_ATOMS[atom] || atom
        sections.push(`- \`${atom}\` — ${atomDesc}`)
      }
    }

    // 重复阶段
    if (stage.repeat) {
      sections.push(`**迭代**：此阶段可重复执行，终止条件：\`${stage.until}\``)
    }

    // 完成标志
    if (stage.output) {
      sections.push(`**产出**：${stage.output}`)
    }

    sections.push('')
  }

  sections.push('### 阶段推进规则')
  sections.push('- 每个阶段完成后，简要总结该阶段产出，然后自动进入下一阶段')
  sections.push('- 如果当前阶段信息不足，在本阶段内追问，不要跳过')
  sections.push('- 带 `repeat` 的阶段在终止条件满足前持续迭代')
  sections.push('- 最后一个阶段完成后，输出最终产物')
  sections.push('')

  return sections.join('\n')
}

/**
 * 构建 pipeline 摘要（用于 Schema Digest）
 * @param {object} pipeline
 * @returns {string}
 */
function buildPipelineDigest(pipeline) {
  if (!pipeline || !pipeline.stages || pipeline.stages.length === 0) {
    return ''
  }

  const stageLabels = pipeline.stages.map(stage => {
    let label = stage.id
    if (stage.repeat) label += '(↻)'
    return label
  })

  return `工作流: ${stageLabels.join(' → ')}`
}

module.exports = {
  validatePipeline,
  buildPipelinePrompt,
  buildPipelineDigest,
  KNOWN_ATOMS
}

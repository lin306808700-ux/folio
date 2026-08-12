'use strict'

// 学习图谱「活的书」提示词：章节撰写 / 圈选提问 / 下钻衍生。
// muse-handlers（交互式）与 learning-prefetch（后台预生成）共用，保证两条链路产出风格一致。

function buildLearningPrompt({ kind, mapTitle, nodePath, nodeTitle, selection, question }) {
  const context = `知识图谱：${mapTitle || ''}\n章节路径：${nodePath || nodeTitle}\n当前节点：${nodeTitle}`
  if (kind === 'content') {
    return [
      '你是一位资深服务端技术作者，正在为读者写一本可直接学习的技术书。请为下面的知识节点撰写一章内容。',
      '',
      context,
      '',
      '写作要求：',
      '1. Markdown 格式，直接以二级标题开始，不要用一级标题重复节点名。',
      '2. 固定结构：## 技术要点（3-6 条核心结论，每条加粗开头一句话）→ ## 深入讲解（分小节讲透原理，重点讲 why）→ ## 代码实例（可运行代码 + 关键点注释）→ ## 常见误区与考点。',
      '3. 代码必须完整可运行并标注语言；非代码类主题用配置/命令/伪代码实例替代。',
      '4. 正文 800-1500 字（不含代码），拒绝笼统概述，每个论点要有具体机制/数字/代码支撑。',
      '5. 直接输出正文，不要开场白、结尾套话或“以下是...”之类的话。',
    ].join('\n')
  }
  if (kind === 'ask') {
    return [
      '读者正在阅读一本技术书的某个章节，对圈选的内容有疑问，请像作者当面讲解一样回答。',
      '',
      context,
      '',
      `圈选内容：\n${selection || ''}`,
      '',
      `读者的问题：${question || '解释这段内容'}`,
      '',
      '要求：紧扣圈选片段讲透，必要时补充代码示例或类比；Markdown 格式；直接回答，不要客套话。',
    ].join('\n')
  }
  // drill：基于圈选内容或节点本身衍生子知识点
  return [
    '读者在阅读技术书时想对下面的内容继续下钻深入。请给出 3-5 个值得展开的子知识点。',
    '',
    context,
    selection ? `圈选内容：\n${selection}` : '',
    '',
    '只输出 JSON 数组，不要任何其他文字或 markdown 围栏：',
    '[{"title":"子知识点短标题（12字以内）","summary":"为什么值得深入及核心内容预告（50字以内）"}]',
    '要求：子知识点必须是当前内容的真实下钻方向，具体不泛泛，彼此不重复。',
  ].filter(Boolean).join('\n')
}

module.exports = { buildLearningPrompt }

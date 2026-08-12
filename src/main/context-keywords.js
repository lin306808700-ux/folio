'use strict'

/**
 * 关键词提取与匹配工具模块
 * 复用 semantic-cache 中的分词、同义词扩展、Jaccard 相似度算法
 * 用于记忆裁剪、技能匹配、上下文按需加载
 */

// 同义词组 — 同一组内的词视为等价
const SYNONYM_GROUPS = [
  ['查看', '显示', '看', '展示', '列出', '打印'],
  ['查找', '搜索', '找', '搜', '检索'],
  ['删除', '移除', '清除', '去掉', '干掉'],
  ['创建', '新建', '生成', '添加'],
  ['修改', '编辑', '更改', '改', '变更'],
  ['安装', '装', '部署'],
  ['运行', '执行', '跑', '启动'],
  ['停止', '关闭', '终止', '杀死', '结束'],
  ['复制', '拷贝', '克隆'],
  ['移动', '转移', '迁移'],
  ['更新', '升级', '刷新'],
  ['下载', '拉取', '获取'],
  ['文件', '文档'],
  ['目录', '文件夹', '路径'],
  ['进程', '程序', '服务'],
  ['依赖', '包', 'package', '模块'],
  ['项目', '工程', '仓库', 'repo'],
  ['分支', 'branch'],
  ['提交', 'commit'],
  ['容器', 'container'],
  ['镜像', 'image'],
  ['网页', '页面', '网站'],
  ['截图', '截屏', 'screenshot'],
  ['架构图', '架构设计', '系统架构', 'architecture diagram'],
  ['配置', '设置', '设定'],
  ['错误', '报错', 'error', 'bug'],
  ['日志', 'log', '记录'],
  ['show', 'display', 'list', 'print'],
  ['find', 'search', 'grep', 'locate'],
  ['delete', 'remove', 'rm'],
  ['create', 'make', 'new', 'add'],
  ['run', 'exec', 'execute', 'start'],
  ['stop', 'kill', 'terminate', 'close'],
  ['install', 'setup'],
  ['update', 'upgrade'],
]

// 中文停用词（高频无意义词）
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '个',
  '但', '还', '与', '吗', '吧', '呢', '啊', '哦', '嗯', '把', '被',
  '让', '给', '从', '向', '对', '为', '以', '及', '而', '或', '所',
  '帮', '帮我', '请', '请帮', '一下', '下', '能', '可以', '怎么',
])

/**
 * 分词：中文 bigram + unigram + 英文单词
 * @param {string} text - 输入文本
 * @returns {Set<string>} 分词结果集合
 */
function tokenize(text) {
  if (!text) return new Set()
  const lower = text.toLowerCase().trim()
  const tokens = new Set()

  // 英文单词（含驼峰拆分）
  const englishWords = lower.match(/[a-z][a-z0-9]*/g) || []
  englishWords.forEach(w => {
    tokens.add(w)
    // 驼峰拆分: camelCase → camel, case
    const camelParts = w.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/)
    if (camelParts.length > 1) camelParts.forEach(p => tokens.add(p))
  })

  // 中文字符提取
  const chinese = lower.replace(/[a-z0-9\s\-_./\\@#$%^&*()+={}[\]|:;"'<>,?!~`]/g, '')
  // unigram + bigram
  for (let i = 0; i < chinese.length; i++) {
    const char = chinese[i]
    if (!STOP_WORDS.has(char)) tokens.add(char)
    if (i < chinese.length - 1) {
      const bigram = chinese.substring(i, i + 2)
      if (!STOP_WORDS.has(bigram)) tokens.add(bigram)
    }
  }

  return tokens
}

/**
 * 同义词扩展
 * @param {Set<string>} tokens - 原始分词集合
 * @returns {Set<string>} 扩展后的集合
 */
function expandSynonyms(tokens) {
  const expanded = new Set(tokens)
  for (const token of tokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(token)) {
        group.forEach(s => expanded.add(s))
      }
    }
  }
  return expanded
}

/**
 * Jaccard 相似度
 * @param {Set<string>} set1
 * @param {Set<string>} set2
 * @returns {number} 0~1
 */
function jaccard(set1, set2) {
  if (set1.size === 0 && set2.size === 0) return 1
  if (set1.size === 0 || set2.size === 0) return 0
  let intersection = 0
  for (const item of set1) {
    if (set2.has(item)) intersection++
  }
  return intersection / (set1.size + set2.size - intersection)
}

/**
 * 从用户输入中提取关键词（去停用词 + 分词）
 * @param {string} userInput - 用户输入
 * @returns {Set<string>} 关键词集合
 */
function extractKeywords(userInput) {
  if (!userInput) return new Set()
  const tokens = tokenize(userInput)
  // 过滤停用词
  const keywords = new Set()
  for (const t of tokens) {
    if (!STOP_WORDS.has(t) && t.length > 0) {
      keywords.add(t)
    }
  }
  return keywords
}

/**
 * 计算文本与关键词集合的相关性得分
 * 使用同义词扩展后的 Jaccard 相似度
 * @param {string} text - 待评分文本（如记忆摘要）
 * @param {Set<string>} keywords - 用户输入提取的关键词
 * @returns {number} 0~1 相关性得分
 */
function scoreText(text, keywords) {
  if (!text || !keywords || keywords.size === 0) return 0
  const textTokens = tokenize(text)
  const expandedKeywords = expandSynonyms(keywords)
  const expandedText = expandSynonyms(textTokens)
  return jaccard(expandedKeywords, expandedText)
}

/**
 * 从记忆列表中筛选与用户输入相关的记忆
 * @param {Array} memories - 记忆列表 [{summary, ...}]
 * @param {string} userInput - 用户输入
 * @param {Object} options
 * @param {number} options.maxResults - 最大返回数，默认 5
 * @param {number} options.threshold - 最低相关性阈值，默认 0.15
 * @param {number} options.recentFallback - 无匹配时返回最近 N 条，默认 2
 * @returns {Array} 筛选后的记忆列表（按相关性降序）
 */
function filterMemories(memories, userInput, options = {}) {
  const { maxResults = 5, threshold = 0.15, recentFallback = 2 } = options
  if (!memories || memories.length === 0) return []
  if (!userInput) return memories.slice(0, recentFallback)

  const keywords = extractKeywords(userInput)
  if (keywords.size === 0) return memories.slice(0, recentFallback)

  // 为每条记忆打分
  const scored = memories.map((memory, index) => ({
    memory,
    score: scoreText(memory.summary || '', keywords),
    index
  }))

  // 筛选超过阈值的
  const matched = scored
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)

  if (matched.length > 0) {
    return matched.map(s => s.memory)
  }

  // 无匹配时，返回最近 N 条作为兜底
  return memories.slice(0, recentFallback)
}

/**
 * 从技能列表中筛选与用户输入相关的技能
 * @param {Array} skills - 技能列表 [{name, description, ...}]
 * @param {string} userInput - 用户输入
 * @param {number} maxResults - 最大返回数，默认 10
 * @returns {Array} 筛选后的技能列表（按相关性降序）
 */
function filterSkills(skills, userInput, maxResults = 10) {
  if (!skills || skills.length === 0) return []
  if (skills.length <= maxResults) return skills
  if (!userInput) return skills.slice(0, maxResults)

  const keywords = extractKeywords(userInput)
  if (keywords.size === 0) return skills.slice(0, maxResults)

  const scored = skills.map(skill => {
    const text = `${skill.name || ''} ${skill.description || ''}`
    return {
      skill,
      score: scoreText(text, keywords)
    }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.skill)
}

/**
 * 本地关键词匹配技能（已废弃，保留函数以防残留引用）
 * 技能触发已改为用户手动选择，不再自动匹配
 * @deprecated
 */
function matchSkillByKeywords() {
  return { matched: false, confidence: 0 }
}

module.exports = {
  SYNONYM_GROUPS,
  STOP_WORDS,
  tokenize,
  expandSynonyms,
  jaccard,
  extractKeywords,
  scoreText,
  filterMemories,
  filterSkills,
}

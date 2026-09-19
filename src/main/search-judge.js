'use strict'

/**
 * 本地规则判断是否需要联网搜索（零 Token 消耗）
 */
function judgeNeedSearch(userInput) {
  const input = userInput.trim()

  // 排除：命令类操作、纯技术问答
  const excludePatterns = [
    /^(ls|cd|pwd|cat|grep|find|mkdir|rm|cp|mv|git|npm|docker|curl|brew|pip)\b/i,
    /什么是.{1,10}$/, // 短句"什么是X"通常是知识问答
    /^(怎么|如何|为什么).{0,15}(写|用|配置|安装|设置|实现|创建)/,
    /今天(星期|周|几号|几月|什么日子)/,
    /现在几点/,
  ]
  for (const p of excludePatterns) {
    if (p.test(input)) return { needSearch: false, keywords: '' }
  }

  // 搜索触发规则：需要同时包含 [实时信号词] + [查询对象]
  const searchRules = [
    // 明确要求搜索
    { pattern: /搜索一下|搜一下|查一下|帮我搜|帮我查(?!看|找)/, keywords: (m, inp) => inp.replace(/搜索一下|搜一下|查一下|帮我搜|帮我查/, '').trim() },
    // 天气
    { pattern: /(.*)(天气|气温|温度)/, keywords: (m) => `${m[1]} 天气`.trim() },
    // 股票/金融 + 实体
    { pattern: /(.{2,})(股票|股价|行情|市值|涨跌)/, keywords: (m) => `${m[1]} ${m[2]}` },
    // 新闻/动态 + 时间词
    { pattern: /(最新|最近|今天|今年).{0,6}(新闻|动态|消息|进展|发布)/, keywords: (m, inp) => inp },
    // 价格查询
    { pattern: /(.{2,})(价格|多少钱|售价|报价)/, keywords: (m) => `${m[1]} ${m[2]}` },
  ]

  for (const rule of searchRules) {
    const match = input.match(rule.pattern)
    if (match) {
      const kw = rule.keywords(match, input) || input
      console.log('[SearchJudge] 本地搜索规则命中, 关键词:', kw)
      return { needSearch: true, keywords: kw.substring(0, 100) }
    }
  }

  return { needSearch: false, keywords: '' }
}

module.exports = { judgeNeedSearch }

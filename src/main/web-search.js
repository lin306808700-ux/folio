const axios = require('axios')

/**
 * 爬取 Bing 搜索结果并解析 HTML 提取摘要
 * @param {string} keywords - 搜索关键词
 * @param {number} limit - 最多返回几条结果
 * @returns {Promise<Array<{title: string, snippet: string, url: string}>>}
 */
async function searchBing(keywords, limit = 5) {
  console.log('[WebSearch] 搜索关键词:', keywords)

  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(keywords)}&count=${limit}`
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      timeout: 15000
    })

    const html = response.data
    const results = parseBingHTML(html, limit)

    console.log('[WebSearch] 解析到', results.length, '条结果')
    return results
  } catch (error) {
    console.error('[WebSearch] 搜索失败:', error.message)
    return []
  }
}

/**
 * 解析 Bing 搜索结果页 HTML
 * 不用 cheerio 等第三方库，纯正则提取
 */
function parseBingHTML(html, limit) {
  const results = []

  // Bing 搜索结果在 <li class="b_algo"> 中
  const itemRegex = /<li\s+class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi
  let match

  while ((match = itemRegex.exec(html)) !== null && results.length < limit) {
    const itemHtml = match[1]

    // 提取标题和 URL：<h2><a href="...">标题</a></h2>
    const titleMatch = itemHtml.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    const url = titleMatch[1]
    const title = stripTags(titleMatch[2]).trim()

    // 提取摘要：<p> 或 <div class="b_caption"> 内的文本
    let snippet = ''
    const snippetMatch = itemHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    if (snippetMatch) {
      snippet = stripTags(snippetMatch[1]).trim()
    }

    // 备用：从 b_caption 中提取
    if (!snippet) {
      const captionMatch = itemHtml.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/i)
      if (captionMatch) {
        snippet = stripTags(captionMatch[1]).trim()
      }
    }

    if (title && url) {
      results.push({
        title: title.substring(0, 200),
        snippet: snippet.substring(0, 500),
        url
      })
    }
  }

  return results
}

/**
 * 去除 HTML 标签
 */
function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 将搜索结果格式化为 AI 可读的上下文文本
 */
function formatSearchResults(results) {
  if (!results || results.length === 0) {
    return '未找到相关搜索结果。'
  }

  return results.map((r, i) => {
    return `[${i + 1}] ${r.title}\n摘要：${r.snippet || '无'}\n来源：${r.url}`
  }).join('\n\n')
}

module.exports = {
  searchBing,
  formatSearchResults
}

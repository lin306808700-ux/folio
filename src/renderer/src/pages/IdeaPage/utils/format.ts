export function formatFilename(filename: string): string {
  return filename.replace(/\.md$/, '').replace(/_/g, ' ')
}

export function extractDate(filename: string): string {
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/)
  return dateMatch ? dateMatch[1] : ''
}

export function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} 小时前`
    const diffDay = Math.floor(diffHr / 24)
    if (diffDay < 7) return `${diffDay} 天前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return isoString
  }
}

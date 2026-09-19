// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

/**
 * TableParser — 从 Markdown 表格中检测数值列，推荐最佳图表类型
 * 移植自 markdown-visualizer 项目
 */

export interface ParsedTable {
  headers: string[]
  data: Record<string, string>[]
  type: 'chartable' | 'text'
  chartType: ChartType
}

export type ChartType = 'bar' | 'line' | 'pie' | 'horizontalBar' | 'composed'

const VALID_UNITS = ['%', 'pt', '元', '万', '亿', '个', '次', '人', '笔', '分', '¥', '￥', '$']

/**
 * 解析 HTML table 元素为结构化数据
 */
export function parseTableElement(tableEl: HTMLTableElement): ParsedTable | null {
  const headers: string[] = []
  const data: Record<string, string>[] = []

  const thElements = tableEl.querySelectorAll('thead th, tr:first-child th')
  if (thElements.length === 0) return null

  thElements.forEach(th => {
    headers.push((th.textContent || '').trim())
  })

  const rows = tableEl.querySelectorAll('tbody tr')
  rows.forEach(row => {
    const cells = row.querySelectorAll('td')
    if (cells.length !== headers.length) return
    const rowData: Record<string, string> = {}
    cells.forEach((cell, idx) => {
      rowData[headers[idx]] = (cell.textContent || '').trim()
    })
    data.push(rowData)
  })

  if (data.length === 0) return null

  const type = detectTableType(data, headers)
  const chartType = type === 'chartable' ? recommendChartType(data, headers) : 'bar'

  return { headers, data, type, chartType }
}

/**
 * 从 react-markdown 传入的 children 解析表格数据
 */
export function parseTableFromProps(headers: string[], rows: string[][]): ParsedTable | null {
  if (!headers.length || !rows.length) return null

  const data = rows.map(row => {
    const rowData: Record<string, string> = {}
    headers.forEach((header, idx) => {
      rowData[header] = row[idx] || ''
    })
    return rowData
  })

  const type = detectTableType(data, headers)
  const chartType = type === 'chartable' ? recommendChartType(data, headers) : 'bar'

  return { headers, data, type, chartType }
}

function cleanNumericValue(value: string): string {
  return value.replace(/[,%¥￥+元万亿个次人笔分pt$\s]/g, '').trim()
}

function isNumericValue(value: string): boolean {
  const cleaned = cleanNumericValue(value)
  return /^-?\d+(\.\d+)?$/.test(cleaned) && cleaned !== ''
}

function detectTableType(data: Record<string, string>[], headers: string[]): 'chartable' | 'text' {
  if (data.length === 0) return 'text'

  const numericColumns = headers.filter(header => {
    const allNumeric = data.every(row => {
      const value = String(row[header] || '').trim()
      if (!value) return false
      const hasUnit = VALID_UNITS.some(unit => value.includes(unit))
      const cleaned = cleanNumericValue(value)
      const isPureNumber = isNumericValue(value)
      if (hasUnit) return isPureNumber
      return isPureNumber && !/[a-zA-Z\u4e00-\u9fa5]/.test(value)
    })
    return allNumeric
  })

  return numericColumns.length >= 1 ? 'chartable' : 'text'
}

function recommendChartType(data: Record<string, string>[], headers: string[]): ChartType {
  const rowCount = data.length

  const numericHeaders = headers.filter(h =>
    data.some(row => isNumericValue(String(row[h] || '')))
  )
  const numColCount = numericHeaders.length

  const timeKeywords = ['时间', '时段', '日期', '月份', '季度', 'year', 'month', 'date', 'time', 'period', 'week', 'day', '趋势']
  const rankKeywords = ['排名', '排行', 'rank', 'top']
  const ratioKeywords = ['占比', '比例', 'percent', 'rate', 'ratio', '分布']
  const bandKeywords = ['价格带', '区间', 'range', 'band']
  const trendKeywords = ['环比', '同比', '增幅', '增长', 'change', 'growth', 'vs']

  const hasTime = headers.some(h => timeKeywords.some(k => h.toLowerCase().includes(k)))
  const hasRank = headers.some(h => rankKeywords.some(k => h.toLowerCase().includes(k)))
  const hasRatio = headers.some(h => ratioKeywords.some(k => h.toLowerCase().includes(k)))
  const hasBand = headers.some(h => bandKeywords.some(k => h.toLowerCase().includes(k)))
  const hasTrend = headers.some(h => trendKeywords.some(k => h.toLowerCase().includes(k)))

  if (hasBand && !hasTime) return 'bar'
  if (hasRank) return 'horizontalBar'
  if (hasRatio && numColCount === 1 && rowCount <= 8 && rowCount > 1) return 'pie'
  if (hasTrend && numColCount > 1) return 'composed'
  if (hasTime) return rowCount > 6 ? 'line' : 'bar'

  return 'bar'
}

/**
 * 解析数值（移除单位和千分位）
 */
export function parseNumericValue(value: string | number): number {
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[,%¥￥+元万亿个次人笔分pt$]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * 获取表格中的数值列名
 */
export function getNumericHeaders(headers: string[], data: Record<string, string>[]): string[] {
  return headers.filter(h =>
    data.some(row => {
      const cleanValue = cleanNumericValue(String(row[h] || ''))
      return /^-?\d+(\.\d+)?$/.test(cleanValue) && cleanValue !== ''
    })
  )
}

/**
 * 获取分类列（第一个非数值列）
 */
export function getCategoryHeader(headers: string[], numericHeaders: string[]): string {
  return headers.find(h => !numericHeaders.includes(h)) || headers[0]
}

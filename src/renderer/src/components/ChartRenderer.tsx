/**
 * ChartRenderer — Markdown 表格自动图表化组件
 * 支持柱状图、折线图、饼图、条形图、组合图，可切换
 */

import React, { useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area
} from 'recharts'
import { BarChart2, TrendingUp, PieChart as PieIcon, Table2, Columns } from 'lucide-react'
import { type ParsedTable, type ChartType, parseNumericValue, getNumericHeaders, getCategoryHeader } from '../utils/tableParser'

const COLORS = [
  '#3b82f6', '#8b5cf6', '#f43f5e', '#f59e0b', '#10b981',
  '#06b6d4', '#84cc16', '#6366f1', '#ec4899', '#14b8a6',
]

interface ChartRendererProps {
  table: ParsedTable
}

const ChartRenderer: React.FC<ChartRendererProps> = ({ table }) => {
  const { headers, data, chartType: initialChartType } = table
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('table')
  const [currentChartType, setCurrentChartType] = useState<ChartType>(initialChartType)
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({})

  const numericHeaders = getNumericHeaders(headers, data)
  const categoryHeader = getCategoryHeader(headers, numericHeaders)

  const chartData = data.map(row => {
    const newRow: Record<string, any> = {}
    headers.forEach(header => {
      const value = row[header]
      const cleanValue = String(value).replace(/[,%¥￥+元万亿个次人笔分pt$]/g, '').trim()
      const isPureNumber = /^-?\d+(\.\d+)?$/.test(cleanValue)
      newRow[header] = isPureNumber ? parseNumericValue(value) : value
    })
    return newRow
  })

  const handleLegendClick = (dataKey: string) => {
    setHiddenSeries(prev => ({ ...prev, [dataKey]: !prev[dataKey] }))
  }

  const commonAxisProps = {
    tick: { fill: '#6b7280', fontSize: 12 },
    axisLine: { stroke: '#e5e7eb' },
    tickLine: { stroke: '#e5e7eb' }
  }

  const commonTooltipProps = {
    contentStyle: {
      fontSize: '12px', borderRadius: '8px', border: 'none',
      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', padding: '12px'
    }
  }

  const renderChart = () => {
    const commonProps = { data: chartData, margin: { top: 20, right: 30, left: 20, bottom: 5 } }

    switch (currentChartType) {
      case 'horizontalBar':
        return (
          <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 40)}>
            <BarChart {...commonProps} layout="vertical" margin={{ ...commonProps.margin, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" {...commonAxisProps} />
              <YAxis dataKey={categoryHeader} type="category" width={100} {...commonAxisProps} />
              <Tooltip {...commonTooltipProps} />
              <Legend onClick={(e: any) => handleLegendClick(e.dataKey)} />
              {numericHeaders.map((header, idx) => (
                <Bar key={header} dataKey={header} fill={COLORS[idx % COLORS.length]}
                  hide={hiddenSeries[header]} radius={[0, 4, 4, 0]} barSize={24} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey={categoryHeader} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip {...commonTooltipProps} />
              <Legend onClick={(e: any) => handleLegendClick(e.dataKey)} />
              {numericHeaders.map((header, idx) => (
                <Line key={header} type="monotone" dataKey={header}
                  stroke={COLORS[idx % COLORS.length]} strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
                  hide={hiddenSeries[header]} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'pie': {
        const pieMetric = numericHeaders[0]
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                paddingAngle={2} dataKey={pieMetric} nameKey={categoryHeader}>
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip {...commonTooltipProps} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )
      }

      case 'composed':
        return (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey={categoryHeader} {...commonAxisProps} />
              <YAxis yAxisId="left" {...commonAxisProps} />
              <YAxis yAxisId="right" orientation="right" {...commonAxisProps} />
              <Tooltip {...commonTooltipProps} />
              <Legend onClick={(e: any) => handleLegendClick(e.dataKey)} />
              {numericHeaders.map((header, idx) => {
                const isLine = /率|比|增幅|增长|change|growth|trend/i.test(header)
                if (isLine) {
                  return <Line key={header} yAxisId="right" type="monotone" dataKey={header}
                    stroke={COLORS[idx % COLORS.length]} strokeWidth={2.5}
                    dot={{ r: 3, fill: '#fff' }} hide={hiddenSeries[header]} />
                }
                return <Bar key={header} yAxisId="left" dataKey={header}
                  fill={COLORS[idx % COLORS.length]} hide={hiddenSeries[header]}
                  radius={[4, 4, 0, 0]} barSize={28} />
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey={categoryHeader} {...commonAxisProps} />
              <YAxis {...commonAxisProps} />
              <Tooltip {...commonTooltipProps} />
              <Legend onClick={(e: any) => handleLegendClick(e.dataKey)} />
              {numericHeaders.map((header, idx) => (
                <Bar key={header} dataKey={header} fill={COLORS[idx % COLORS.length]}
                  hide={hiddenSeries[header]} radius={[4, 4, 0, 0]} barSize={28} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
    }
  }

  const chartTypeButtons: { type: ChartType; icon: React.ReactNode; label: string }[] = [
    { type: 'bar', icon: <BarChart2 size={14} />, label: '柱状' },
    { type: 'line', icon: <TrendingUp size={14} />, label: '折线' },
    { type: 'horizontalBar', icon: <Columns size={14} />, label: '条形' },
    { type: 'pie', icon: <PieIcon size={14} />, label: '饼图' },
    { type: 'composed', icon: <TrendingUp size={14} />, label: '组合' },
  ]

  return (
    <div className="my-4 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          {activeTab === 'chart' && chartTypeButtons.map(btn => (
            <button key={btn.type} onClick={() => setCurrentChartType(btn.type)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                currentChartType === btn.type
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'text-slate-500 hover:bg-slate-200'
              }`}>
              {btn.icon}
              <span>{btn.label}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={() => setActiveTab('chart')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
              activeTab === 'chart' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-200'
            }`}>
            <BarChart2 size={13} /> 图表
          </button>
          <button onClick={() => setActiveTab('table')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${
              activeTab === 'table' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-200'
            }`}>
            <Table2 size={13} /> 表格
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-4">
        {activeTab === 'chart' ? renderChart() : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-50">
                  {headers.map((header, idx) => (
                    <th key={idx} className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-slate-50 transition-colors">
                    {headers.map((header, cellIdx) => (
                      <td key={cellIdx} className="border border-slate-200 px-3 py-2 text-slate-600">
                        {row[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChartRenderer

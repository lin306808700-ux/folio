// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useMemo, useRef, useState } from 'react'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import { theme } from 'antd'
import { AimOutlined, CompressOutlined, MenuFoldOutlined, UnorderedListOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'

type LearningStatus = 'unexplored' | 'learning' | 'understood' | 'verified'

interface MindNode {
  id: string
  parentId: string | null
  title: string
  status: LearningStatus
  summary?: string
  nextStep?: string
}

interface Props {
  nodes: MindNode[]
  currentNodeId?: string
  selectedNodeId?: string
  onNodeClick?: (nodeId: string) => void
}

const STATUS_COLOR: Record<LearningStatus, string> = {
  unexplored: '#94a3b8',
  learning: '#0ea5e9',
  understood: '#f59e0b',
  verified: '#10b981',
}

const STATUS_LABEL: Record<LearningStatus, string> = {
  unexplored: '未开始',
  learning: '学习中',
  understood: '已理解',
  verified: '已验证',
}

// 修复首次缩放「飞走」：scaleFit 把 transform-origin 留为 "50% 50%"（map 中心），
// 而库的锚点缩放公式在首次缩放时把 origin 覆写为根节点中心再按新原点算平移，
// 旧画面却是在旧原点下渲染的，产生整体位移 E=(e/u)(1-u)(R-O1)，缩放比越小偏移越大。
// 在任何缩放手势前把 origin 归一到根节点中心并补偿 translate，画面不动、后续锚点精确。
function normalizeScaleOrigin(mind: any) {
  const map: HTMLElement | undefined = mind?.map
  if (!map) return
  const root = map.querySelector('me-root') as HTMLElement | null
  if (!root) return
  const targetX = root.offsetLeft + root.offsetWidth / 2
  const targetY = map.offsetHeight / 2
  const targetOrigin = `${targetX}px ${targetY}px`
  if (map.style.transformOrigin === targetOrigin) return

  // 当前原点换算成像素（库只会写 px 与 50% 两种形态）
  const parts = (map.style.transformOrigin || '50% 50%').split(' ')
  const toPx = (part: string, total: number) =>
    part.endsWith('%') ? (parseFloat(part) / 100) * total : parseFloat(part) || 0
  const oldX = toPx(parts[0], map.offsetWidth)
  const oldY = toPx(parts[1], map.offsetHeight)
  if (oldX === targetX && oldY === targetY) {
    map.style.transformOrigin = targetOrigin
    return
  }

  const match = map.style.transform.match(/translate3d\(([^,]+),\s*([^,]+)/)
  const tx = match ? parseFloat(match[1]) : 0
  const ty = match ? parseFloat(match[2]) : 0
  const scale = mind.scaleVal || 1
  // 保持渲染不动：T + (1-s)O 守恒 → T2 = T1 + (1-s)(O1 - O2)
  map.style.transform = `translate3d(${tx + (1 - scale) * (oldX - targetX)}px, ${ty + (1 - scale) * (oldY - targetY)}px, 0) scale(${scale})`
  map.style.transformOrigin = targetOrigin
}

// 扁平节点 → mind-elixir 树结构；状态走分支色，当前位置加 📍 前缀
function buildTree(nodes: MindNode[], currentNodeId?: string): any {
  const grouped = new Map<string | null, MindNode[]>()
  nodes.forEach(node => grouped.set(node.parentId, [...(grouped.get(node.parentId) || []), node]))
  const toObj = (node: MindNode): any => ({
    id: node.id,
    topic: node.id === currentNodeId ? `📍 ${node.title}` : node.title,
    branchColor: STATUS_COLOR[node.status],
    children: (grouped.get(node.id) || []).map(toObj),
  })
  const roots = grouped.get(null) || []
  return roots.length > 0 ? toObj(roots[0]) : null
}

// mind-elixir 节点 DOM 上的 id 形如 "me" + id
function nodeIdFromTpc(tpc: HTMLElement | null): string | null {
  const raw = tpc?.dataset.nodeid
  return raw && raw.startsWith('me') ? raw.slice(2) : null
}

interface HoverState {
  id: string
  left: number
  top: number
}

export default function LearningMindMap({ nodes, currentNodeId, onNodeClick }: Props) {
  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const mindRef = useRef<any>(null)
  const clickRef = useRef(onNodeClick)
  clickRef.current = onNodeClick
  const hoverTimer = useRef<number>()
  const [scalePercent, setScalePercent] = useState(100)
  const [hover, setHover] = useState<HoverState | null>(null)

  const rootData = useMemo(() => buildTree(nodes, currentNodeId), [nodes, currentNodeId])
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  // 哪些节点拥有子节点，决定点击是展开还是开详情
  const parentIdsRef = useRef<Set<string>>(new Set())
  parentIdsRef.current = useMemo(
    () => new Set(nodes.filter(node => node.parentId).map(node => node.parentId as string)),
    [nodes],
  )
  const hoverNode = hover ? nodeById.get(hover.id) : null
  // 记录已自动适配过画布的图谱根 id，切换图谱时重新 fit
  const lastFitRootRef = useRef<string | null>(null)

  const customTheme = useMemo(() => ({
    ...MindElixir.THEME,
    name: 'muse',
    cssVar: {
      ...MindElixir.THEME.cssVar,
      '--color': token.colorText,
      '--bgcolor': 'transparent',
      '--main-bgcolor': token.colorBgContainer,
      '--main-bgcolor-transparent': `${token.colorBgContainer}cc`,
      '--main-color': token.colorText,
      '--main-border': `1px solid ${token.colorBorder}`,
      '--selected': token.colorPrimary,
      '--accent-color': token.colorPrimary,
      '--root-color': token.colorText,
      '--root-bgcolor': token.colorBgContainer,
      '--root-border-color': token.colorPrimary,
      '--panel-bgcolor': token.colorBgElevated,
      '--panel-color': token.colorText,
      '--panel-border-color': token.colorBorder,
    },
  }), [token])

  useEffect(() => {
    if (!containerRef.current) return undefined
    const mind = new MindElixir({
      el: containerRef.current,
      direction: MindElixir.RIGHT,
      editable: false,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      // overflowHidden 必须保持 false：为 true 时库跳过挂载拖拽平移/双指缩放的手势处理器
      overflowHidden: false,
      scaleMax: 3,
      scaleMin: 0.1,
      theme: customTheme,
    })
    // 初始数据由下方 refresh effect 在实例就绪后注入（v5 无 setData，refresh 即初始化）
    mind.bus.addListener('scale', (value: number) => setScalePercent(Math.round(value * 100)))
    mindRef.current = mind

    const el = containerRef.current
    // 单击：有子节点展开/收起，叶子节点打开详情；双击：任意节点打开详情
    const onClick = (event: MouseEvent) => {
      const tpc = (event.target as HTMLElement).closest?.('me-tpc') as HTMLElement | null
      const id = nodeIdFromTpc(tpc)
      if (!id || !tpc) return
      const mind = mindRef.current
      if (parentIdsRef.current.has(id) && mind) {
        mind.expandNode(tpc)
        setHover(null)
        return
      }
      clickRef.current?.(id)
    }
    const onDblClick = (event: MouseEvent) => {
      const tpc = (event.target as HTMLElement).closest?.('me-tpc') as HTMLElement | null
      const id = nodeIdFromTpc(tpc)
      if (id) clickRef.current?.(id)
    }
    // 悬停展示知识内容卡：不出图就能「看书学」
    const onOver = (event: MouseEvent) => {
      const tpc = (event.target as HTMLElement).closest?.('me-tpc') as HTMLElement | null
      const id = nodeIdFromTpc(tpc)
      if (!id || !tpc) return
      const containerRect = el.getBoundingClientRect()
      const tpcRect = tpc.getBoundingClientRect()
      let left = tpcRect.right - containerRect.left + 12
      if (left + 320 > containerRect.width) left = Math.max(8, tpcRect.left - containerRect.left - 332)
      window.clearTimeout(hoverTimer.current)
      setHover({
        id,
        left,
        top: Math.max(8, Math.min(tpcRect.top - containerRect.top, containerRect.height - 220)),
      })
    }
    const onOut = (event: MouseEvent) => {
      const to = event.relatedTarget as HTMLElement | null
      if (to?.closest?.('me-tpc') || to?.closest?.('[data-mind-hover-card]')) return
      hoverTimer.current = window.setTimeout(() => setHover(null), 200)
    }
    el.addEventListener('click', onClick)
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseout', onOut)
    // 捕获阶段先于库的手势处理器执行：缩放前归一 transform-origin，消除首次缩放整体偏移
    const onPreZoom = () => normalizeScaleOrigin(mindRef.current)
    el.addEventListener('pointerdown', onPreZoom, true)
    el.addEventListener('wheel', onPreZoom, true)
    return () => {
      el.removeEventListener('click', onClick)
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseout', onOut)
      el.removeEventListener('pointerdown', onPreZoom, true)
      el.removeEventListener('wheel', onPreZoom, true)
      mindRef.current = null
      // mind-elixir 无 destroy，手动清空容器释放 DOM
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 数据或主题变化时刷新
  useEffect(() => {
    const mind = mindRef.current
    if (!mind || !rootData) return
    // 必须走 changeTheme：简单赋值 theme 不会把 cssVar 注入内联样式，
    // 连线生成器读内联样式为空 → parseInt('') = NaN → 分支线全坏
    mind.changeTheme(customTheme, false)
    mind.refresh({ nodeData: rootData })
    // 切换图谱后自动适配画布，保证全图可见
    if (lastFitRootRef.current !== rootData.id) {
      lastFitRootRef.current = rootData.id
      // 延一帧等容器完成布局，避免容器尺寸为 0 时 scaleFit 算出 0
      requestAnimationFrame(() => {
        ;(mindRef.current as any)?.scaleFit?.()
        // scaleFit 会把 origin 留为 50% 50%，立即归一避免首次缩放整体偏移
        normalizeScaleOrigin(mindRef.current)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData, customTheme])

  const zoom = (factor: number) => {
    const mind = mindRef.current
    if (!mind) return
    mind.scale(Math.min(mind.scaleMax, Math.max(mind.scaleMin, mind.scaleVal * factor)))
  }

  const fitView = () => {
    const mind = mindRef.current
    if (mind) {
      ;(mind as any).scaleFit?.()
      normalizeScaleOrigin(mind)
    }
  }

  // 递归改写展开态后重绘，实现一键展开/收起
  const setAllExpanded = (expanded: boolean) => {
    const mind = mindRef.current
    if (!mind?.nodeData) return
    const walk = (obj: any) => {
      if (Array.isArray(obj.children) && obj.children.length > 0) {
        obj.expanded = expanded
        obj.children.forEach(walk)
      }
    }
    walk(mind.nodeData)
    setHover(null)
    mind.refresh()
    ;(mind as any).scaleFit?.()
    normalizeScaleOrigin(mind)
  }

  const focusCurrent = () => {
    const mind = mindRef.current
    const target = currentNodeId ? MindElixir.E(currentNodeId) : null
    if (mind && target) mind.focusNode(target)
  }

  const toolBtn = 'flex h-6 w-6 items-center justify-center rounded hover:opacity-70'

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* 悬停知识内容卡 */}
      {hover && hoverNode && (
        <div
          data-mind-hover-card
          className="absolute z-10 w-80 cursor-pointer rounded-xl border p-4 shadow-lg"
          style={{
            left: hover.left,
            top: hover.top,
            background: token.colorBgElevated,
            borderColor: token.colorBorder,
          }}
          onMouseEnter={() => window.clearTimeout(hoverTimer.current)}
          onMouseLeave={() => setHover(null)}
          onClick={() => { setHover(null); clickRef.current?.(hover.id) }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[hoverNode.status] }} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: token.colorText }}>{hoverNode.title}</span>
            <span className="shrink-0 text-[10px]" style={{ color: token.colorTextTertiary }}>{STATUS_LABEL[hoverNode.status]}</span>
          </div>
          {hoverNode.summary && (
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5" style={{ color: token.colorTextSecondary }}>
              {hoverNode.summary}
            </p>
          )}
          {hoverNode.nextStep && (
            <p className="mt-2 border-t pt-2 text-[10px] leading-4" style={{ borderColor: token.colorBorderSecondary, color: token.colorTextTertiary }}>
              📚 {hoverNode.nextStep}
            </p>
          )}
          {!hoverNode.summary && !hoverNode.nextStep && (
            <p className="mt-2 text-[11px]" style={{ color: token.colorTextTertiary }}>点击查看这个节点的详情</p>
          )}
        </div>
      )}

      {/* 工具条：缩放 / 展开收起 / 定位 */}
      <div
        className="absolute right-3 top-3 flex items-center gap-1 rounded-lg border px-1.5 py-1 shadow-sm"
        style={{ background: token.colorBgElevated, borderColor: token.colorBorder }}
      >
        <button className={toolBtn} title="缩小" onClick={() => zoom(0.85)}>
          <ZoomOutOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
        </button>
        <span className="w-9 text-center text-[10px]" style={{ color: token.colorTextTertiary }}>{scalePercent}%</span>
        <button className={toolBtn} title="放大" onClick={() => zoom(1.18)}>
          <ZoomInOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
        </button>
        <span className="mx-0.5 h-4 w-px" style={{ background: token.colorBorder }} />
        <button className={toolBtn} title="适配画布" onClick={fitView}>
          <CompressOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
        </button>
        <button className={toolBtn} title="全部展开" onClick={() => setAllExpanded(true)}>
          <UnorderedListOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
        </button>
        <button className={toolBtn} title="收起到主干" onClick={() => setAllExpanded(false)}>
          <MenuFoldOutlined style={{ color: token.colorTextSecondary, fontSize: 12 }} />
        </button>
        <span className="mx-0.5 h-4 w-px" style={{ background: token.colorBorder }} />
        <button className={toolBtn} title="回到当前位置" onClick={focusCurrent}>
          <AimOutlined style={{ color: token.colorPrimary, fontSize: 12 }} />
        </button>
      </div>
    </div>
  )
}

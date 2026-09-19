// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useEffect, useMemo, useRef, useState } from 'react'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style'
import { theme } from 'antd'
import {
  AimOutlined, CompressOutlined, DeleteOutlined, EditOutlined, MenuFoldOutlined,
  PlusOutlined, UnorderedListOutlined, ZoomInOutlined, ZoomOutOutlined,
} from '@ant-design/icons'
import {
  CURRENT_MARKER_COLOR, LEARNING_STATUS_ORDER, statusMeta,
  type LearningStatus,
} from './learningStatus'

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
  mapTitle?: string
  onNodeClick?: (nodeId: string) => void
  onAddChild?: (nodeId: string) => void
  onSetCurrent?: (nodeId: string) => void
  onDeleteNode?: (nodeId: string) => void
}

// 多根或存在孤儿节点时的虚拟根，避免节点在导图里凭空消失
const VIRTUAL_ROOT_ID = '__virtual_root__'
const isVirtual = (id: string) => id === VIRTUAL_ROOT_ID

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

// 扁平节点 → mind-elixir 树结构；状态走分支色，当前位置加 📍 前缀。
// 多个根节点（或父节点缺失的孤儿）统一挂到虚拟根下，不再静默丢弃。
function buildTree(nodes: MindNode[], currentNodeId: string | undefined, mapTitle: string): any {
  const ids = new Set(nodes.map(node => node.id))
  const grouped = new Map<string | null, MindNode[]>()
  nodes.forEach(node => {
    // 父节点不存在（数据异常）的节点按根处理，否则它会在图里彻底消失
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null
    grouped.set(key, [...(grouped.get(key) || []), node])
  })
  const toObj = (node: MindNode): any => ({
    id: node.id,
    topic: node.id === currentNodeId ? `📍 ${node.title}` : node.title,
    branchColor: statusMeta(node.status).color,
    children: (grouped.get(node.id) || []).map(toObj),
  })
  const roots = (grouped.get(null) || []).map(toObj)
  if (roots.length === 0) return null
  if (roots.length === 1) return roots[0]
  return {
    id: VIRTUAL_ROOT_ID,
    topic: mapTitle || '知识结构',
    branchColor: '#94a3b8',
    children: roots,
  }
}

// 记录被收起的分支，数据刷新后按原样恢复展开状态
function collectCollapsed(nodeData: any): Set<string> {
  const collapsed = new Set<string>()
  const walk = (obj: any) => {
    if (!obj) return
    if (Array.isArray(obj.children) && obj.children.length > 0 && obj.expanded === false) collapsed.add(obj.id)
    if (Array.isArray(obj.children)) obj.children.forEach(walk)
  }
  walk(nodeData)
  return collapsed
}

function applyCollapsed(nodeData: any, collapsed: Set<string>) {
  const walk = (obj: any) => {
    if (!obj) return
    if (Array.isArray(obj.children) && obj.children.length > 0) obj.expanded = !collapsed.has(obj.id)
    if (Array.isArray(obj.children)) obj.children.forEach(walk)
  }
  walk(nodeData)
}

// 「收起到主干」= 保留根与一级分支，只收起更深层的有子节点分支
function collectDeepCollapsed(nodeData: any): Set<string> {
  const collapsed = new Set<string>()
  const walk = (obj: any, level: number) => {
    if (!obj) return
    const hasChildren = Array.isArray(obj.children) && obj.children.length > 0
    if (hasChildren && level >= 1) collapsed.add(obj.id)
    if (hasChildren) obj.children.forEach((child: any) => walk(child, level + 1))
  }
  walk(nodeData, 0)
  return collapsed
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

interface ContextMenuState {
  id: string
  left: number
  top: number
}

export default function LearningMindMap({
  nodes, currentNodeId, selectedNodeId, mapTitle, onNodeClick, onAddChild, onSetCurrent, onDeleteNode,
}: Props) {
  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const mindRef = useRef<any>(null)
  const clickRef = useRef(onNodeClick)
  clickRef.current = onNodeClick
  const hoverTimer = useRef<number | undefined>(undefined)
  const hoverIdRef = useRef<string | null>(null)
  const collapsedRef = useRef<Set<string>>(new Set())
  const [scalePercent, setScalePercent] = useState(100)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const rootData = useMemo(
    () => buildTree(nodes, currentNodeId, mapTitle || '知识结构'),
    [nodes, currentNodeId, mapTitle],
  )
  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
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

  // 选中态高亮：库不支持节点级内联样式，直接在 DOM 上标注
  const paintSelection = (id?: string) => {
    const container = containerRef.current
    if (!container || !mindRef.current) return
    container.querySelectorAll('me-tpc[data-muse-selected]').forEach(element => {
      const el = element as HTMLElement
      el.removeAttribute('data-muse-selected')
      el.style.outline = ''
      el.style.outlineOffset = ''
    })
    if (!id || isVirtual(id)) return
    const target = container.querySelector(`me-tpc[data-nodeid="me${id}"]`) as HTMLElement | null
    if (!target) return
    target.setAttribute('data-muse-selected', '1')
    target.style.outline = `2px solid ${CURRENT_MARKER_COLOR}`
    target.style.outlineOffset = '2px'
  }

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
    // 两种手势各管一件事：
    // - 库自带的圆钮（me-epd，仅库渲染不绑事件）→ 展开/收起分支
    // - 节点本体 → 打开详情抽屉
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      setMenu(null)
      const epd = target.closest?.('me-epd') as HTMLElement | null
      if (epd) {
        const tpc = epd.closest('me-parent')?.querySelector('me-tpc') as HTMLElement | null
        if (tpc && mindRef.current) {
          mindRef.current.expandNode(tpc)
          hoverIdRef.current = null
          setHover(null)
        }
        return
      }
      const id = nodeIdFromTpc(target.closest?.('me-tpc') as HTMLElement | null)
      if (!id || isVirtual(id)) return
      clickRef.current?.(id)
    }
    const onContextMenu = (event: MouseEvent) => {
      const id = nodeIdFromTpc((event.target as HTMLElement).closest?.('me-tpc') as HTMLElement | null)
      if (!id || isVirtual(id)) return
      event.preventDefault()
      const containerRect = el.getBoundingClientRect()
      setHover(null)
      setMenu({
        id,
        left: Math.max(8, Math.min(event.clientX - containerRect.left, containerRect.width - 160)),
        top: Math.max(8, Math.min(event.clientY - containerRect.top, containerRect.height - 170)),
      })
    }
    // 悬停展示知识内容卡：不出图就能「看书学」
    const onOver = (event: MouseEvent) => {
      const tpc = (event.target as HTMLElement).closest?.('me-tpc') as HTMLElement | null
      const id = nodeIdFromTpc(tpc)
      if (!id || !tpc || isVirtual(id)) return
      // 在同一个节点内部移动会持续触发 mouseover，按 id 去重避免反复重渲染
      if (hoverIdRef.current === id) return
      hoverIdRef.current = id
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
      hoverIdRef.current = null
      hoverTimer.current = window.setTimeout(() => setHover(null), 200)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setHover(null) }
    }
    el.addEventListener('click', onClick)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseout', onOut)
    // 捕获阶段先于库的手势处理器执行：缩放前归一 transform-origin，消除首次缩放整体偏移
    const onPreZoom = () => normalizeScaleOrigin(mindRef.current)
    el.addEventListener('pointerdown', onPreZoom, true)
    el.addEventListener('wheel', onPreZoom, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('click', onClick)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseout', onOut)
      el.removeEventListener('pointerdown', onPreZoom, true)
      el.removeEventListener('wheel', onPreZoom, true)
      window.removeEventListener('keydown', onKeyDown)
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
    // 先把用户手动收起的分支读出来，刷新时按原样恢复：
    // 否则保存节点/状态变更/预生成完成等任意数据变化都会把整张图重新展开。
    if (mind.nodeData) {
      collapsedRef.current = new Set([...collapsedRef.current, ...collectCollapsed(mind.nodeData)])
    }
    applyCollapsed(rootData, collapsedRef.current)
    // 必须走 changeTheme：简单赋值 theme 不会把 cssVar 注入内联样式，
    // 连线生成器读内联样式为空 → parseInt('') = NaN → 分支线全坏
    mind.changeTheme(customTheme, false)
    mind.refresh({ nodeData: rootData })
    // 切换图谱后自动适配画布，保证全图可见
    if (lastFitRootRef.current !== rootData.id) {
      lastFitRootRef.current = rootData.id
      // 延一帧等容器完成布局，避免容器尺寸为 0 时 scaleFit 算出 0
      requestAnimationFrame(() => {
        (mindRef.current as any)?.scaleFit?.()
        // scaleFit 会把 origin 留为 50% 50%，立即归一避免首次缩放整体偏移
        normalizeScaleOrigin(mindRef.current)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData, customTheme])

  // 选中态随数据/选中节点变化重绘（refresh 会重建节点 DOM）
  useEffect(() => {
    const timer = requestAnimationFrame(() => paintSelection(selectedNodeId))
    return () => cancelAnimationFrame(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootData, selectedNodeId])

  const zoom = (factor: number) => {
    const mind = mindRef.current
    if (!mind) return
    // 工具条在容器之外，收不到捕获阶段的归一化，这里必须自己走一遍，
    // 否则打开图谱后第一次点缩放仍会复现上面注释里的整体偏移。
    normalizeScaleOrigin(mind)
    mind.scale(Math.min(mind.scaleMax, Math.max(mind.scaleMin, mind.scaleVal * factor)))
  }

  const fitView = () => {
    const mind = mindRef.current
    if (mind) {
      (mind as any).scaleFit?.()
      normalizeScaleOrigin(mind)
      paintSelection(selectedNodeId)
    }
  }

  // 递归改写展开态后重绘，实现一键展开/收起
  const setAllExpanded = (expanded: boolean) => {
    const mind = mindRef.current
    if (!mind?.nodeData) return
    // 收起时保留主干（根与一级分支展开），只收更深层，
    // 否则根节点一起收起会把整张图收成一个节点。
    collapsedRef.current = expanded ? new Set<string>() : collectDeepCollapsed(mind.nodeData)
    applyCollapsed(mind.nodeData, collapsedRef.current)
    setHover(null)
    setMenu(null)
    mind.refresh()
    ;(mind as any).scaleFit?.()
    normalizeScaleOrigin(mind)
    paintSelection(selectedNodeId)
  }

  const focusCurrent = () => {
    const mind = mindRef.current
    // 库把 E 声明成实例方法，实际是静态工具函数
    const target = currentNodeId ? (MindElixir as any).E(currentNodeId) : null
    if (mind && target) mind.focusNode(target)
  }

  const menuNode = menu ? nodeById.get(menu.id) : null
  const menuItems = menuNode ? [
    { key: 'open', label: '打开详情', icon: <EditOutlined />, danger: false, disabled: false },
    { key: 'add', label: '添加子主题', icon: <PlusOutlined />, danger: false, disabled: false },
    { key: 'current', label: '设为当前位置', icon: <AimOutlined />, danger: false, disabled: menuNode.id === currentNodeId },
    { key: 'delete', label: '删除节点', icon: <DeleteOutlined />, danger: true, disabled: !menuNode.parentId },
  ] : []

  const runMenuAction = (key: string) => {
    if (!menu) return
    const id = menu.id
    setMenu(null)
    if (key === 'open') clickRef.current?.(id)
    if (key === 'add') onAddChild?.(id)
    if (key === 'current') onSetCurrent?.(id)
    if (key === 'delete') onDeleteNode?.(id)
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
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusMeta(hoverNode.status).color }} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: token.colorText }}>{hoverNode.title}</span>
            <span className="shrink-0 text-[10px]" style={{ color: token.colorTextTertiary }}>{statusMeta(hoverNode.status).label}</span>
          </div>
          {hoverNode.summary && (
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5" style={{ color: token.colorTextSecondary }}>
              {hoverNode.summary}
            </p>
          )}
          {hoverNode.nextStep && (
            <p className="mt-2 border-t pt-2 text-[10px] leading-4" style={{ borderColor: token.colorBorderSecondary, color: token.colorTextTertiary }}>
              下一步：{hoverNode.nextStep}
            </p>
          )}
          {!hoverNode.summary && !hoverNode.nextStep && (
            <p className="mt-2 text-[11px]" style={{ color: token.colorTextTertiary }}>点击查看这个节点的详情</p>
          )}
          <p className="mt-2 text-[10px]" style={{ color: token.colorTextTertiary }}>右键可添加子主题、设为当前位置或删除</p>
        </div>
      )}

      {/* 节点右键菜单 */}
      {menu && menuNode && (
        <div
          className="absolute z-20 w-40 overflow-hidden rounded-lg border py-1 shadow-lg"
          style={{ left: menu.left, top: menu.top, background: token.colorBgElevated, borderColor: token.colorBorder }}
        >
          {menuItems.map(item => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => runMenuAction(item.key)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-fill-secondary disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: item.danger ? '#dc2626' : token.colorText }}
            >
              <span className="text-[11px]">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* 状态图例 + 手势说明：颜色与知识树/看板共用同一套定义 */}
      <div
        className="absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-lg border px-2.5 py-1.5 shadow-sm"
        style={{ background: token.colorBgElevated, borderColor: token.colorBorder }}
      >
        <div className="flex items-center gap-3">
          {LEARNING_STATUS_ORDER.map(status => (
            <span key={status} className="flex items-center gap-1 text-[10px]" style={{ color: token.colorTextTertiary }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusMeta(status).color }} />
              {statusMeta(status).label}
            </span>
          ))}
        </div>
        <div className="text-[10px]" style={{ color: token.colorTextTertiary }}>
          点节点打开详情 · 点节点右侧圆钮展开收起 · 右键更多操作
        </div>
      </div>

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
        <button className={toolBtn} title="回到当前位置" onClick={focusCurrent} disabled={!currentNodeId}>
          <AimOutlined style={{ color: currentNodeId ? CURRENT_MARKER_COLOR : token.colorTextTertiary, fontSize: 12 }} />
        </button>
      </div>
    </div>
  )
}

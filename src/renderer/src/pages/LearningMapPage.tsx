// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Card, Dropdown, Empty, Form, Input, Modal, Segmented, Select, Spin, Switch, Steps, Tag, Tree, message,
} from 'antd'
import {
  AimOutlined, AppstoreOutlined, CheckCircleOutlined, CompassOutlined, DeleteOutlined, EditOutlined,
  GatewayOutlined, GlobalOutlined, MessageOutlined, MoreOutlined, PartitionOutlined, PlusOutlined,
  SaveOutlined, SyncOutlined,
} from '@ant-design/icons'
import PageShell from '../components/PageShell'
import LearningMindMap from '../components/LearningMindMap'
import LearningBoard from '../components/LearningBoard'
import LearningBookReader from '../components/LearningBookReader'
import {
  CURRENT_MARKER_COLOR, LEARNING_STATUS_META, LEARNING_STATUS_ORDER, countByStatus, formatPercent,
  statusMeta, verifiedSourceLabel, type LearningStatus,
} from '../components/learningStatus'
import { isElectron } from '../utils/config'
import type { LearningEdge, LearningMapMeta, LearningNode, LearningNodeMeta } from '../types/electron'

interface DetailGuide { nodeId?: string; nodeTitle: string }

function getPath(nodes: LearningNodeMeta[], nodeId: string): LearningNodeMeta[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const path: LearningNodeMeta[] = []
  let cursor = byId.get(nodeId)
  const visited = new Set<string>()
  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor)
    visited.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return path
}

interface TreeNodeData {
  key: string
  title: string
  node: LearningNodeMeta
  children?: TreeNodeData[]
}

function buildTree(nodes: LearningNodeMeta[]): TreeNodeData[] {
  const ids = new Set(nodes.map(node => node.id))
  const grouped = new Map<string | null, LearningNodeMeta[]>()
  nodes.forEach(node => {
    // 父节点缺失的节点当根处理，避免它在树里凭空消失
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null
    grouped.set(key, [...(grouped.get(key) || []), node])
  })
  const toData = (parentId: string | null): TreeNodeData[] =>
    (grouped.get(parentId) || []).map(node => ({
      key: node.id,
      title: node.title,
      node,
      children: toData(node.id),
    }))
  return toData(null)
}

interface SkeletonNode {
  title: string
  summary: string
  children: SkeletonNode[]
}

type SkeletonBranch = SkeletonNode

// 骨架最多三层：领域 → 板块 → 知识点 → 细分。
// 再深就不该由 AI 一次性铺出来了（那属于自己下钻的范畴），而且层级越深
// 越容易凑数——「为凑层数而拆」正是骨架最容易失真的地方。
const SKELETON_MAX_DEPTH = 3
// 一次铺出的总量上限：提示词要 45-70，留出余量但不允许无界展开
const SKELETON_MAX_NODES = 120

function parseSkeletonNodes(raw: unknown, depth: number, budget: { left: number }): SkeletonNode[] {
  if (depth > SKELETON_MAX_DEPTH || budget.left <= 0) return []
  return (Array.isArray(raw) ? raw : [])
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof (item as Record<string, unknown>).title === 'string')
    .slice(0, Math.min(depth === 1 ? 10 : 8, budget.left))
    .map(item => {
      budget.left -= 1
      return {
        title: String(item.title).trim().slice(0, 120),
        summary: String(item.summary || '').trim().slice(0, 500),
        children: parseSkeletonNodes(item.children, depth + 1, budget),
      }
    })
    .filter(node => node.title)
}

// 宽容解析领域骨架 JSON（容忍 ```json 围栏与多余文字）
function parseSkeleton(raw: string): { scaleEstimate: number; branches: SkeletonBranch[] } | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const branches = parseSkeletonNodes(parsed?.branches, 1, { left: SKELETON_MAX_NODES })
    if (branches.length === 0) return null
    const scaleEstimate = Number.isFinite(Number(parsed?.scaleEstimate)) ? Math.round(Number(parsed.scaleEstimate)) : 0
    return { scaleEstimate, branches }
  } catch {
    return null
  }
}

export default function LearningMapPage() {
  const navigate = useNavigate()
  const [messageApi, messageHolder] = message.useMessage()
  const [maps, setMaps] = useState<LearningMapMeta[]>([])
  const [activeMapId, setActiveMapId] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  // 抽屉需要完整节点（正文/问答/验收记录），按需单取；列表只拿元数据
  const [detailNode, setDetailNode] = useState<LearningNode | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [viewMode, setViewMode] = useState<'mindmap' | 'board'>('mindmap')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [prefetchEnabled, setPrefetchEnabled] = useState(true)
  const [skeletonRunning, setSkeletonRunning] = useState(false)
  const [prefetch, setPrefetch] = useState<{ active: boolean; current: { mapId: string; nodeId: string; title: string } | null; queueLeft: number; stalled: number; doneSession: number } | null>(null)
  const [createForm] = Form.useForm<{ title: string; description: string }>()
  const [addForm] = Form.useForm<{ title: string }>()
  const [renameForm] = Form.useForm<{ title: string; description: string }>()
  const [nodeForm] = Form.useForm()
  const [renameTarget, setRenameTarget] = useState<LearningMapMeta | null>(null)

  const activeMap = maps.find(map => map.id === activeMapId) || maps[0] || null
  const selectedNode = activeMap?.nodes.find(node => node.id === selectedNodeId) || null
  const currentNode = activeMap?.nodes.find(node => node.id === activeMap.currentNodeId) || null
  const selectedPath = activeMap && selectedNode ? getPath(activeMap.nodes, selectedNode.id) : []
  const currentPath = activeMap && currentNode ? getPath(activeMap.nodes, currentNode.id) : []
  const counts = useMemo(() => countByStatus(activeMap?.nodes || []), [activeMap])

  const treeData = useMemo(() => (activeMap ? buildTree(activeMap.nodes) : []), [activeMap])

  // 全书目录有两份，用途不同：
  //   nodeDirectory —— 带 nodeId，给验收批改用（引导要能定位到具体章节）
  //   outlineTitles —— 纯标题缩进树，给章节撰写用（模型不需要看到内部 id，否则可能把它写进正文）
  const { nodeDirectory, outlineTitles } = useMemo(() => {
    if (!activeMap) return { nodeDirectory: '', outlineTitles: '' }
    const ids = new Set(activeMap.nodes.map(node => node.id))
    const byParent = new Map<string | null, LearningNodeMeta[]>()
    activeMap.nodes.forEach(node => {
      const key = node.parentId && ids.has(node.parentId) ? node.parentId : null
      byParent.set(key, [...(byParent.get(key) || []), node])
    })
    const withIds: string[] = []
    const titlesOnly: string[] = []
    const walk = (parentId: string | null, level: number) => {
      for (const node of byParent.get(parentId) || []) {
        withIds.push(`${'  '.repeat(level)}- [${node.id}] ${node.title}`)
        titlesOnly.push(`${'  '.repeat(level)}- ${node.title}`)
        walk(node.id, level + 1)
      }
    }
    walk(null, 0)
    return { nodeDirectory: withIds.join('\n'), outlineTitles: titlesOnly.join('\n') }
  }, [activeMap])

  // 骨架节点数：分母。没有骨架的图谱（含内置演示图谱）退化为全部节点
  const canonCount = useMemo(
    () => (activeMap ? activeMap.nodes.filter(node => node.origin === 'canon').length : 0),
    [activeMap],
  )

  const loadMaps = useCallback(async (preferredMapId?: string, preferredNodeId?: string) => {
    if (!isElectron) {
      setLoading(false)
      return
    }
    const result = await window.electronAPI.muse.learning.listMeta()
    if (!result.success) throw new Error(result.error || '加载学习图谱失败')
    const nextMaps = result.data || []
    setMaps(nextMaps)
    const nextMap = nextMaps.find(map => map.id === (preferredMapId || activeMapId)) || nextMaps[0]
    setActiveMapId(nextMap?.id || '')
    setSelectedNodeId(preferredNodeId || nextMap?.currentNodeId || nextMap?.nodes[0]?.id || '')
  }, [activeMapId])

  const loadDetail = useCallback(async (mapId: string, nodeId: string) => {
    if (!isElectron || !mapId || !nodeId) {
      setDetailNode(null)
      return
    }
    setDetailLoading(true)
    try {
      const result = await window.electronAPI.muse.learning.getNode(mapId, nodeId)
      setDetailNode(result.success && result.data ? result.data : null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // 一次刷新：元数据 + 当前详情（写入后由阅读器/表单调用）
  const refresh = useCallback(async (mapId?: string, nodeId?: string) => {
    const targetMapId = mapId || activeMapId
    const targetNodeId = nodeId || selectedNodeId
    await loadMaps(targetMapId, targetNodeId)
    if (targetNodeId) await loadDetail(targetMapId, targetNodeId)
  }, [activeMapId, selectedNodeId, loadMaps, loadDetail])

  // 领域骨架：全局感的唯一来源。个人探索永远长不出「不知道自己不知道」的部分，
  // 所以分母必须由外部清单给出，否则覆盖度只是「已建节点」的自我循环。
  const skeletonReqRef = useRef<{ requestId: string; mapId: string; rootId: string } | null>(null)

  const generateSkeleton = async () => {
    if (!activeMap || skeletonRunning) return
    const root = activeMap.nodes.find(node => !node.parentId) || activeMap.nodes[0]
    if (!root) return
    const requestId = `lrn_skeleton_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    skeletonReqRef.current = { requestId, mapId: activeMap.id, rootId: root.id }
    setSkeletonRunning(true)
    const result = await window.electronAPI.muse.learning.aiAsk({
      requestId,
      kind: 'skeleton',
      mapTitle: activeMap.title,
      nodeTitle: activeMap.title,
      nodePath: activeMap.title,
      description: activeMap.description || '',
      // 已有节点全部带上做去重，避免补充骨架时把同一批概念再铺一遍
      existingTitles: activeMap.nodes.length > 1
        ? activeMap.nodes.map(node => `- ${node.title}`).join('\n')
        : '',
    })
    if (!result.success) {
      skeletonReqRef.current = null
      setSkeletonRunning(false)
      messageApi.error(result.error || 'AI 通道不可用')
    }
  }

  useEffect(() => {
    return window.electronAPI.muse.learning.onAiEnd(async data => {
      const pending = skeletonReqRef.current
      if (!pending || data.requestId !== pending.requestId) return
      skeletonReqRef.current = null
      setSkeletonRunning(false)
      if (!data.success) {
        messageApi.info(data.error || '骨架生成已停止')
        return
      }
      const parsed = parseSkeleton(data.content)
      if (!parsed) {
        messageApi.error('AI 未返回有效的领域骨架')
        return
      }
      const api = window.electronAPI.muse.learning
      let created = 0
      // 递归写入：骨架可以有三层，逐层建完父节点再挂子节点（子节点需要父节点 id）
      const insert = async (parentId: string, siblings: SkeletonNode[]): Promise<void> => {
        if (siblings.length === 0) return
        const result = await api.addNodes({
          mapId: pending.mapId,
          items: siblings.map(node => ({
            parentId,
            title: node.title,
            summary: node.summary,
            origin: 'canon' as const,
          })),
        })
        if (!result.success) return
        const written = result.data || []
        created += written.length
        // addNodes 按入参顺序创建，返回顺序与之一致，因此可以按下标对应回原结构
        for (let index = 0; index < written.length; index += 1) {
          await insert(written[index].id, siblings[index].children)
        }
      }
      await insert(pending.rootId, parsed.branches)
      if (created === 0) {
        messageApi.error('骨架未能写入')
        return
      }
      await api.setCanon({
        mapId: pending.mapId,
        canon: { scaleEstimate: parsed.scaleEstimate, source: 'ai' },
      })
      await refresh(pending.mapId)
      messageApi.success(
        parsed.scaleEstimate > created
          ? `已铺出 ${created} 个知识点，AI 估计本领域约有 ${parsed.scaleEstimate} 个概念可学`
          : `已铺出 ${created} 个知识点`,
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, messageApi])

  useEffect(() => {
    loadMaps().catch(cause => messageApi.error(cause instanceof Error ? cause.message : '加载失败')).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!detailOpen || !activeMap || !selectedNodeId) return
    loadDetail(activeMap.id, selectedNodeId).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen, activeMap?.id, selectedNodeId])

  // 后台预生成状态：顶栏徽标展示；预制完成当前打开的章节时自动刷新
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  const activeMapIdRef = useRef(activeMapId)
  activeMapIdRef.current = activeMapId
  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.muse.learning.prefetchStatus().then(result => {
      if (result.success && result.data) setPrefetch(result.data)
    }).catch(() => {})
    window.electronAPI.muse.learning.getSettings().then(result => {
      if (result.success && result.data) setPrefetchEnabled(result.data.prefetchEnabled)
    }).catch(() => {})
    const off = window.electronAPI.muse.learning.onPrefetchStatus(data => {
      setPrefetch({ active: data.active, current: data.current, queueLeft: data.queueLeft, stalled: data.stalled, doneSession: data.doneSession })
      if (data.lastDone && data.lastDone.nodeId === selectedNodeIdRef.current) {
        refresh(activeMapIdRef.current || undefined, selectedNodeIdRef.current).catch(() => {})
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开节点详情抽屉时同步表单
  useEffect(() => {
    if (!detailOpen || !detailNode) return
    nodeForm.setFieldsValue({
      title: detailNode.title,
      status: detailNode.status,
      summary: detailNode.summary || '',
      evidence: detailNode.evidence || '',
      nextStep: detailNode.nextStep || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen, detailNode?.id, detailNode?.updatedAt])

  // 切换节点：编辑态不跨节点残留；有未保存修改先确认，避免静默丢弃
  const openNode = async (nodeId: string) => {
    if (detailOpen && editMode && selectedNodeId !== nodeId) {
      if (nodeForm.isFieldsTouched()) {
        const confirmed = await new Promise<boolean>(resolve => {
          Modal.confirm({
            title: '放弃未保存的修改？',
            content: '当前节点还有未保存的编辑内容，切换节点会丢失这些修改。',
            okText: '放弃修改',
            okButtonProps: { danger: true },
            cancelText: '留在当前节点',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })
        if (!confirmed) return
      }
      setEditMode(false)
    }
    if (selectedNodeId === nodeId) {
      setDetailOpen(true)
      return
    }
    setSelectedNodeId(nodeId)
    setDetailOpen(true)
  }

  // 验收引导跳转：优先按 nodeId 定位，历史记录退回按章节名匹配
  const navigateToGuide = async (guide: DetailGuide) => {
    if (!activeMap) return
    const target = (guide.nodeId && activeMap.nodes.find(node => node.id === guide.nodeId))
      || activeMap.nodes.find(node => node.title === guide.nodeTitle)
    if (!target) {
      messageApi.info('未找到该章节，请手动在目录中查找')
      return
    }
    await openNode(target.id)
  }

  // 删掉一条 AI 标错的连接边（树结构不受影响）
  const dropEdge = async (nodeId: string, edge: LearningEdge) => {
    if (!activeMap) return
    const result = await window.electronAPI.muse.learning.removeEdge({
      mapId: activeMap.id,
      nodeId,
      target: {
        type: edge.type,
        targetNodeId: edge.targetNodeId,
        targetMapId: edge.targetMapId,
        targetTitle: edge.targetTitle,
      },
    })
    if (!result.success) {
      messageApi.error(result.error || '删除连接失败')
      return
    }
    await refresh(activeMap.id, nodeId)
    messageApi.success('已删除连接')
  }

  const quickUpdateStatus = async (status: LearningStatus) => {
    if (!activeMap || !selectedNode) return
    const result = await window.electronAPI.muse.learning.updateNode({ mapId: activeMap.id, nodeId: selectedNode.id, updates: { status } })
    if (!result.success) {
      messageApi.error(result.error || '更新失败')
      return
    }
    await refresh(activeMap.id, selectedNode.id)
    messageApi.success(`已标记为「${statusMeta(status).label}」`)
  }

  const createMap = async () => {
    const values = await createForm.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const result = await window.electronAPI.muse.learning.create({ title: values.title.trim(), description: values.description || '' })
      if (!result.success || !result.data) throw new Error(result.error || '创建失败')
      setCreateOpen(false)
      createForm.resetFields()
      await loadMaps(result.data.id, result.data.currentNodeId)
      messageApi.success('学习图谱已创建')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  const renameMap = async () => {
    if (!renameTarget) return
    const values = await renameForm.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const result = await window.electronAPI.muse.learning.updateMap({
        mapId: renameTarget.id,
        updates: { title: values.title.trim(), description: values.description || '' },
      })
      if (!result.success) throw new Error(result.error || '保存失败')
      setRenameTarget(null)
      await loadMaps(activeMapId, selectedNodeId)
      messageApi.success('图谱信息已更新')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteMap = (map: LearningMapMeta) => {
    Modal.confirm({
      title: `删除学习图谱「${map.title}」？`,
      content: `其中 ${map.nodes.length} 个知识节点、已撰写的章节正文与问答记录都会一并删除，且不可恢复。`,
      okText: '删除图谱',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.electronAPI.muse.learning.deleteMap(map.id)
        if (!result.success) {
          messageApi.error(result.error || '删除失败')
          return
        }
        setDetailOpen(false)
        await loadMaps()
        messageApi.success('图谱已删除')
      },
    })
  }

  const addNode = async () => {
    if (!activeMap || !selectedNode) return
    const values = await addForm.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const result = await window.electronAPI.muse.learning.addNode({ mapId: activeMap.id, parentId: selectedNode.id, title: values.title.trim() })
      if (!result.success || !result.data) throw new Error(result.error || '添加失败')
      setAddOpen(false)
      addForm.resetFields()
      await refresh(activeMap.id, result.data.id)
      messageApi.success('分支已添加')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '添加失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteNode = (nodeId: string) => {
    if (!activeMap) return
    const node = activeMap.nodes.find(item => item.id === nodeId)
    if (!node) return
    if (!node.parentId) {
      Modal.confirm({
        title: '这是图谱的根节点',
        content: '根节点不能单独删除。如果要放弃整个图谱，请删除图谱本身。',
        okText: '删除图谱',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          await window.electronAPI.muse.learning.deleteMap(activeMap.id)
          setDetailOpen(false)
          await loadMaps()
        },
      })
      return
    }
    const doomed = new Set([nodeId])
    let grew = true
    while (grew) {
      grew = false
      for (const item of activeMap.nodes) {
        if (!doomed.has(item.id) && item.parentId && doomed.has(item.parentId)) { doomed.add(item.id); grew = true }
      }
    }
    const descendants = doomed.size - 1
    Modal.confirm({
      title: `删除「${node.title}」？`,
      content: descendants > 0
        ? `它的 ${descendants} 个子主题、以及这些节点上的章节正文与问答都会一并删除，且不可恢复。`
        : '该节点的章节正文与问答记录会一并删除，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await window.electronAPI.muse.learning.deleteNode({ mapId: activeMap.id, nodeId })
        if (!result.success) {
          messageApi.error(result.error || '删除失败')
          return
        }
        setDetailOpen(false)
        setEditMode(false)
        await loadMaps(activeMap.id, node.parentId || activeMap.currentNodeId)
        messageApi.success('节点已删除')
      },
    })
  }

  const saveNode = async () => {
    if (!activeMap || !selectedNode) return
    const values = await nodeForm.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const result = await window.electronAPI.muse.learning.updateNode({ mapId: activeMap.id, nodeId: selectedNode.id, updates: values })
      if (!result.success) throw new Error(result.error || '保存失败')
      setEditMode(false)
      await refresh(activeMap.id, selectedNode.id)
      messageApi.success('节点已保存')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const markCurrent = async (nodeId?: string) => {
    if (!activeMap) return
    const targetId = nodeId || selectedNode?.id
    if (!targetId) return
    const result = await window.electronAPI.muse.learning.setCurrent({ mapId: activeMap.id, nodeId: targetId })
    if (!result.success) {
      messageApi.error(result.error || '定位失败')
      return
    }
    await loadMaps(activeMap.id, selectedNodeId)
    messageApi.success('已设为当前位置')
  }

  const setStatusFromBoard = async (nodeId: string, status: LearningStatus) => {
    if (!activeMap) return
    const result = await window.electronAPI.muse.learning.updateNode({ mapId: activeMap.id, nodeId, updates: { status } })
    if (!result.success) {
      messageApi.error(result.error || '更新失败')
      return
    }
    await refresh(activeMap.id, selectedNodeId)
    messageApi.success(`已标记为「${statusMeta(status).label}」`)
  }

  const togglePrefetch = async (enabled: boolean) => {
    setPrefetchEnabled(enabled)
    const result = await window.electronAPI.muse.learning.setSettings({ prefetchEnabled: enabled })
    if (!result.success) {
      setPrefetchEnabled(!enabled)
      messageApi.error(result.error || '设置失败')
      return
    }
    messageApi.success(enabled ? '已开启后台预制' : '已关闭后台预制')
  }

  const continueInChat = () => {
    if (!activeMap) return
    const anchor = selectedNode || currentNode
    if (!anchor) return
    const pathText = getPath(activeMap.nodes, anchor.id).map(node => node.title).join(' > ')
    const prompt = [
      `我正在通过 Muse 学习「${activeMap.title}」，当前位置是：${pathText}。`,
      anchor.summary ? `我目前的理解：${anchor.summary}` : '',
      anchor.nextStep ? `计划继续：${anchor.nextStep}` : `请围绕「${anchor.title}」继续教学，并通过追问检查我的理解。`,
    ].filter(Boolean).join('\n')
    sessionStorage.setItem('muse_initial_key', prompt)
    // 这个入口的语义是「开始继续学」，不该让用户再手动按一次发送
    sessionStorage.setItem('muse_initial_autosend', '1')
    navigate('/chat')
  }

  const mapMenuItems = [
    { key: 'rename', label: '编辑图谱信息', icon: <EditOutlined /> },
    { key: 'delete', label: '删除图谱', icon: <DeleteOutlined />, danger: true },
  ]

  const nodeMenuItems = (node: LearningNodeMeta) => [
    { key: 'add', label: '添加子主题', icon: <PlusOutlined /> },
    { key: 'current', label: '设为当前位置', icon: <AimOutlined />, disabled: node.id === activeMap?.currentNodeId },
    { key: 'delete', label: '删除节点', icon: <DeleteOutlined />, danger: true, disabled: !node.parentId },
  ]

  const runNodeMenu = (node: LearningNodeMeta, key: string) => {
    if (key === 'add') { setSelectedNodeId(node.id); setAddOpen(true) }
    if (key === 'current') markCurrent(node.id)
    if (key === 'delete') deleteNode(node.id)
  }

  // 详情窗口里正在展示的节点：与选中节点区分，避免切换选择时正文闪空
  const viewNode = detailNode
  const verifiedCount = counts.verified
  const understoodOnly = counts.understood
  const hasEvidence = Boolean(viewNode?.evidence && viewNode.evidence.trim())

  return (
    <PageShell
      title="学习图谱"
      description="保持知识主干、当前位置和掌握证据清晰可见"
      count={activeMap
        ? `覆盖 ${formatPercent(activeMap.progress.coverage)} · 掌握 ${formatPercent(activeMap.progress.mastery)} · 共 ${activeMap.progress.denominator} 个知识点`
        : undefined}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted" title="空闲时逐章预制书页内容，打开节点即可读">
            <Switch size="small" checked={prefetchEnabled} onChange={togglePrefetch} />
            后台预制
          </span>
          {prefetch && prefetchEnabled && (prefetch.active || prefetch.queueLeft > 0 || prefetch.stalled > 0) && (
            <span className="flex items-center gap-1 rounded-full border border-border-subtle/60 px-2 py-0.5 text-[10px] text-text-muted">
              <SyncOutlined spin={prefetch.active} className="text-sky-500" />
              {prefetch.active ? `正在预制「${prefetch.current?.title || ''}」` : '后台预制中'} · 剩 {prefetch.queueLeft} 章
              {prefetch.stalled > 0 && ` · ${prefetch.stalled} 章暂缓`}
            </span>
          )}
          {activeMap && (
            <Dropdown
              menu={{
                items: mapMenuItems,
                onClick: ({ key }) => {
                  if (!activeMap) return
                  if (key === 'rename') {
                    renameForm.setFieldsValue({ title: activeMap.title, description: activeMap.description || '' })
                    setRenameTarget(activeMap)
                  }
                  if (key === 'delete') deleteMap(activeMap)
                },
              }}
              trigger={['click']}
            >
              <Button size="small" icon={<MoreOutlined />} />
            </Dropdown>
          )}
          {maps.length > 0 && (
            <Select
              size="small"
              value={activeMap?.id || undefined}
              style={{ minWidth: 160 }}
              options={maps.map(map => ({ value: map.id, label: map.builtIn ? `${map.title} · 内置` : map.title }))}
              onChange={value => {
                const map = maps.find(item => item.id === value)
                setActiveMapId(value)
                setEditMode(false)
                setSelectedNodeId(map?.currentNodeId || map?.nodes[0]?.id || '')
              }}
            />
          )}
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建图谱</Button>
        </div>
      )}
      contentClassName="overflow-y-auto p-0 xl:overflow-hidden"
    >
      {messageHolder}
      {loading ? (
        <div className="flex h-full items-center justify-center"><Spin /></div>
      ) : !activeMap ? (
        <div className="flex h-full items-center justify-center p-8">
          <Empty description={(
            <div>
              <div className="text-sm font-medium text-text-primary">从一条清晰的主干开始</div>
              <div className="mt-1 text-xs text-text-muted">建立第一个学习主题，之后每次深入分支时都能找到返回主干的路径。</div>
            </div>
          )}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建学习图谱</Button>
          </Empty>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[260px_minmax(360px,1fr)_300px]">
          {/* 知识树 */}
          <aside className="max-h-56 min-h-0 shrink-0 overflow-y-auto border-b border-border-subtle/60 px-3 py-4 scroll-container xl:max-h-none xl:border-b-0 xl:border-r">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-text-primary" title={activeMap.title}>{activeMap.title}</div>
                <div className="mt-0.5 text-[10px] text-text-faint">
                  {activeMap.nodes.length} 个知识节点 · 已理解 {understoodOnly} · 已验证 {verifiedCount}
                </div>
              </div>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                title="在选中节点下添加分支"
                onClick={() => {
                  if (!selectedNode) {
                    messageApi.info('请先选择一个节点')
                    return
                  }
                  setAddOpen(true)
                }}
              />
            </div>
            <Tree
              className="learning-tree"
              blockNode
              defaultExpandAll
              selectedKeys={selectedNode ? [selectedNode.id] : []}
              treeData={treeData}
              onSelect={(keys) => keys[0] && openNode(String(keys[0]))}
              titleRender={data => {
                const item = data as unknown as TreeNodeData
                const meta = statusMeta(item.node.status)
                return (
                  <span className="group flex min-w-0 items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
                    {item.node.id === activeMap.currentNodeId && (
                      <AimOutlined className="shrink-0" style={{ color: CURRENT_MARKER_COLOR }} />
                    )}
                    <Dropdown
                      menu={{
                        items: nodeMenuItems(item.node),
                        onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); runNodeMenu(item.node, key) },
                      }}
                      trigger={['click']}
                    >
                      <span
                        className="shrink-0 rounded px-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={event => event.stopPropagation()}
                        title="更多操作"
                      >
                        <MoreOutlined className="text-[11px] text-text-faint" />
                      </span>
                    </Dropdown>
                  </span>
                )
              }}
            />
          </aside>

          {/* 思维导图 / 进度看板 */}
          <main className="flex min-h-[380px] min-w-0 flex-1 flex-col xl:min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle/50 px-5 py-2.5">
              <Segmented
                size="small"
                value={viewMode}
                onChange={value => setViewMode(value as 'mindmap' | 'board')}
                options={[
                  { value: 'mindmap', label: <span className="flex items-center gap-1"><PartitionOutlined />知识结构</span> },
                  { value: 'board', label: <span className="flex items-center gap-1"><AppstoreOutlined />进度看板</span> },
                ]}
              />
              {activeMap.nodes.length === 1 && (
                <span className="text-[10px] text-text-faint">
                  只有一个根节点：右键它、或用左侧 + 添加子主题，也可以在节点里用「下钻子主题」让 AI 展开
                </span>
              )}
            </div>
            {viewMode === 'mindmap' ? (
              <div className="min-h-0 flex-1">
                <LearningMindMap
                  nodes={activeMap.nodes}
                  mapTitle={activeMap.title}
                  currentNodeId={activeMap.currentNodeId}
                  selectedNodeId={selectedNode?.id}
                  onNodeClick={openNode}
                  onAddChild={nodeId => { setSelectedNodeId(nodeId); setAddOpen(true) }}
                  onSetCurrent={nodeId => markCurrent(nodeId)}
                  onDeleteNode={deleteNode}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                <LearningBoard
                  nodes={activeMap.nodes}
                  currentNodeId={activeMap.currentNodeId}
                  progress={activeMap.progress}
                  onNodeClick={openNode}
                  onStatusChange={setStatusFromBoard}
                />
              </div>
            )}
          </main>

          {/* 学习罗盘 */}
          <aside className="min-h-0 shrink-0 overflow-y-auto border-t border-border-subtle/60 px-4 py-6 scroll-container xl:border-t-0 xl:border-l">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary"><CompassOutlined className="text-amber-500" />学习罗盘</div>

            {/* 领域骨架：分母。没有它，覆盖度只是「已建节点」的自我循环 */}
            <div className="mt-5 border-b border-border-subtle/50 pb-4">
              <div className="text-[10px] font-semibold text-text-faint">领域骨架</div>
              {activeMap.canon?.generatedAt ? (
                <>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">
                    已铺出 {canonCount} 个知识点。覆盖度 {formatPercent(activeMap.progress.coverage)}，
                    掌握度 {formatPercent(activeMap.progress.mastery)}
                    {activeMap.progress.gap > 0.01 && `，看过没吃透 ${formatPercent(activeMap.progress.gap)}`}。
                  </p>
                  <Button
                    size="small"
                    className="mt-2"
                    icon={<GlobalOutlined />}
                    loading={skeletonRunning}
                    onClick={generateSkeleton}
                  >
                    补充骨架
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">
                    还没有骨架。个人探索永远长不出「不知道自己不知道」的部分 ——
                    先铺一份领域清单，才知道这个领域有多大、自己走到哪了。
                  </p>
                  <Button
                    size="small"
                    type="primary"
                    className="mt-2"
                    icon={<GlobalOutlined />}
                    loading={skeletonRunning}
                    onClick={generateSkeleton}
                  >
                    生成本领域骨架
                  </Button>
                </>
              )}
              {skeletonRunning && (
                <p className="mt-2 text-[10px] leading-4 text-text-faint">AI 正在梳理本领域的板块与知识点，完成后自动入图。</p>
              )}
            </div>

            <div className="mt-5 text-[10px] font-semibold text-text-faint">当前位置</div>
            <div className="mt-3">
              {currentPath.length > 0 ? (
                <Steps
                  direction="vertical"
                  size="small"
                  current={currentPath.length - 1}
                  items={currentPath.map(node => ({
                    title: (
                      <button className="text-left text-xs text-text-muted hover:text-text-primary" onClick={() => openNode(node.id)}>
                        {node.title}
                      </button>
                    ),
                  }))}
                />
              ) : (
                <div className="text-xs text-text-muted">尚未设置当前位置</div>
              )}
            </div>
            <div className="mt-5 border-t border-border-subtle/50 pt-4">
              <div className="text-[10px] font-semibold text-text-faint">回来后继续</div>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                {currentNode?.nextStep || `继续梳理「${currentNode?.title || activeMap.title}」，完成一次独立复述或练习。`}
              </p>
            </div>
            <Button block type="primary" className="mt-4" icon={<MessageOutlined />} onClick={continueInChat}>
              围绕当前位置继续对话
            </Button>
            <div className="mt-5 border-t border-border-subtle/50 pt-4">
              <div className="text-[10px] font-semibold text-text-faint">状态含义</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LEARNING_STATUS_ORDER.map(status => (
                  <Tag key={status} color={LEARNING_STATUS_META[status].tag}>{LEARNING_STATUS_META[status].label}</Tag>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-text-faint">
                手动标记与章节验收都会写入状态；标为「已验证」时请在节点里留下掌握证据。
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* 节点详情：居中窗口。阅读模式下正文列限宽居中，保证行长可读；
          窗口本身居中定位，不再贴右侧。正文区独立滚动，前后编辑区固定。 */}
      <Modal
        centered
        width={960}
        open={detailOpen}
        maskClosable={false}
        onCancel={() => { setDetailOpen(false); setEditMode(false) }}
        title={(
          <div className="pr-6">
            <div className="text-sm font-semibold text-text-primary">
              {viewNode ? viewNode.title : (selectedNode ? selectedNode.title : '节点详情')}
            </div>
            {selectedPath.length > 1 && (
              <div className="mt-0.5 truncate text-[11px] font-normal text-text-faint">
                {selectedPath.slice(0, -1).map(node => node.title).join(' / ')}
              </div>
            )}
          </div>
        )}
        styles={{ body: { maxHeight: 'calc(100vh - 232px)', overflowY: 'auto', paddingTop: 4 } }}
        footer={detailLoading || !viewNode ? null : editMode ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditMode(false)}>取消</Button>
            <Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={saveNode}>保存节点</Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button danger type="text" icon={<DeleteOutlined />} disabled={!viewNode.parentId} onClick={() => deleteNode(viewNode.id)}>删除</Button>
            <Button icon={<EditOutlined />} onClick={() => setEditMode(true)}>编辑</Button>
            <Button type="primary" icon={<MessageOutlined />} onClick={continueInChat}>围绕此节点继续对话</Button>
          </div>
        )}
      >
        {detailLoading || !viewNode ? (
          <div className="flex h-40 items-center justify-center"><Spin /></div>
        ) : editMode ? (
          <div className="mx-auto w-full max-w-[780px]">
            <Steps
              size="small"
              className="mb-6"
              current={selectedPath.length - 1}
              items={selectedPath.map(node => ({ title: <span className="text-[11px]">{node.title}</span> }))}
            />
            <Form form={nodeForm} layout="vertical" size="small">
              <Form.Item name="title" label="知识节点" rules={[{ required: true, message: '请输入节点名称' }]}>
                <Input placeholder="节点名称" />
              </Form.Item>
              <Form.Item name="status" label="学习状态">
                <Select options={LEARNING_STATUS_ORDER.map(value => ({ value, label: LEARNING_STATUS_META[value].label }))} />
              </Form.Item>
              <Form.Item name="summary" label="我学到了什么" extra="用自己的话留下当前理解，不复制 AI 原文。">
                <Input.TextArea rows={5} placeholder="例如：volatile 保证可见性和有序性，但不保证复合操作的原子性。" />
              </Form.Item>
              <Form.Item name="evidence" label="掌握证据" extra="记录一次独立复述、答题、代码实践或纠错结果。">
                <Input.TextArea rows={4} placeholder="例如：不看提示解释了 happens-before，并正确判断 4 道并发可见性题。" />
              </Form.Item>
              <Form.Item name="nextStep" label="下一步">
                <Input.TextArea rows={3} placeholder="下一次回来时从哪里继续，或需要补哪一个前置知识。" />
              </Form.Item>
            </Form>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[780px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag color={statusMeta(viewNode.status).tag}>{statusMeta(viewNode.status).label}</Tag>
              {viewNode.status === 'verified' && (
                <Tag color={viewNode.verifiedBy === 'quiz' ? 'green' : 'default'}>
                  {verifiedSourceLabel(viewNode.verifiedBy)}
                </Tag>
              )}
              {viewNode.id === activeMap?.currentNodeId && (
                <Tag icon={<AimOutlined />} style={{ color: CURRENT_MARKER_COLOR, borderColor: CURRENT_MARKER_COLOR }}>
                  当前位置
                </Tag>
              )}
              {activeMap?.builtIn && <Tag color="purple">内置知识</Tag>}
            </div>
            {/* 路径已移到窗口标题栏，正文区不再重复 */}

            {/* 第 2 层：连接边。树只表达「属于」，横向的同类与通往别处的大门靠边来表达 */}
            {(viewNode.edges || []).length > 0 && (
              <div className="mt-4 rounded-lg border border-border-subtle/60 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-faint">
                  <GatewayOutlined />知识连接
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {(viewNode.edges || []).map((edge, index) => {
                    const peer = edge.targetNodeId
                      ? activeMap?.nodes.find(item => item.id === edge.targetNodeId) || null
                      : null
                    const peerMap = edge.targetMapId
                      ? maps.find(item => item.id === edge.targetMapId) || null
                      : null
                    const typeLabel = edge.type === 'peer' ? '同类' : edge.type === 'prereq' ? '前置' : '跨域'
                    const typeColor = edge.type === 'portal' ? 'purple' : edge.type === 'prereq' ? 'orange' : 'blue'
                    return (
                      <div key={`${edge.type}-${edge.targetNodeId || edge.targetMapId || edge.targetTitle}-${index}`} className="text-[11px] leading-5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Tag color={typeColor} className="m-0">{typeLabel}</Tag>
                          {peer ? (
                            <button className="text-left text-text-muted hover:text-text-primary" onClick={() => openNode(peer.id)}>
                              {peer.title}
                            </button>
                          ) : peerMap ? (
                            <button
                              className="text-left text-text-muted hover:text-text-primary"
                              onClick={() => {
                                setActiveMapId(peerMap.id)
                                setSelectedNodeId(peerMap.currentNodeId || peerMap.nodes[0]?.id || '')
                              }}
                            >
                              {peerMap.title} · 切换图谱
                            </button>
                          ) : (
                            <span className="text-text-muted">
                              {edge.targetTitle || '未命名目标'}
                              {edge.type === 'portal' && <span className="text-text-faint"> · 尚未建图谱</span>}
                            </span>
                          )}
                          <Button
                            type="text"
                            size="small"
                            className="ml-auto"
                            icon={<DeleteOutlined />}
                            title="删除这条连接"
                            onClick={() => dropEdge(viewNode.id, edge)}
                          />
                        </div>
                        {edge.note && <div className="mt-0.5 text-[10px] text-text-faint">{edge.note}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 已验证但没留证据：自己标的「已验证」不该悄悄蒙混过关 */}
            {viewNode.status === 'verified' && !hasEvidence && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-text-muted">
                这个节点标为「已验证」但还没有掌握证据。补一条独立复述、答题或实践结果，这个状态才站得住。
              </div>
            )}

            {/* 活的书：章节正文 + 圈选提问 + 四个方向的展开 */}
            <div className="mt-4">
              <LearningBookReader
                node={viewNode as any}
                mapId={activeMap!.id}
                mapTitle={activeMap!.title}
                nodePath={selectedPath.map(item => item.title).join(' > ')}
                prefetchCurrent={prefetch?.current || null}
                nodeDirectory={nodeDirectory}
                outlineTitles={outlineTitles}
                siblingTitles={activeMap!.nodes
                  .filter(item => item.parentId === viewNode.parentId && item.id !== viewNode.id)
                  .map(item => `- ${item.title}`)
                  .join('\n')}
                onChanged={() => refresh(activeMap!.id, viewNode.id)}
                notify={(type, text) => messageApi[type](text)}
                onNavigate={navigateToGuide}
              />
            </div>

            <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><CheckCircleOutlined className="text-emerald-500" />掌握证据</span>}>
              <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{viewNode.evidence || '记录一次独立复述、答题、代码实践或纠错结果。'}</p>
            </Card>
            <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><CompassOutlined className="text-amber-500" />下一步</span>}>
              <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{viewNode.nextStep || '下一次回来时从哪里继续，或需要补哪一个前置知识。'}</p>
            </Card>

            <div className="mt-5 border-t border-border-subtle/50 pt-4">
              <div className="text-[10px] font-semibold text-text-faint">更新学习状态</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LEARNING_STATUS_ORDER.map(status => (
                  <Button
                    key={status}
                    size="small"
                    type={viewNode.status === status ? 'primary' : 'default'}
                    onClick={() => quickUpdateStatus(status)}
                  >{LEARNING_STATUS_META[status].label}</Button>
                ))}
              </div>
            </div>
            {activeMap && viewNode.id !== activeMap.currentNodeId && (
              <Button block className="mt-4" icon={<AimOutlined />} onClick={() => markCurrent(viewNode.id)}>设为当前位置</Button>
            )}
          </div>
        )}
      </Modal>

      {/* 新建图谱 */}
      <Modal
        title="新建学习图谱"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={createMap}
        confirmLoading={saving}
        okText="创建图谱"
        okButtonProps={{ disabled: saving }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="title" label="学习主题" rules={[{ required: true, message: '请输入学习主题' }]}>
            <Input placeholder="例如：Java / React / 分布式系统" />
          </Form.Item>
          <Form.Item name="description" label="学习目标">
            <Input.TextArea rows={3} placeholder="这个图谱最终要达到什么水平" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑图谱信息 */}
      <Modal
        title="编辑图谱信息"
        open={Boolean(renameTarget)}
        onCancel={() => setRenameTarget(null)}
        onOk={renameMap}
        confirmLoading={saving}
        okText="保存"
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="title" label="学习主题" rules={[{ required: true, message: '请输入学习主题' }]}>
            <Input placeholder="例如：Java / React / 分布式系统" />
          </Form.Item>
          <Form.Item name="description" label="学习目标">
            <Input.TextArea rows={3} placeholder="这个图谱最终要达到什么水平" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 添加分支 */}
      <Modal
        title={selectedNode ? `在「${selectedNode.title}」下添加分支` : '添加分支'}
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={addNode}
        confirmLoading={saving}
        okText="添加分支"
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="title" label="知识点名称" rules={[{ required: true, message: '请输入知识点名称' }]}>
            <Input placeholder="例如：JMM 内存模型" onPressEnter={addNode} />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  )
}

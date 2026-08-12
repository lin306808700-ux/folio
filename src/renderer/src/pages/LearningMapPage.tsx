import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Card, Drawer, Empty, Form, Input, Modal, Segmented, Select, Spin, Steps, Tag, Tree, message,
} from 'antd'
import {
  AimOutlined, AppstoreOutlined, CheckCircleOutlined, CompassOutlined, EditOutlined, MessageOutlined,
  PartitionOutlined, PlusOutlined, SaveOutlined, SyncOutlined,
} from '@ant-design/icons'
import PageShell from '../components/PageShell'
import LearningMindMap from '../components/LearningMindMap'
import LearningBoard from '../components/LearningBoard'
import LearningBookReader from '../components/LearningBookReader'
import { isElectron } from '../utils/config'

type LearningStatus = 'unexplored' | 'learning' | 'understood' | 'verified'

interface LearningNode {
  id: string
  parentId: string | null
  title: string
  status: LearningStatus
  summary: string
  evidence: string
  nextStep: string
  content?: string
  qa?: Array<{ question: string; selection: string; answer: string; createdAt: string }>
  createdAt: string
  updatedAt: string
}

interface LearningMap {
  id: string
  title: string
  description: string
  builtIn?: boolean
  currentNodeId: string
  nodes: LearningNode[]
  createdAt: string
  updatedAt: string
}

const statusMeta: Record<LearningStatus, { label: string; color: string; tag: string }> = {
  unexplored: { label: '未开始', color: '#94a3b8', tag: 'default' },
  learning: { label: '学习中', color: '#0ea5e9', tag: 'processing' },
  understood: { label: '已理解', color: '#f59e0b', tag: 'warning' },
  verified: { label: '已验证', color: '#10b981', tag: 'success' },
}

function getPath(nodes: LearningNode[], nodeId: string): LearningNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const path: LearningNode[] = []
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
  node: LearningNode
  children?: TreeNodeData[]
}

function buildTree(nodes: LearningNode[]): TreeNodeData[] {
  const grouped = new Map<string | null, LearningNode[]>()
  nodes.forEach(node => grouped.set(node.parentId, [...(grouped.get(node.parentId) || []), node]))
  const toData = (parentId: string | null): TreeNodeData[] =>
    (grouped.get(parentId) || []).map(node => ({
      key: node.id,
      title: node.title,
      node,
      children: toData(node.id),
    }))
  return toData(null)
}

export default function LearningMapPage() {
  const navigate = useNavigate()
  const [messageApi, messageHolder] = message.useMessage()
  const [maps, setMaps] = useState<LearningMap[]>([])
  const [activeMapId, setActiveMapId] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [viewMode, setViewMode] = useState<'mindmap' | 'board'>('mindmap')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [prefetch, setPrefetch] = useState<{ active: boolean; current: { mapId: string; nodeId: string; title: string } | null; queueLeft: number; doneSession: number } | null>(null)
  const [createForm] = Form.useForm<{ title: string; description: string }>()
  const [addForm] = Form.useForm<{ title: string }>()
  const [nodeForm] = Form.useForm()

  const activeMap = maps.find(map => map.id === activeMapId) || maps[0] || null
  const selectedNode = activeMap?.nodes.find(node => node.id === selectedNodeId) || null
  const currentNode = activeMap?.nodes.find(node => node.id === activeMap.currentNodeId) || null
  const selectedPath = activeMap && selectedNode ? getPath(activeMap.nodes, selectedNode.id) : []
  const currentPath = activeMap && currentNode ? getPath(activeMap.nodes, currentNode.id) : []

  const treeData = useMemo(() => (activeMap ? buildTree(activeMap.nodes) : []), [activeMap])

  const loadMaps = async (preferredMapId?: string, preferredNodeId?: string) => {
    if (!isElectron) {
      setLoading(false)
      return
    }
    const result = await window.electronAPI.muse.learning.list()
    if (!result.success) throw new Error(result.error || '加载学习图谱失败')
    const nextMaps = result.data || []
    setMaps(nextMaps)
    const nextMap = nextMaps.find(map => map.id === (preferredMapId || activeMapId)) || nextMaps[0]
    setActiveMapId(nextMap?.id || '')
    setSelectedNodeId(preferredNodeId || nextMap?.currentNodeId || nextMap?.nodes[0]?.id || '')
  }

  useEffect(() => {
    loadMaps().catch(cause => messageApi.error(cause instanceof Error ? cause.message : '加载失败')).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const off = window.electronAPI.muse.learning.onPrefetchStatus(data => {
      setPrefetch({ active: data.active, current: data.current, queueLeft: data.queueLeft, doneSession: data.doneSession })
      if (data.lastDone && data.lastDone.nodeId === selectedNodeIdRef.current) {
        loadMaps(activeMapIdRef.current || undefined, selectedNodeIdRef.current).catch(() => {})
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打开节点详情抽屉时同步表单
  useEffect(() => {
    if (!drawerOpen || !selectedNode) return
    nodeForm.setFieldsValue({
      title: selectedNode.title,
      status: selectedNode.status,
      summary: selectedNode.summary || '',
      evidence: selectedNode.evidence || '',
      nextStep: selectedNode.nextStep || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, selectedNode?.id, selectedNode?.updatedAt])

  const openNode = (nodeId: string) => {
    setSelectedNodeId(nodeId)
    setDrawerOpen(true)
  }

  const quickUpdateStatus = async (status: LearningStatus) => {
    if (!activeMap || !selectedNode) return
    const result = await window.electronAPI.muse.learning.updateNode({ mapId: activeMap.id, nodeId: selectedNode.id, updates: { status } })
    if (!result.success) {
      messageApi.error(result.error || '更新失败')
      return
    }
    await loadMaps(activeMap.id, selectedNode.id)
    messageApi.success(`已标记为「${statusMeta[status].label}」`)
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
      await loadMaps(activeMap.id, result.data.id)
      messageApi.success('分支已添加')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '添加失败')
    } finally {
      setSaving(false)
    }
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
      await loadMaps(activeMap.id, selectedNode.id)
      messageApi.success('节点已保存')
    } catch (cause) {
      messageApi.error(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const markCurrent = async () => {
    if (!activeMap || !selectedNode) return
    const result = await window.electronAPI.muse.learning.setCurrent({ mapId: activeMap.id, nodeId: selectedNode.id })
    if (!result.success) {
      messageApi.error(result.error || '定位失败')
      return
    }
    await loadMaps(activeMap.id, selectedNode.id)
    messageApi.success('已设为当前位置')
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
    navigate('/chat')
  }

  const verifiedCount = activeMap?.nodes.filter(node => node.status === 'verified').length || 0
  const understoodCount = activeMap?.nodes.filter(node => node.status === 'understood' || node.status === 'verified').length || 0

  return (
    <PageShell
      title="学习图谱"
      description="保持知识主干、当前位置和掌握证据清晰可见"
      count={activeMap ? `${understoodCount}/${activeMap.nodes.length} 个节点已理解` : undefined}
      actions={(
        <div className="flex items-center gap-2">
          {prefetch && (prefetch.active || prefetch.queueLeft > 0) && (
            <span className="flex items-center gap-1 rounded-full border border-border-subtle/60 px-2 py-0.5 text-[10px] text-text-muted" title="后台正在逐章预制书页内容，打开节点即可读">
              <SyncOutlined spin={prefetch.active} className="text-sky-500" />
              {prefetch.active ? `正在预制「${prefetch.current?.title || ''}」` : '后台预制中'} · 剩 {prefetch.queueLeft} 章
            </span>
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
                setSelectedNodeId(map?.currentNodeId || map?.nodes[0]?.id || '')
              }}
            />
          )}
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建图谱</Button>
        </div>
      )}
      contentClassName="overflow-hidden p-0"
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
        <div className="grid h-full min-h-0 grid-cols-[260px_minmax(360px,1fr)_300px]">
          {/* 知识树 */}
          <aside className="min-h-0 overflow-y-auto border-r border-border-subtle/60 px-3 py-4 scroll-container">
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <div className="text-xs font-semibold text-text-primary">{activeMap.title}</div>
                <div className="mt-0.5 text-[10px] text-text-faint">{activeMap.nodes.length} 个知识节点 · 已验证 {verifiedCount}</div>
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
                const meta = statusMeta[item.node.status]
                return (
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
                    {item.node.id === activeMap.currentNodeId && <AimOutlined className="shrink-0 text-sky-500" />}
                  </span>
                )
              }}
            />
          </aside>

          {/* 思维导图 / 进度看板 */}
          <main className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-border-subtle/50 px-5 py-2.5">
              <Segmented
                size="small"
                value={viewMode}
                onChange={value => setViewMode(value as 'mindmap' | 'board')}
                options={[
                  { value: 'mindmap', label: <span className="flex items-center gap-1"><PartitionOutlined />知识结构</span> },
                  { value: 'board', label: <span className="flex items-center gap-1"><AppstoreOutlined />进度看板</span> },
                ]}
              />
            </div>
            {viewMode === 'mindmap' ? (
              <div className="min-h-0 flex-1">
                <LearningMindMap
                  nodes={activeMap.nodes}
                  currentNodeId={activeMap.currentNodeId}
                  selectedNodeId={selectedNode?.id}
                  onNodeClick={openNode}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                <LearningBoard
                  nodes={activeMap.nodes}
                  currentNodeId={activeMap.currentNodeId}
                  onNodeClick={openNode}
                />
              </div>
            )}
          </main>

          {/* 学习罗盘 */}
          <aside className="min-h-0 overflow-y-auto border-l border-border-subtle/60 px-4 py-6 scroll-container">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary"><CompassOutlined className="text-amber-500" />学习罗盘</div>
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
                {Object.entries(statusMeta).map(([key, meta]) => <Tag key={key} color={meta.tag}>{meta.label}</Tag>)}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* 节点详情抽屉：阅读模式主打「看书学」，编辑模式维护内容 */}
      <Drawer
        title={selectedNode ? selectedNode.title : '节点详情'}
        width={560}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditMode(false) }}
        footer={editMode ? (
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditMode(false)}>取消</Button>
            <Button type="primary" loading={saving} icon={<SaveOutlined />} onClick={saveNode}>保存节点</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button icon={<EditOutlined />} onClick={() => setEditMode(true)}>编辑</Button>
            <Button type="primary" icon={<MessageOutlined />} onClick={continueInChat}>围绕此节点继续对话</Button>
          </div>
        )}
      >
        {selectedNode && (editMode ? (
          <>
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
                <Select options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
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
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag color={statusMeta[selectedNode.status].tag}>{statusMeta[selectedNode.status].label}</Tag>
              {selectedNode.id === activeMap?.currentNodeId && <Tag icon={<AimOutlined />} color="blue">当前位置</Tag>}
              {activeMap?.builtIn && <Tag color="purple">内置知识</Tag>}
            </div>
            <div className="mt-2 text-[11px] text-text-faint">{selectedPath.map(node => node.title).join(' / ')}</div>

            {/* 活的书：章节正文 + 圈选提问 + 下钻衍生 */}
            <div className="mt-4">
              <LearningBookReader
                node={selectedNode as any}
                mapId={activeMap!.id}
                mapTitle={activeMap!.title}
                nodePath={selectedPath.map(item => item.title).join(' > ')}
                prefetchCurrent={prefetch?.current || null}
                onChanged={() => loadMaps(activeMap!.id, selectedNode.id)}
                notify={(type, text) => messageApi[type](text)}
              />
            </div>

            <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><CheckCircleOutlined className="text-emerald-500" />掌握证据</span>}>
              <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{selectedNode.evidence || '记录一次独立复述、答题、代码实践或纠错结果。'}</p>
            </Card>
            <Card size="small" className="mt-3 bg-transparent" title={<span className="flex items-center gap-2 text-xs"><CompassOutlined className="text-amber-500" />推荐资料与下一步</span>}>
              <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">{selectedNode.nextStep || '下一次回来时从哪里继续，或需要补哪一个前置知识。'}</p>
            </Card>

            <div className="mt-5 border-t border-border-subtle/50 pt-4">
              <div className="text-[10px] font-semibold text-text-faint">更新学习状态</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(statusMeta).map(([key, meta]) => (
                  <Button
                    key={key}
                    size="small"
                    type={selectedNode.status === key ? 'primary' : 'default'}
                    onClick={() => quickUpdateStatus(key as LearningStatus)}
                  >{meta.label}</Button>
                ))}
              </div>
            </div>
            {activeMap && selectedNode.id !== activeMap.currentNodeId && (
              <Button block className="mt-4" icon={<AimOutlined />} onClick={markCurrent}>设为当前位置</Button>
            )}
          </>
        ))}
      </Drawer>

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
        <Form form={createForm} layout="vertical" initialValues={{ title: 'Java', description: '体系化掌握 Java 核心知识与实践能力' }}>
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

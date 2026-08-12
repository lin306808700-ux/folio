import { useState, useCallback, useMemo, useEffect, useRef } from 'react'

// ========== 类型定义 ==========

export interface TriggerItem {
  id: string
  label: string
  sublabel?: string
  icon: string           // lucide icon name: 'Folder', 'File', 'Zap', 'Shield', etc.
  insertText: string     // 选中后替换触发词+过滤文本的内容
  group?: string         // 分组标题（用于 TriggerPopup 分组显示）
  data?: any
}

export type TriggerType = '@' | '#' | '/'

interface TriggerState {
  trigger: TriggerType
  filter: string         // 触发词后面的过滤文本
  items: TriggerItem[]
  selectedIndex: number
  isOpen: boolean
}

// ========== 图标名（在 TriggerPopup 中映射到 lucide 组件） ==========
export const TRIGGER_ICONS: Record<TriggerType, string> = {
  '@': 'FolderOpen',
  '#': 'Palette',
  '/': 'Zap',
}

// ========== 从输入框和光标位置检测触发器 ==========
export function detectTrigger(input: string, cursorPos: number): { trigger: TriggerType; filter: string; startPos: number } | null {
  const textBefore = input.slice(0, cursorPos)

  // 从光标位置往回找，匹配 (@|#|/)后跟非空白字符
  const match = textBefore.match(/(?:^|[\s\n])([@#\/])(\S*)$/)
  if (!match) return null

  const trigger = match[1] as TriggerType
  const filter = match[2]
  // startPos: 触发字符在 input 中的位置
  const startPos = match.index! + match[0].indexOf(trigger)

  return { trigger, filter, startPos }
}

// ========== 模糊匹配评分 ==========
function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // 完全匹配最高分
  if (lowerText === lowerQuery) return 100
  // 以 query 开头
  if (lowerText.startsWith(lowerQuery)) return 80
  // 包含 query
  if (lowerText.includes(lowerQuery)) return 60

  // 逐字符模糊匹配（按顺序出现）
  let qi = 0
  let score = 0
  for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[qi]) {
      score += 10
      qi++
      // 连续匹配加分
      if (i > 0 && lowerText[i - 1] === lowerQuery[qi - 1]) {
        score += 5
      }
    }
  }
  return qi === lowerQuery.length ? score : 0
}

// ========== Hook ==========
export function useTriggerSearch(isElectron: boolean) {
  const [state, setState] = useState<TriggerState>({
    trigger: '/',
    filter: '',
    items: [],
    selectedIndex: 0,
    isOpen: false,
  })

  // 缓存数据
  const workspaceFilesRef = useRef<TriggerItem[]>([])
  const artifactsRef = useRef<TriggerItem[]>([])
  const loadedRef = useRef({ workspace: false, artifacts: false })

  // ========== 加载工作区文件（@ 触发）— 每次实时读取终端当前 cwd，不缓存 ==========
  const loadWorkspaceFiles = useCallback(async () => {
    // cwd 随时可能因 `cd` 改变，不标记 loaded，让每次触发都重新请求
    if (!isElectron) return

    try {
      const api = (window as any).electronAPI
      const result = await api?.terminal?.listCwdFiles?.()
      if (result?.success && result.files) {
        workspaceFilesRef.current = result.files.map((f: any) => ({
          id: `cwd_${f.path}`,
          label: f.name,
          sublabel: result.cwd || '',
          icon: f.isDirectory ? 'FolderOpen' : detectFileIcon(f.ext || ''),
          insertText: f.name,
          data: f,
        }))
      }
    } catch (e) {
      console.warn('[TriggerSearch] 加载终端 cwd 文件失败:', e)
    }
  }, [isElectron])

  // ========== 加载创作空间产物（# 触发） ==========
  const loadArtifacts = useCallback(async () => {
    if (!isElectron) return
    try {
      const api = (window as any).electronAPI
      const [storeResult, wsResult] = await Promise.all([
        api?.artifacts?.getRecent(100).catch(() => []),
        api?.muse?.getWorkspaceFiles().catch(() => null),
      ])

      const storeItems: TriggerItem[] = (storeResult || []).map((a: any) => ({
        id: `art_${a.id}`,
        label: a.filePath.split('/').pop() || a.filePath,
        sublabel: a.description || a.command || a.filePath,
        icon: detectArtifactIcon(a.type || detectTypeFromExt(a.filePath)),
        insertText: a.filePath,
        data: a,
      }))

      const storePathSet = new Set((storeResult || []).map((a: any) => a.filePath))
      const wsItems: TriggerItem[] = []
      if (wsResult?.success && wsResult.files) {
        for (const f of wsResult.files) {
          if (!storePathSet.has(f.path)) {
            wsItems.push({
              id: `wsart_${f.path}`,
              label: f.name || f.path.split('/').pop(),
              sublabel: f.path,
              icon: f.isDirectory ? 'Folder' : 'File',
              insertText: f.path,
              data: f,
            })
          }
        }
      }

      artifactsRef.current = [...storeItems, ...wsItems]
      loadedRef.current.artifacts = true
    } catch (e) {
      console.error('[TriggerSearch] 加载创作空间失败:', e)
    }
  }, [isElectron])

  // ========== 加载模板列表（@ 触发时混入） ==========
  const templatesRef = useRef<TriggerItem[]>([])
  const loadTemplates = useCallback(async () => {
    if (!isElectron) return
    try {
      const api = (window as any).electronAPI
      const result = await api?.db?.promptTemplates?.list?.()
      if (result && Array.isArray(result)) {
        templatesRef.current = result.map((t: any) => ({
          id: `tpl_${t.name}`,
          label: t.name,
          sublabel: t.description || `${t.category} 模板`,
          icon: 'Palette',
          insertText: `@template:${t.name} `,
          group: '场景模板',
          data: t,
        }))
      }
    } catch (e) {
      console.warn('[TriggerSearch] 加载模板失败:', e)
    }
  }, [isElectron])

  // ========== 斜杠命令（静态） ==========
  const slashCommands: TriggerItem[] = useMemo(() => [
    // 系统命令
    { id: 'cmd_selfcheck', label: '/self-check', sublabel: '运行系统自检（全部场景）', icon: 'Shield', insertText: '/self-check', group: '系统' },
    { id: 'cmd_selfcheck_task', label: '/self-check 任务编排执行', sublabel: '自检：任务编排执行分组', icon: 'Shield', insertText: '/self-check 任务编排执行', group: '系统' },
    { id: 'cmd_selfcheck_mem', label: '/self-check 记忆与系统集成', sublabel: '自检：记忆与系统集成分组', icon: 'Shield', insertText: '/self-check 记忆与系统集成', group: '系统' },
    { id: 'cmd_clear', label: '/clear', sublabel: '清空当前对话', icon: 'Trash2', insertText: '/clear', group: '会话' },
    { id: 'cmd_reset', label: '/reset', sublabel: '重置会话（新 sessionId）', icon: 'RefreshCw', insertText: '/reset', group: '会话' },
    // 模板与质量命令
    { id: 'cmd_templates', label: '/templates', sublabel: '查看所有场景模板', icon: 'Palette', insertText: '列出所有已安装的场景模板（prompt-templates），包括名称、分类和触发词', group: '模板 & 质量' },
    { id: 'cmd_craft', label: '/craft', sublabel: '查看质量检查规则', icon: 'Shield', insertText: '列出所有已安装的 craft 质量检查规则，包括名称、分类和严重级别', group: '模板 & 质量' },
    { id: 'cmd_context', label: '/context', sublabel: '查看当前注入的上下文', icon: 'FileText', insertText: '当前对话中注入了哪些上下文片段？包括模板、craft 规则、pipeline 阶段', group: '模板 & 质量' },
  ], [])

  // ========== 打开菜单 ==========
  const openMenu = useCallback(async (trigger: TriggerType, filter: string) => {
    // 按需懒加载数据
    if (trigger === '@') {
      // @ 每次都重新加载 cwd 文件；模板只加载一次
      await loadWorkspaceFiles()
      await loadTemplates()
    } else if (trigger === '#' && !loadedRef.current.artifacts) {
      await loadArtifacts()
    }

    let items: TriggerItem[] = []
    if (trigger === '@') {
      // @ 混合两个数据源：工作区文件 + 模板
      const fileItems = workspaceFilesRef.current.map(item => ({ ...item, group: item.group || '工作区文件' }))
      items = [...fileItems, ...templatesRef.current]
    } else if (trigger === '#') {
      items = artifactsRef.current
    } else if (trigger === '/') {
      items = [...slashCommands]
    }

    // 模糊匹配过滤 + 排序
    const lowerFilter = filter.toLowerCase()
    let filtered = items
    if (lowerFilter) {
      filtered = items
        .map(item => ({ item, score: Math.max(fuzzyScore(item.label, lowerFilter), fuzzyScore(item.sublabel || '', lowerFilter)) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map(({ item }) => item)
    }

    setState({
      trigger,
      filter,
      items: filtered,
      selectedIndex: 0,
      isOpen: true,
    })
  }, [loadWorkspaceFiles, loadArtifacts, slashCommands])

  // ========== 关闭菜单 ==========
  const closeMenu = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false, filter: '', items: [], selectedIndex: 0 }))
  }, [])

  // ========== 键盘处理 ==========
  const handleKeyDown = useCallback((e: React.KeyboardEvent): { consumed: boolean; selectCurrent?: boolean } => {
    if (!state.isOpen || state.items.length === 0) return { consumed: false }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        setState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex <= 0 ? prev.items.length - 1 : prev.selectedIndex - 1,
        }))
        return { consumed: true }

      case 'ArrowDown':
        e.preventDefault()
        setState(prev => ({
          ...prev,
          selectedIndex: prev.selectedIndex >= prev.items.length - 1 ? 0 : prev.selectedIndex + 1,
        }))
        return { consumed: true }

      case 'Enter':
        e.preventDefault()
        return { consumed: true, selectCurrent: true }

      case 'Escape':
        e.preventDefault()
        closeMenu()
        return { consumed: true }

      default:
        return { consumed: false }
    }
  }, [state.isOpen, state.items.length, closeMenu])

  // ========== 获取当前选中项 ==========
  const getSelectedItem = useCallback((): TriggerItem | null => {
    if (!state.isOpen || state.items.length === 0) return null
    return state.items[state.selectedIndex] || null
  }, [state.isOpen, state.items, state.selectedIndex])

  // ========== 获取触发词在 input 中的起始位置（用于替换） ==========
  const getTriggerRange = useCallback((input: string, cursorPos: number): { start: number; end: number } | null => {
    const detected = detectTrigger(input, cursorPos)
    if (!detected) return null
    return { start: detected.startPos, end: cursorPos }
  }, [])

  return {
    // 状态
    trigger: state.trigger,
    filter: state.filter,
    items: state.items,
    selectedIndex: state.selectedIndex,
    isOpen: state.isOpen,

    // 方法
    openMenu,
    closeMenu,
    handleKeyDown,
    getSelectedItem,
    getTriggerRange,
    setSelectedIndex: (index: number) => setState(prev => ({ ...prev, selectedIndex: index })),

    // 数据刷新
    refreshWorkspace: loadWorkspaceFiles,
    refreshArtifacts: loadArtifacts,
    // 工作区切换时调用，清空缓存强制下次重新加载
    resetWorkspaceCache: () => {
      workspaceFilesRef.current = []
      loadedRef.current.workspace = false
    },
  }
}

// ========== 工具函数 ==========

// 根据文件扩展名返回 lucide 图标名
function detectFileIcon(ext: string): string {
  const codeExts = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.php', '.swift', '.kt'])
  const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'])
  const docExts = new Set(['.md', '.txt', '.pdf', '.docx', '.doc', '.pptx', '.xlsx', '.csv'])
  const configExts = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.xml'])
  const shellExts = new Set(['.sh', '.bash', '.zsh', '.fish'])
  const htmlExts = new Set(['.html', '.htm'])

  if (htmlExts.has(ext)) return 'FileText'
  if (codeExts.has(ext)) return 'Code'
  if (imageExts.has(ext)) return 'Image'
  if (docExts.has(ext)) return 'FileText'
  if (configExts.has(ext)) return 'FileText'
  if (shellExts.has(ext)) return 'Code'
  return 'File'
}

function detectTypeFromExt(filePath: string): string {
  const ext = (filePath || '').split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    html: 'html', htm: 'html', js: 'script', ts: 'script', py: 'script', sh: 'script',
    png: 'image', jpg: 'image', jpeg: 'image', svg: 'image', gif: 'image', webp: 'image',
    pdf: 'document', md: 'document', txt: 'document', pptx: 'document', docx: 'document',
  }
  return map[ext] || 'other'
}

function detectArtifactIcon(type: string): string {
  const iconMap: Record<string, string> = {
    html: 'FileText',
    script: 'Code',
    image: 'Image',
    document: 'FileText',
  }
  return iconMap[type] || 'File'
}

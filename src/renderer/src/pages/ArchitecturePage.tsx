import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  FileCode2,
  GitBranch,
  GitCommit,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TestTube2,
} from 'lucide-react'
import PageShell from '../components/PageShell'

type ChangeState = 'changed' | 'affected'
type TestStatus = 'changed' | 'existing' | 'missing' | 'not-applicable'

interface ChangedFile {
  path: string
  status: string
  untracked: boolean
  added: number
  deleted: number
  tests: string[]
  testStatus: TestStatus
}

interface ArchitectureModule {
  id: string
  label: string
  state: ChangeState
  testStatus: TestStatus
  evidence: Array<{ kind: 'static'; text: string }>
  files: ChangedFile[]
}

interface ArchitectureAnalysis {
  repository: { path: string; name: string; branch: string; head: string }
  changeset: { mode: 'working-tree' | 'latest-commit'; label: string; subject?: string }
  summary: { changedFiles: number; changedModules: number; affectedModules: number; untestedFiles: number }
  modules: ArchitectureModule[]
  edges: Array<{ from: string; to: string; label: string; evidence: string; kind: 'static' }>
}

interface CanvasNode {
  id: string
  label: string
  subtitle: string
  state: ChangeState
  testStatus: TestStatus
  x: number
  y: number
  width: number
}

const stateMeta: Record<ChangeState, { label: string; color: string; fill: string }> = {
  changed: { label: '直接修改', color: '#ef4444', fill: 'rgba(239,68,68,.09)' },
  affected: { label: '依赖影响', color: '#f59e0b', fill: 'rgba(245,158,11,.07)' },
}

const testMeta: Record<TestStatus, { label: string; color: string }> = {
  changed: { label: '测试同步修改', color: 'text-emerald-500' },
  existing: { label: '存在测试，尚未同步修改', color: 'text-amber-500' },
  missing: { label: '未发现相关测试', color: 'text-red-500' },
  'not-applicable': { label: '无需代码测试', color: 'text-text-faint' },
}

function layoutNodes(modules: ArchitectureModule[]): CanvasNode[] {
  const columns = modules.length <= 4 ? Math.max(modules.length, 1) : 4
  const width = 174
  const gapX = columns === 1 ? 0 : Math.min(72, (820 - columns * width) / (columns - 1))
  const totalWidth = columns * width + Math.max(0, columns - 1) * gapX
  const startX = (900 - totalWidth) / 2

  return modules.map((module, index) => ({
    id: module.id,
    label: module.label,
    subtitle: module.files.length > 0 ? `${module.files.length} 个变更文件` : '由依赖关系触达',
    state: module.state,
    testStatus: module.testStatus,
    x: startX + (index % columns) * (width + gapX),
    y: modules.length <= 4 ? 150 : 86 + Math.floor(index / columns) * 190,
    width,
  }))
}

function ModuleGraph({ analysis, selectedId, onSelect }: { analysis: ArchitectureAnalysis; selectedId: string; onSelect: (id: string) => void }) {
  const nodes = useMemo(() => layoutNodes(analysis.modules), [analysis.modules])
  const nodeMap = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])

  return (
    <svg viewBox="0 0 900 450" className="h-full w-full" role="img" aria-label="当前 Git 变更的模块影响图">
      <defs>
        <marker id="architecture-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#64748b" />
        </marker>
      </defs>

      {analysis.edges.map(edge => {
        const from = nodeMap.get(edge.from)
        const to = nodeMap.get(edge.to)
        if (!from || !to) return null
        const startX = from.x + from.width / 2
        const startY = from.y + 48
        const endX = to.x + to.width / 2
        const endY = to.y + 48
        const curve = Math.max(38, Math.abs(endX - startX) * .3)
        const direction = endX >= startX ? 1 : -1
        const path = `M ${startX} ${startY} C ${startX + curve * direction} ${startY}, ${endX - curve * direction} ${endY}, ${endX} ${endY}`
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <path d={path} fill="none" stroke="#64748b" strokeOpacity=".68" strokeWidth="1.4" markerEnd="url(#architecture-arrow)" />
            <text x={(startX + endX) / 2} y={(startY + endY) / 2 - 8} textAnchor="middle" fill="#64748b" fontSize="9">{edge.label}</text>
          </g>
        )
      })}

      {nodes.map(node => {
        const state = stateMeta[node.state]
        const selected = node.id === selectedId
        const testColor = node.testStatus === 'changed' ? '#10b981' : node.testStatus === 'existing' ? '#f59e0b' : node.testStatus === 'missing' ? '#ef4444' : '#64748b'
        return (
          <g key={node.id} onClick={() => onSelect(node.id)} className="cursor-pointer">
            {selected && <rect x={node.x - 5} y={node.y - 5} width={node.width + 10} height="106" rx="8" fill="none" stroke={state.color} strokeOpacity=".25" strokeWidth="5" />}
            <rect x={node.x} y={node.y} width={node.width} height="96" rx="6" fill="rgb(var(--color-bg-inset))" stroke={selected ? state.color : 'rgb(var(--color-border-strong))'} strokeOpacity={selected ? 1 : .55} strokeWidth={selected ? 1.8 : 1} />
            <rect x={node.x} y={node.y} width="5" height="96" rx="3" fill={state.color} />
            <circle cx={node.x + 20} cy={node.y + 19} r="4" fill={state.color} />
            <text x={node.x + 31} y={node.y + 23} fill="rgb(var(--color-text-primary))" fontSize="12" fontWeight="600">{node.label}</text>
            <text x={node.x + 20} y={node.y + 47} fill="rgb(var(--color-text-muted))" fontSize="9.5">{node.subtitle}</text>
            <line x1={node.x + 20} y1={node.y + 60} x2={node.x + node.width - 18} y2={node.y + 60} stroke="rgb(var(--color-border-subtle))" strokeOpacity=".55" />
            <circle cx={node.x + 21} cy={node.y + 78} r="3" fill={testColor} />
            <text x={node.x + 31} y={node.y + 81} fill="rgb(var(--color-text-faint))" fontSize="9">{testMeta[node.testStatus].label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function FileGraph({ module, selectedPath, onSelect }: { module: ArchitectureModule; selectedPath: string; onSelect: (path: string) => void }) {
  if (module.files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div><ShieldCheck size={30} className="mx-auto text-amber-500" /><p className="mt-3 text-sm text-text-primary">该模块没有直接文件变更</p><p className="mt-1 text-xs text-text-muted">它因为确定的跨模块依赖被纳入影响范围。</p></div>
      </div>
    )
  }

  return (
    <div className="grid h-full content-center grid-cols-2 gap-3 overflow-y-auto p-8 scroll-container">
      {module.files.map(file => {
        const selected = selectedPath === file.path
        return (
          <button key={file.path} onClick={() => onSelect(file.path)} className={`min-w-0 rounded-md border p-4 text-left transition-colors ${selected ? 'border-red-500/70 bg-red-500/[0.055]' : 'border-border-subtle/60 bg-inset/80 hover:border-border-strong'}`}>
            <div className="flex items-start gap-3"><FileCode2 size={15} className="mt-0.5 shrink-0 text-text-faint" /><div className="min-w-0 flex-1"><div className="break-all text-xs font-medium text-text-primary">{file.path}</div><div className="mt-2 flex items-center gap-3 text-[10px] text-text-faint"><span className="text-emerald-500">+{file.added}</span><span className="text-red-500">-{file.deleted}</span><span>{file.untracked ? '未跟踪' : file.status}</span></div><div className={`mt-2 text-[10px] ${testMeta[file.testStatus].color}`}>{testMeta[file.testStatus].label}</div></div></div>
          </button>
        )
      })}
    </div>
  )
}

function ArchitecturePage() {
  const [analysis, setAnalysis] = useState<ArchitectureAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [depth, setDepth] = useState<'module' | 'file'>('module')
  const [search, setSearch] = useState('')
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState(false)

  const loadAnalysis = useCallback(async () => {
    setLoading(true)
    setError('')
    setInstruction('')
    try {
      const result = await window.electronAPI?.workspace?.analyzeArchitecture?.()
      if (!result?.success || !result.data) throw new Error(result?.error || '无法读取当前工作区')
      setAnalysis(result.data)
      setSelectedModuleId(current => result.data!.modules.some(module => module.id === current) ? current : result.data!.modules[0]?.id || '')
      setSelectedFilePath('')
      setDepth('module')
    } catch (cause) {
      setAnalysis(null)
      setError(cause instanceof Error ? cause.message : '分析失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAnalysis() }, [loadAnalysis])
  useEffect(() => window.electronAPI?.workspace?.onChanged?.(() => loadAnalysis()), [loadAnalysis])

  const selectedModule = analysis?.modules.find(module => module.id === selectedModuleId) || analysis?.modules[0]
  const selectedFile = selectedModule?.files.find(file => file.path === selectedFilePath) || selectedModule?.files[0]
  const filteredModules = analysis?.modules.filter(module => `${module.label} ${module.files.map(file => file.path).join(' ')}`.toLowerCase().includes(search.toLowerCase())) || []

  const selectModule = (id: string) => {
    setSelectedModuleId(id)
    setSelectedFilePath('')
    setInstruction('')
  }

  const openFiles = () => {
    if (!selectedModule || selectedModule.files.length === 0) return
    setSelectedFilePath(selectedModule.files[0].path)
    setDepth('file')
    setInstruction('')
  }

  const makeInstruction = () => {
    if (!selectedModule) return
    const missingFiles = depth === 'file' && selectedFile
      ? selectedFile.testStatus === 'missing' ? [selectedFile.path] : []
      : selectedModule.files.filter(file => file.testStatus === 'missing').map(file => file.path)
    const existingTests = depth === 'file' && selectedFile ? selectedFile.tests : selectedModule.files.flatMap(file => file.tests)
    const target = depth === 'file' && selectedFile ? selectedFile.path : selectedModule.label
    const lines = [`检查 ${target} 的本次 Git 变更并补齐回归验证。`]
    if (missingFiles.length > 0) lines.push(`未发现相关测试的文件：\n${missingFiles.map(file => `- ${file}`).join('\n')}`)
    if (existingTests.length > 0) lines.push(`已有但本次未同步修改的测试：\n${[...new Set(existingTests)].map(file => `- ${file}`).join('\n')}`)
    lines.push('先确认实际行为变化和跨模块影响，再添加最小必要测试；运行相关测试并报告仍缺少证据的链路。')
    setInstruction(lines.join('\n\n'))
  }

  const copyInstruction = async () => {
    if (!instruction) return
    try {
      await navigator.clipboard.writeText(instruction)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const currentTestStatus = depth === 'file' && selectedFile ? selectedFile.testStatus : selectedModule?.testStatus

  return (
    <PageShell
      title="系统图谱"
      description="用真实 Git 变更与确定依赖审查 AI 修改的影响范围"
      count={analysis ? `${analysis.repository.name} · ${analysis.repository.branch}` : undefined}
      contentClassName="!overflow-hidden !p-0"
      actions={<button onClick={loadAnalysis} disabled={loading} title="重新分析当前工作区" className="flex h-8 items-center gap-2 rounded-md border border-border-subtle/70 px-3 text-xs text-text-muted transition-colors hover:bg-surface/[0.08] hover:text-text-primary disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />重新分析</button>}
      toolbar={analysis && <div className="flex w-full items-center justify-between gap-4 text-[11px] text-text-muted"><div className="flex items-center gap-4"><span className="flex items-center gap-1.5"><GitCommit size={13} />{analysis.changeset.label}</span>{analysis.changeset.subject && <span className="max-w-52 truncate text-text-primary">{analysis.changeset.subject}</span>}<span>{analysis.summary.changedFiles} 个变更文件</span><span>{analysis.summary.changedModules} 个直接模块</span><span>{analysis.summary.affectedModules} 个依赖模块</span></div>{analysis.summary.untestedFiles > 0 && <span className="flex items-center gap-1.5 text-amber-500"><AlertTriangle size={13} />{analysis.summary.untestedFiles} 个文件未发现相关测试</span>}</div>}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-text-muted"><Loader2 size={20} className="mr-2 animate-spin" />正在读取 Git 变更</div>
      ) : error ? (
        <div className="flex h-full items-center justify-center px-6 text-center"><div><AlertTriangle size={30} className="mx-auto text-amber-500" /><p className="mt-3 text-sm text-text-primary">无法生成系统图谱</p><p className="mt-1 text-xs text-text-muted">{error}</p></div></div>
      ) : !analysis || analysis.modules.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center"><div><Check size={30} className="mx-auto text-emerald-500" /><p className="mt-3 text-sm text-text-primary">当前变更集没有可分析文件</p><p className="mt-1 text-xs text-text-muted">产生一次真实代码变更后重新分析。</p></div></div>
      ) : (
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(460px,1fr)_300px] bg-base/40">
          <aside className="flex min-h-0 flex-col border-r border-border-subtle/60 bg-surface/[0.025]">
            <div className="border-b border-border-subtle/50 p-3"><div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-text-faint" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="查找模块或变更文件" className="h-8 w-full rounded-md border border-border-subtle/60 bg-inset/60 pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-border-strong" /></div></div>
            <div className="flex-1 overflow-y-auto p-2 scroll-container">
              <div className="mb-2 flex items-center gap-1 px-2 text-[10px] font-semibold uppercase text-text-faint"><Layers size={11} />影响范围</div>
              {filteredModules.map(module => <button key={module.id} onClick={() => { selectModule(module.id); setDepth('module') }} className={`mb-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors ${selectedModule?.id === module.id ? 'bg-text-primary/[0.09]' : 'hover:bg-text-primary/[0.05]'}`}><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: stateMeta[module.state].color }} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-text-primary">{module.label}</span><span className="mt-0.5 block truncate text-[10px] text-text-faint">{module.files.length ? `${module.files.length} 个变更文件` : '依赖影响'}</span></span></button>)}
            </div>
            <div className="border-t border-border-subtle/50 p-3 text-[10px] text-text-faint"><div className="flex items-center gap-1.5"><GitBranch size={12} />{analysis.repository.path}</div></div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col">
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle/50 px-4"><div className="flex items-center gap-1 text-[11px] text-text-muted"><button onClick={() => setDepth('module')} className="hover:text-text-primary">{analysis.repository.name}</button>{depth === 'file' && <><ChevronRight size={12} /><span className="text-text-primary">{selectedModule?.label}</span></>}</div>{depth === 'file' && <button onClick={() => setDepth('module')} className="flex items-center gap-1.5 text-[10px] text-text-muted hover:text-text-primary"><ArrowLeft size={12} />返回模块</button>}</div>
            <div className="relative min-h-0 flex-1 overflow-hidden bg-[linear-gradient(rgb(var(--color-border-subtle)/.16)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--color-border-subtle)/.16)_1px,transparent_1px)] bg-[size:24px_24px]">{depth === 'module' ? <ModuleGraph analysis={analysis} selectedId={selectedModule?.id || ''} onSelect={selectModule} /> : selectedModule && <FileGraph module={selectedModule} selectedPath={selectedFile?.path || ''} onSelect={path => { setSelectedFilePath(path); setInstruction('') }} />}<div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md border border-border-subtle/60 bg-inset/90 px-3 py-2 text-[9px] text-text-muted shadow-sm">{(Object.keys(stateMeta) as ChangeState[]).map(key => <span key={key} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: stateMeta[key].color }} />{stateMeta[key].label}</span>)}</div></div>
          </main>

          <aside className="flex min-h-0 flex-col border-l border-border-subtle/60 bg-inset/45">
            <div className="border-b border-border-subtle/60 p-4"><div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-text-faint"><CircleDot size={12} />当前选择</span>{selectedModule && <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ color: stateMeta[selectedModule.state].color, background: stateMeta[selectedModule.state].fill }}>{stateMeta[selectedModule.state].label}</span>}</div><h2 className="break-words text-sm font-semibold text-text-primary">{depth === 'file' ? selectedFile?.path : selectedModule?.label}</h2>{depth === 'module' && selectedModule && selectedModule.files.length > 0 && <button onClick={openFiles} className="mt-3 flex w-full items-center justify-between rounded-md border border-border-subtle/60 px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface/[0.06] hover:text-text-primary"><span className="flex items-center gap-2"><FileCode2 size={14} />查看真实变更文件</span><ChevronRight size={14} /></button>}</div>
            <div className="flex-1 overflow-y-auto p-4 scroll-container">
              <section><h3 className="mb-2 text-[10px] font-semibold uppercase text-text-faint">影响证据</h3><div className="space-y-2">{depth === 'module' ? selectedModule?.evidence.map((item, index) => <div key={index} className="rounded-md border border-border-subtle/50 bg-surface/[0.035] p-2.5"><div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold text-cyan-500"><ShieldCheck size={11} />静态事实</div><p className="text-[11px] leading-4 text-text-muted">{item.text}</p></div>) : selectedFile && <div className="rounded-md border border-border-subtle/50 bg-surface/[0.035] p-2.5 text-[11px] leading-5 text-text-muted"><div><span className="text-emerald-500">+{selectedFile.added}</span><span className="ml-3 text-red-500">-{selectedFile.deleted}</span></div><div className="mt-1">Git 状态：{selectedFile.untracked ? '未跟踪文件' : selectedFile.status}</div></div>}</div></section>
              {currentTestStatus && <section className="mt-5"><h3 className="mb-2 text-[10px] font-semibold uppercase text-text-faint">测试证据</h3><div className={`rounded-md border border-border-subtle/50 bg-surface/[0.035] p-2.5 text-[11px] ${testMeta[currentTestStatus].color}`}>{testMeta[currentTestStatus].label}</div>{depth === 'file' && selectedFile && selectedFile.tests.length > 0 && <div className="mt-2 space-y-1">{selectedFile.tests.map(test => <div key={test} className="break-all text-[10px] text-text-faint">{test}</div>)}</div>}</section>}
              {instruction && <section className="mt-4 rounded-md border border-cyan-500/20 bg-cyan-500/[0.045] p-3"><div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-cyan-600 dark:text-cyan-400"><span>建议交给执行 Agent</span><button onClick={copyInstruction} title="复制指令" className="rounded p-1 hover:bg-cyan-500/10">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div><pre className="whitespace-pre-wrap font-sans text-[10px] leading-4 text-text-muted">{instruction}</pre></section>}
            </div>
            <div className="border-t border-border-subtle/60 p-3"><button onClick={makeInstruction} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-text-primary text-xs font-semibold text-base transition-opacity hover:opacity-90"><TestTube2 size={14} />生成验证任务</button></div>
          </aside>
        </div>
      )}
    </PageShell>
  )
}

export default ArchitecturePage

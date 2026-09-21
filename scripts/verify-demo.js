// 端到端验证：把内置示例注入到临时 store，检查正文完整性、进度指标与悬空边
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createLearningMapStore, computeProgress } = require('../src/main/muse/learning-maps')
const { BUILTIN_MAPS } = require('../src/main/muse/learning-seeds')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'))
const store = createLearningMapStore(path.join(dir, 'learning-maps.json'))
store.seedBuiltinMaps(BUILTIN_MAPS, [])

const map = store.list()[0]
const meta = store.listMeta()[0]
const nodes = map.nodes

console.log('=== 正文完整性 ===')
const missing = nodes.filter(n => !n.content || !n.content.trim())
console.log('节点总数', nodes.length, '| 缺正文', missing.length, missing.length ? `（${missing.map(n => n.id).join(', ')}）` : '')
console.log('预生成队列长度（应为 0）:', missing.length)
console.log('正文合计', nodes.reduce((s, n) => s + n.content.length, 0), '字')

console.log()
console.log('=== 进度指标 ===')
const p = meta.progress
console.log('分母(骨架)', p.denominator, '| 进入过', p.entered, '| 覆盖度', (p.coverage * 100).toFixed(1) + '%')
console.log('掌握度', (p.mastery * 100).toFixed(1) + '% | 差值', (p.gap * 100).toFixed(1) + '% | 待复习', p.stale)
console.log('状态分布', JSON.stringify(p.byStatus))

console.log()
console.log('=== 完整性 ===')
const ids = new Set(nodes.map(n => n.id))
let dangling = 0
let selfRef = 0
for (const n of nodes) {
  for (const e of n.edges || []) {
    if (e.targetNodeId && !ids.has(e.targetNodeId)) { dangling += 1; console.log('  悬空边:', n.id, '->', e.targetNodeId) }
    if (e.targetNodeId === n.id) selfRef += 1
  }
}
console.log('悬空边', dangling, '| 自环', selfRef)
const orphan = nodes.filter(n => n.parentId && !ids.has(n.parentId))
console.log('父节点缺失', orphan.length)
console.log('连接边', nodes.reduce((s, n) => s + (n.edges || []).length, 0), '条 | 圈选问答',
  nodes.reduce((s, n) => s + (n.qa || []).length, 0), '条 | 验收',
  nodes.reduce((s, n) => s + (n.quiz || []).length, 0), '次')

console.log()
console.log('=== 骨架十板块（分母结构）===')
for (const branch of nodes.filter(n => n.origin === 'canon' && n.parentId === 'agent_root')) {
  const kids = nodes.filter(n => n.parentId === branch.id)
  const entered = kids.filter(k => k.status !== 'unexplored').length
  console.log('  ' + branch.title.padEnd(12) + '子节点 ' + String(kids.length).padStart(3) + ' | 进入过 ' + entered)
}

console.log()
console.log('=== 抽样：新增节点的正文首段 ===')
for (const id of ['canon_ctx_compress', 'canon_fail_loop', 'canon_prefix_cache']) {
  const n = nodes.find(x => x.id === id)
  console.log(`--- ${n.title}（${n.content.length} 字, ${n.status}）---`)
  console.log(n.content.split('\n').slice(0, 3).join('\n'))
}

fs.rmSync(dir, { recursive: true, force: true })

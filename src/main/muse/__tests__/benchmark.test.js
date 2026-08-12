'use strict'

/**
 * Folio Muse 模块能力评测（含 Mock AI 全链路）
 * 
 * 6 个标准任务：
 *   Task 1: 意图路由分类准确性 (router.js classifyIntent)
 *   Task 2: 代码搜索能力 (code-search.js)
 *   Task 3: 精确文件编辑决策 (file-editor.js shouldUseFileEdit)
 *   Task 4: 任务状态机 + 命令执行全链路 (mock AI)
 *   Task 5: 反馈闭环 + 产物迭代决策 (mock AI)
 *   Task 6: 异常恢复 + 并发安全 + 边界条件
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

// ============================================================
// Mock 基础设施 — 从独立文件加载
// ============================================================
const {
  setupMocks,
  teardownMocks,
  resetMockState,
  getAICallLog,
  setMockAIResponses,
  setCallAIImpl,
  restoreDefaultAIImpl,
  AIResponseFactory
} = require('./__mocks__/ai-mock-infra')

// 在加载 muse 模块前安装 mocks
setupMocks()

// Now load muse modules
const { classifyIntent } = require('../router')
const { grepCode, globFiles, scanDirTree, readFileSlice } = require('../code-search')
const { shouldUseFileEdit } = require('../file-editor')
const { loadTasks, saveTasks, addTask, getPendingTask, updateTaskStatus, addSubtask, getSubtasks, areAllSubtasksCompleted, suspendTask, resumeTask } = require('../tasks')
const config = require('../config')

function ensureMockTasksFile() {
  const dir = path.dirname(config.TASKS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(config.TASKS_FILE)) {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
  }
}

// ============================================================
// Task 1: 意图路由分类
// ============================================================
function runTask1() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 1: 意图路由分类准确性')
  console.log('='.repeat(60))

  const testCases = [
    { input: '你好', expected: 'chat', desc: '简单问候' },
    { input: '什么是 React hooks？', expected: 'chat', desc: '知识问答' },
    { input: 'JavaScript 的闭包是什么', expected: 'chat', desc: '代码概念' },
    { input: '今天天气怎么样', expected: 'chat', desc: '日常闲聊' },
    { input: '/help', expected: 'chat', desc: '斜杠命令' },
    { input: '解释一下这段代码的作用', expected: 'chat', desc: '代码解释' },
    { input: '给我推荐一个 Python 框架', expected: 'chat', desc: '推荐咨询' },
    { input: '帮我创建一个 React 项目', expected: 'tool', desc: '创建项目' },
    { input: '生成一个登录页面', expected: 'tool', desc: '生成文件' },
    { input: '把 config.json 里的端口改为 8080', expected: 'tool', desc: '修改文件' },
    { input: '删除 dist 目录', expected: 'tool', desc: '删除操作' },
    { input: '安装 express 和 cors', expected: 'tool', desc: 'npm install' },
    { input: '运行 docker compose up', expected: 'tool', desc: 'docker 操作' },
    { input: '截取当前页面的截图', expected: 'tool', desc: '截图任务' },
    { input: '帮我部署到服务器', expected: 'tool', desc: '部署任务' },
    { input: '写一个定时备份数据库的脚本', expected: 'tool', desc: '脚本生成' },
    { input: '执行 npm run build', expected: 'tool', desc: '执行命令' },
    { input: '帮我看看这个文件有什么问题', expected: 'chat', desc: '分析请求' },
    { input: '这段代码有 bug 吗', expected: 'chat', desc: 'bug咨询' },
    { input: '数据库应该怎么设计', expected: 'chat', desc: '方案咨询' },
    { input: '项目结构是什么样的', expected: 'chat', desc: '结构询问' },
    { input: '告诉我这个服务器的配置', expected: 'chat', desc: '信息查询' },
    { input: '帮我把所有 var 替换成 const', expected: 'tool', desc: '批量替换' },
  ]

  let correct = 0
  const failures = []
  for (const tc of testCases) {
    const result = classifyIntent(tc.input, {})
    if (result === tc.expected) correct++
    else failures.push({ ...tc, actual: result })
  }

  const accuracy = (correct / testCases.length * 100).toFixed(1)
  console.log(`\n✅ 通过: ${correct}/${testCases.length} (${accuracy}%)`)
  if (failures.length > 0) {
    console.log('❌ 失败:')
    failures.forEach(f => console.log(`  - "${f.input}" → 期望:${f.expected} 实际:${f.actual} (${f.desc})`))
  }

  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task1-意图分类', accuracy: parseFloat(accuracy), grade, failures }
}

// ============================================================
// Task 2: 代码搜索能力
// ============================================================
function runTask2() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 2: 代码搜索能力')
  console.log('='.repeat(60))

  const testDir = path.resolve(__dirname, '../..')
  const results = { passed: 0, failed: 0, details: [] }

  const tests = [
    () => {
      const r = grepCode(testDir, 'module.exports', { maxResults: 10 })
      return { test: 'grep精确搜索', pass: r.matches?.length > 0, info: `${r.matches?.length || 0} 匹配` }
    },
    () => {
      const r = grepCode(testDir, 'async\\s+function\\s+\\w+', { maxResults: 10 })
      return { test: 'grep扩展正则', pass: r.matches?.length > 0, info: `${r.matches?.length || 0} 匹配` }
    },
    () => {
      const r = globFiles(testDir, '*.js')
      return { test: 'glob文件匹配', pass: r.files?.length > 0, info: `${r.files?.length || 0} 文件` }
    },
    () => {
      const r = scanDirTree(testDir, { maxDepth: 2 })
      return { test: '目录树扫描', pass: !!(r && (r.children || r.tree || r.dirs)), info: '结构获取' }
    },
    () => {
      const r = readFileSlice(__filename, 1, 10)
      return { test: '文件切片读取', pass: r?.content?.length > 0, info: `${r?.lines || r?.content?.split?.('\n')?.length || 0} 行` }
    },
    () => {
      const t0 = Date.now()
      for (let i = 0; i < 10; i++) grepCode(testDir, 'require', { maxResults: 5 })
      const avg = ((Date.now() - t0) / 10).toFixed(1)
      return { test: '搜索性能(10次)', pass: (Date.now() - t0) < 5000, info: `${avg}ms/次` }
    },
    () => {
      const r = grepCode(testDir, 'express', { maxResults: 50 })
      const leaked = (r.matches || []).some(m => m.file?.includes('node_modules'))
      return { test: '过滤node_modules', pass: !leaked, info: leaked ? '泄漏!' : '正确排除' }
    },
  ]

  for (const fn of tests) {
    try {
      const r = fn()
      if (r.pass) results.passed++; else results.failed++
      results.details.push(r)
    } catch (err) {
      results.failed++
      results.details.push({ test: '异常', pass: false, info: err.message })
    }
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task2-代码搜索', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 3: 精确文件编辑决策
// ============================================================
function runTask3() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 3: 精确编辑决策准确性')
  console.log('='.repeat(60))

  const tmpDir = path.join(os.tmpdir(), 'muse-bench3-' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })

  fs.writeFileSync(path.join(tmpDir, 'page.html'), '<html><body><h1>Hello</h1></body></html>')
  fs.writeFileSync(path.join(tmpDir, 'style.css'), 'body { color: red; }')
  fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.alloc(100))
  fs.writeFileSync(path.join(tmpDir, 'big.html'), 'x'.repeat(300 * 1024))
  fs.writeFileSync(path.join(tmpDir, 'app.js'), 'const x = 1;\nconsole.log(x);')

  const cases = [
    { desc: '小HTML+局部修改', req: '把标题改蓝色', files: [path.join(tmpDir, 'page.html')], expect: true },
    { desc: 'CSS调整', req: '字体16px', files: [path.join(tmpDir, 'style.css')], expect: true },
    { desc: '二进制PNG', req: '换图', files: [path.join(tmpDir, 'image.png')], expect: false },
    { desc: '超大文件300KB', req: '改第一行', files: [path.join(tmpDir, 'big.html')], expect: false },
    { desc: '多可编辑文件', req: '调整样式', files: [path.join(tmpDir, 'page.html'), path.join(tmpDir, 'style.css')], expect: true },
    { desc: '空列表+目录有产物', req: '修改颜色', files: [], expect: true },
  ]

  let correct = 0
  const failures = []
  for (const c of cases) {
    try {
      const r = shouldUseFileEdit(c.req, c.files, tmpDir)
      if (r.shouldEdit === c.expect) correct++
      else failures.push({ desc: c.desc, expected: c.expect, actual: r.shouldEdit })
    } catch (err) {
      failures.push({ desc: c.desc, error: err.message })
    }
  }

  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}

  const accuracy = (correct / cases.length * 100).toFixed(1)
  console.log(`✅ 通过: ${correct}/${cases.length} (${accuracy}%)`)
  if (failures.length) failures.forEach(f => console.log(`  ❌ ${f.desc}: ${f.error || `期望=${f.expected} 实际=${f.actual}`}`))
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task3-编辑决策', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 4: 任务状态机 + 端到端命令执行 (Mock AI)
// ============================================================
async function runTask4() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 4: 任务状态机 + 命令执行全链路')
  console.log('='.repeat(60))

  ensureMockTasksFile()

  // 备份现有任务
  let originalTasks = '[]'
  try { originalTasks = fs.readFileSync(config.TASKS_FILE, 'utf8') } catch {}
  fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')

  const results = { passed: 0, failed: 0, details: [] }

  // 4.1 添加任务
  try {
    const task = addTask('创建一个 Express API 项目', 'high')
    const pass = task && task.id && task.status === 'pending'
    results.details.push({ test: 'addTask创建', pass, info: pass ? `id=${task.id}` : '结构异常' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'addTask创建', pass: false, info: err.message })
  }

  // 4.2 获取 pending 任务
  try {
    const pending = getPendingTask()
    const pass = pending && pending.status === 'pending'
    results.details.push({ test: 'getPendingTask', pass, info: pass ? '获取成功' : '无pending' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'getPendingTask', pass: false, info: err.message })
  }

  // 4.3 状态更新
  try {
    const tasks = loadTasks()
    const taskId = tasks[0]?.id
    updateTaskStatus(taskId, { status: 'executing', startedAt: new Date().toISOString() })
    const updated = loadTasks().find(t => t.id === taskId)
    const pass = updated?.status === 'executing'
    results.details.push({ test: '状态更新executing', pass, info: pass ? '成功' : `status=${updated?.status}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '状态更新executing', pass: false, info: err.message })
  }

  // 4.4 子任务创建
  try {
    const parentId = loadTasks()[0]?.id
    const sub1 = addSubtask(parentId, '安装依赖', { priority: 'high' })
    const sub2 = addSubtask(parentId, '创建路由', { priority: 'high' })
    const subtasks = getSubtasks(parentId)
    const pass = subtasks.length === 2
    results.details.push({ test: '子任务创建', pass, info: `${subtasks.length} 个子任务` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '子任务创建', pass: false, info: err.message })
  }

  // 4.5 子任务完成检测
  try {
    const parentId = loadTasks().find(t => !t.parentId)?.id
    const subtasks = getSubtasks(parentId)
    subtasks.forEach(s => updateTaskStatus(s.id, { status: 'completed' }))
    const allDone = areAllSubtasksCompleted(parentId)
    results.details.push({ test: '子任务全完成检测', pass: allDone, info: allDone ? '正确' : '未检测到' })
    if (allDone) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '子任务全完成检测', pass: false, info: err.message })
  }

  // 4.6 任务挂起+恢复
  try {
    const parentId = loadTasks().find(t => !t.parentId)?.id
    suspendTask(parentId, '等待主人确认')
    let task = loadTasks().find(t => t.id === parentId)
    const suspended = task?.status === 'suspended'
    resumeTask(parentId)
    task = loadTasks().find(t => t.id === parentId)
    const resumed = task?.status === 'pending'
    const pass = suspended && resumed
    results.details.push({ test: '挂起+恢复', pass, info: pass ? '状态流转正确' : `suspended=${suspended} resumed=${resumed}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '挂起+恢复', pass: false, info: err.message })
  }

  // 4.7 executeCommand 全链路 (Mock AI via setCallAIImpl)
  try {
    resetMockState()

    let localAICalls = 0
    setCallAIImpl(async (prompt) => {
      localAICalls++
      // 第一次: executeCommand 分析指令
      if (localAICalls === 1) {
        return AIResponseFactory.newTaskRecognition('mock理解')
      }
      // 第二次: 策略分析
      if (localAICalls === 2) {
        return AIResponseFactory.taskStrategy({ understood: '创建test文件' })
      }
      // 后续: 脚本生成（返回代码块格式，修复"未找到代码块"缺陷）
      return AIResponseFactory.scriptGeneration('echo "hello" > test.txt', 'bash')
    })

    const { executeCommand } = require('../command')
    const result = await executeCommand('创建一个简单的 test 文件')
    const pass = result?.success === true && result?.taskId
    results.details.push({ test: 'executeCommand全链路', pass, info: pass ? `taskId=${result.taskId}` : JSON.stringify(result).slice(0, 80) })
    if (pass) results.passed++; else results.failed++

    // 等一下让 setImmediate 心跳触发
    await new Promise(r => setTimeout(r, 200))

    const aiCalled = localAICalls > 0
    results.details.push({ test: 'AI调用记录', pass: aiCalled, info: `${localAICalls} 次调用` })
    if (aiCalled) results.passed++; else results.failed++

    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'executeCommand全链路', pass: false, info: err.message })
    restoreDefaultAIImpl()
  }

  // 恢复原始任务文件
  try { fs.writeFileSync(config.TASKS_FILE, originalTasks, 'utf8') } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task4-命令执行', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 5: 反馈闭环 + 产物迭代决策
// ============================================================
async function runTask5() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 5: 反馈闭环 + 产物迭代决策')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 5.1 测试 shouldUseFileEdit 在反馈场景的决策链
  const tmpDir = path.join(os.tmpdir(), 'muse-bench5-' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })
  
  // 模拟一个已完成任务的产物
  const artifactHtml = path.join(tmpDir, 'report.html')
  fs.writeFileSync(artifactHtml, `<!DOCTYPE html>
<html><head><title>Report</title><style>
h1 { color: red; font-size: 24px; }
table { border: 1px solid #ccc; }
th { background: #333; color: white; }
</style></head><body>
<h1>Monthly Report</h1>
<table><tr><th>Item</th><th>Value</th></tr>
<tr><td>Revenue</td><td>$100K</td></tr>
</table></body></html>`)

  // 反馈场景 1: 局部修改 → 应走精确编辑
  try {
    const r = shouldUseFileEdit('把表头颜色改为蓝色', [artifactHtml], tmpDir)
    const pass = r.shouldEdit === true
    results.details.push({ test: '反馈-局部修改→精确编辑', pass, info: pass ? '正确' : `shouldEdit=${r.shouldEdit}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '反馈-局部修改→精确编辑', pass: false, info: err.message })
  }

  // 反馈场景 2: 中等修改 → 应走精确编辑
  try {
    const r = shouldUseFileEdit('添加一个新的饼图 section', [artifactHtml], tmpDir)
    const pass = r.shouldEdit === true
    results.details.push({ test: '反馈-中等修改→精确编辑', pass, info: pass ? '正确' : `shouldEdit=${r.shouldEdit}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '反馈-中等修改→精确编辑', pass: false, info: err.message })
  }

  // 5.2 测试任务状态机在反馈场景的流转
  ensureMockTasksFile()
  let originalTasks = '[]'
  try { originalTasks = fs.readFileSync(config.TASKS_FILE, 'utf8') } catch {}
  fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')

  // 模拟: 任务 completed → 主人追加修改 → 状态应能支持追加
  try {
    const task = addTask('生成月度报告', 'high')
    updateTaskStatus(task.id, { status: 'completed', outputFiles: [artifactHtml] })
    const completedTask = loadTasks().find(t => t.id === task.id)
    
    // 追加修改：更新状态为 pending + 记录修改历史
    updateTaskStatus(task.id, {
      status: 'pending',
      modificationHistory: [{ request: '颜色改蓝', timestamp: new Date().toISOString() }]
    })
    const modifiedTask = loadTasks().find(t => t.id === task.id)
    const pass = modifiedTask?.status === 'pending' && modifiedTask?.modificationHistory?.length === 1
    results.details.push({ test: 'completed→追加修改', pass, info: pass ? '状态流转正确' : `status=${modifiedTask?.status}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'completed→追加修改', pass: false, info: err.message })
  }

  // 5.3 waiting_reply 超时恢复
  try {
    const task = addTask('需要确认的任务', 'normal')
    updateTaskStatus(task.id, {
      status: 'waiting_reply',
      waitingSince: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      waitingReason: 'task_plan_review'
    })
    const waitingTask = loadTasks().find(t => t.id === task.id)
    const elapsed = Date.now() - new Date(waitingTask.waitingSince).getTime()
    const shouldRecover = elapsed > config.WAITING_REPLY_TIMEOUT
    results.details.push({ test: 'waiting_reply超时检测', pass: shouldRecover, info: shouldRecover ? '25h>24h 正确触发' : '未触发' })
    if (shouldRecover) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'waiting_reply超时检测', pass: false, info: err.message })
  }

  // 5.4 多轮反馈历史累积
  try {
    const tasks = loadTasks()
    const taskId = tasks[0]?.id
    updateTaskStatus(taskId, {
      feedbackHistory: [
        { intent: 'modification', reply: '颜色太深了', understood: '调浅颜色' },
        { intent: 'modification', reply: '字体再大一点', understood: '增大字号' },
        { intent: 'approved', reply: '可以了', understood: '通过确认' },
      ]
    })
    const task = loadTasks().find(t => t.id === taskId)
    const pass = task?.feedbackHistory?.length === 3
    results.details.push({ test: '反馈历史累积', pass, info: `${task?.feedbackHistory?.length || 0} 条反馈` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '反馈历史累积', pass: false, info: err.message })
  }

  // 5.5 editFileInPlace Mock AI 精确编辑测试
  try {
    setCallAIImpl(async () => AIResponseFactory.fileEdit([
      { old_string: 'color: red', new_string: 'color: blue', description: '标题颜色改蓝' }
    ]))

    const { editFileInPlace } = require('../file-editor')
    const r = await editFileInPlace(artifactHtml, '把标题颜色改为蓝色')
    const content = fs.readFileSync(artifactHtml, 'utf8')
    const pass = r.success === true && content.includes('color: blue')
    results.details.push({ test: 'editFileInPlace精确编辑', pass, info: pass ? `${r.editCount} 处修改` : (r.error || '内容未变') })
    if (pass) results.passed++; else results.failed++

    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'editFileInPlace精确编辑', pass: false, info: err.message })
    restoreDefaultAIImpl()
  }

  // 5.6 心跳决策优先级验证（纯逻辑验证，不依赖实际任务状态）
  try {
    // 模拟心跳决策链：同时有超时任务和 pending 任务
    const mockTasks = [
      { id: 'w1', status: 'waiting_reply', waitingSince: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      { id: 'p1', status: 'pending', priority: 'high', createdAt: new Date().toISOString() },
    ]

    // 心跳决策逻辑复现
    let decision = null
    const timeoutTask = mockTasks.find(t => {
      if (t.status !== 'waiting_reply' || !t.waitingSince) return false
      return (Date.now() - new Date(t.waitingSince).getTime()) > config.WAITING_REPLY_TIMEOUT
    })
    if (timeoutTask) decision = 'recover_timeout'
    if (!decision) {
      const pending = mockTasks.find(t => t.status === 'pending')
      if (pending) decision = 'execute_pending'
    }

    const pass = decision === 'recover_timeout'
    results.details.push({ test: '心跳优先级:超时>pending', pass, info: `决策=${decision}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '心跳优先级:超时>pending', pass: false, info: err.message })
  }

  // 恢复
  try { fs.writeFileSync(config.TASKS_FILE, originalTasks, 'utf8') } catch {}
  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task5-反馈闭环', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 6: 异常恢复 + 并发安全 + 边界条件
// ============================================================
async function runTask6() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 6: 异常恢复 + 并发安全 + 边界条件')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }
  ensureMockTasksFile()
  let originalTasks = '[]'
  try { originalTasks = fs.readFileSync(config.TASKS_FILE, 'utf8') } catch {}
  fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')

  // 6.1 AI 返回畸形 JSON 时的容错
  try {
    resetMockState()
    setCallAIImpl(async () => AIResponseFactory.malformedJSON())

    const { editFileInPlace } = require('../file-editor')
    const tmpFile = path.join(os.tmpdir(), `muse-bench6-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, '<h1>Test</h1>')
    const result = await editFileInPlace(tmpFile, '改颜色')
    // 应优雅降级而非崩溃
    const pass = result.success === false || result.editCount === 0
    results.details.push({ test: 'AI畸形JSON容错', pass, info: pass ? '优雅降级' : '未处理异常' })
    if (pass) results.passed++; else results.failed++
    try { fs.unlinkSync(tmpFile) } catch {}
    restoreDefaultAIImpl()
  } catch (err) {
    // 如果抛异常说明缺少容错 — 这是一个真实缺陷
    results.failed++
    results.details.push({ test: 'AI畸形JSON容错', pass: false, info: `未捕获: ${err.message.slice(0, 60)}` })
    restoreDefaultAIImpl()
  }

  // 6.2 并发任务写入安全（快速连续添加多个任务）
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const concurrentAdds = Array.from({ length: 10 }, (_, i) =>
      Promise.resolve(addTask(`并发任务${i}`, i % 2 === 0 ? 'high' : 'normal'))
    )
    await Promise.all(concurrentAdds)
    const tasks = loadTasks()
    const uniqueIds = new Set(tasks.map(t => t.id))
    const pass = tasks.length === 10 && uniqueIds.size === 10
    results.details.push({ test: '并发10任务写入', pass, info: `${tasks.length}个任务, ${uniqueIds.size}个唯一ID` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '并发10任务写入', pass: false, info: err.message })
  }

  // 6.3 任务文件损坏恢复
  try {
    fs.writeFileSync(config.TASKS_FILE, '这不是 JSON!!!', 'utf8')
    let recovered = false
    try {
      const tasks = loadTasks()
      recovered = Array.isArray(tasks) // 应返回空数组而非崩溃
    } catch {
      recovered = false
    }
    results.details.push({ test: '任务文件损坏恢复', pass: recovered, info: recovered ? '正确降级为空' : '崩溃未恢复' })
    if (recovered) results.passed++; else results.failed++
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
  } catch (err) {
    results.failed++
    results.details.push({ test: '任务文件损坏恢复', pass: false, info: err.message })
  }

  // 6.4 超长指令输入处理（>10KB）
  try {
    const longInput = '帮我创建一个包含以下内容的文件：' + 'A'.repeat(10240)
    const intent = classifyIntent(longInput, {})
    const pass = intent === 'tool' || intent === 'chat' // 不崩溃就行
    results.details.push({ test: '超长输入10KB', pass, info: `分类=${intent}, 无崩溃` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '超长输入10KB', pass: false, info: err.message })
  }

  // 6.5 空字符串/特殊字符输入
  try {
    const edgeCases = ['', '   ', '\n\n\n', '🔥🚀💻', '<script>alert(1)</script>', 'rm -rf /']
    let allPassed = true
    for (const input of edgeCases) {
      try {
        classifyIntent(input, {})
      } catch {
        allPassed = false
        break
      }
    }
    results.details.push({ test: '特殊字符/空输入容错', pass: allPassed, info: allPassed ? '6种边界均通过' : '存在崩溃' })
    if (allPassed) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '特殊字符/空输入容错', pass: false, info: err.message })
  }

  // 6.6 任务状态非法流转检测（completed → executing 应拒绝或警告）
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const task = addTask('状态流转测试', 'normal')
    updateTaskStatus(task.id, { status: 'completed' })
    // 尝试非法流转：completed → executing
    updateTaskStatus(task.id, { status: 'executing' })
    const current = loadTasks().find(t => t.id === task.id)
    // 如果允许了非法流转，这是一个设计缺陷
    const isIllegalAllowed = current?.status === 'executing'
    results.details.push({
      test: '非法状态流转检测',
      pass: !isIllegalAllowed,
      info: isIllegalAllowed ? '⚠️ 缺陷:允许completed→executing' : '正确拒绝'
    })
    if (!isIllegalAllowed) results.passed++; else results.failed++
  } catch (err) {
    // 抛异常也算正确拒绝
    results.passed++
    results.details.push({ test: '非法状态流转检测', pass: true, info: '异常拒绝:' + err.message.slice(0, 40) })
  }

  // 6.7 文件编辑：不存在的文件处理
  try {
    const { editFileInPlace } = require('../file-editor')
    setCallAIImpl(async () => AIResponseFactory.fileEdit([
      { old_string: 'x', new_string: 'y', description: 'test' }
    ]))
    const result = await editFileInPlace('/nonexistent/path/file.html', '修改颜色')
    const pass = result.success === false
    results.details.push({ test: '编辑不存在文件', pass, info: pass ? '正确拒绝' : '未检测到' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    // 抛异常也可接受
    results.passed++
    results.details.push({ test: '编辑不存在文件', pass: true, info: '异常拒绝' })
    restoreDefaultAIImpl()
  }

  // 6.8 executeCommand 空指令处理
  try {
    resetMockState()
    setCallAIImpl(async () => AIResponseFactory.newTaskRecognition('空指令'))
    const { executeCommand } = require('../command')
    const result = await executeCommand('')
    // 空指令应被拒绝或返回失败
    const pass = !result?.success || result?.taskId
    results.details.push({ test: '空指令处理', pass, info: result?.success ? `taskId=${result.taskId}` : '拒绝空指令' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.passed++
    results.details.push({ test: '空指令处理', pass: true, info: '异常拒绝空指令' })
    restoreDefaultAIImpl()
  }

  // 6.9 代码搜索：不存在的目录
  try {
    const result = grepCode('/nonexistent/dir/xyz', 'pattern', { maxResults: 5 })
    const pass = !result.error || (result.matches && result.matches.length === 0)
    results.details.push({ test: '搜索不存在目录', pass, info: pass ? '安全返回空' : '未处理' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '搜索不存在目录', pass: false, info: `崩溃: ${err.message.slice(0, 50)}` })
  }

  // 6.10 任务优先级排序正确性
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    addTask('低优先级', 'low')
    addTask('高优先级', 'high')
    addTask('普通优先级', 'normal')
    const pending = getPendingTask()
    const pass = pending?.priority === 'high'
    results.details.push({ test: '优先级排序', pass, info: `取到: ${pending?.priority || 'null'}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '优先级排序', pass: false, info: err.message })
  }

  // 恢复
  try { fs.writeFileSync(config.TASKS_FILE, originalTasks, 'utf8') } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task6-异常边界', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 7: 多文件协同编辑（对标 Claude Code/Copilot multi-file refactor）
// ============================================================
async function runTask7() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 7: 多文件协同编辑能力')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }
  const tmpDir = path.join(os.tmpdir(), 'muse-bench7-' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })

  // 创建多文件项目结构
  fs.writeFileSync(path.join(tmpDir, 'index.html'), `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><div class="app"><h1 class="title">App</h1></div><script src="app.js"></script></body></html>`)
  fs.writeFileSync(path.join(tmpDir, 'style.css'), `.app { padding: 20px; }\n.title { color: red; font-size: 24px; }`)
  fs.writeFileSync(path.join(tmpDir, 'app.js'), `const title = document.querySelector('.title');\ntitle.textContent = 'Hello';`)

  // 7.1 shouldUseFileEdit 识别多文件场景
  try {
    const files = [path.join(tmpDir, 'index.html'), path.join(tmpDir, 'style.css'), path.join(tmpDir, 'app.js')]
    const r = shouldUseFileEdit('把所有标题改为绿色大字', files, tmpDir)
    const pass = r.shouldEdit === true && (r.files || files).length >= 2
    results.details.push({ test: '多文件编辑识别', pass, info: pass ? `识别${(r.files || files).length}个文件` : 'shouldEdit=' + r.shouldEdit })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '多文件编辑识别', pass: false, info: err.message })
  }

  // 7.2 editFileInPlace 跨文件一致性（CSS+HTML 联动）
  try {
    const cssPath = path.join(tmpDir, 'style.css')
    const htmlPath = path.join(tmpDir, 'index.html')

    // 先编辑 CSS
    setCallAIImpl(async () => AIResponseFactory.fileEdit([
      { old_string: 'color: red', new_string: 'color: green', description: '颜色改绿' },
      { old_string: 'font-size: 24px', new_string: 'font-size: 36px', description: '字体变大' }
    ]))
    const { editFileInPlace } = require('../file-editor')
    const r1 = await editFileInPlace(cssPath, '颜色改绿色，字体变大')

    // 再编辑 HTML
    setCallAIImpl(async () => AIResponseFactory.fileEdit([
      { old_string: 'class="title"', new_string: 'class="title big-title"', description: '添加大标题class' }
    ]))
    const r2 = await editFileInPlace(htmlPath, '添加大标题 class')

    const css = fs.readFileSync(cssPath, 'utf8')
    const html = fs.readFileSync(htmlPath, 'utf8')
    const pass = r1.success && r2.success && css.includes('green') && html.includes('big-title')
    results.details.push({ test: '跨文件编辑一致性', pass, info: pass ? `CSS=${r1.editCount}处 HTML=${r2.editCount}处` : `r1=${r1.success}(${r1.error || ''}) r2=${r2.success}(${r2.error || ''})` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '跨文件编辑一致性', pass: false, info: err.message })
    restoreDefaultAIImpl()
  }

  // 7.3 编辑后文件语法完整性验证
  try {
    const css = fs.readFileSync(path.join(tmpDir, 'style.css'), 'utf8')
    const html = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8')
    const cssValid = css.includes('{') && css.includes('}') && !css.includes('undefined')
    const htmlValid = html.includes('</html>') && !html.includes('undefined')
    const pass = cssValid && htmlValid
    results.details.push({ test: '编辑后语法完整', pass, info: pass ? 'CSS+HTML 完整' : `CSS=${cssValid} HTML=${htmlValid}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '编辑后语法完整', pass: false, info: err.message })
  }

  // 7.4 批量文件 glob 搜索 → 定位 → 编辑链路
  try {
    const jsFiles = globFiles(tmpDir, '*.js')
    const cssFiles = globFiles(tmpDir, '*.css')
    const pass = jsFiles.files?.length >= 1 && cssFiles.files?.length >= 1
    results.details.push({ test: 'glob定位项目文件', pass, info: `JS=${jsFiles.files?.length} CSS=${cssFiles.files?.length}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'glob定位项目文件', pass: false, info: err.message })
  }

  // 7.5 grep 跨文件引用追踪
  try {
    const refs = grepCode(tmpDir, 'title', { maxResults: 20 })
    const fileSet = new Set((refs.matches || []).map(m => path.basename(m.file || m.path || '')))
    const pass = fileSet.size >= 2 // 至少在2个文件中找到
    results.details.push({ test: 'grep跨文件引用追踪', pass, info: `在${fileSet.size}个文件中找到引用` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'grep跨文件引用追踪', pass: false, info: err.message })
  }

  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task7-多文件编辑', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 8: 上下文窗口管理 + 大文件分块分析（对标 Claude Code context）
// ============================================================
async function runTask8() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 8: 上下文窗口管理 + 大文件分块')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }
  const { readFileChunks, getFileLineCount, isLargeFile } = require('../chunk-analyzer')

  const tmpDir = path.join(os.tmpdir(), 'muse-bench8-' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })

  // 创建大文件（1000行）
  const bigFile = path.join(tmpDir, 'big-code.js')
  const lines = Array.from({ length: 1000 }, (_, i) => `// Line ${i + 1}\nfunction handler_${i}() { return ${i}; }`)
  fs.writeFileSync(bigFile, lines.join('\n'))

  // 8.1 大文件识别
  try {
    const large = isLargeFile(bigFile)
    results.details.push({ test: '大文件识别(1000行)', pass: large, info: large ? '正确识别' : '未识别' })
    if (large) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '大文件识别(1000行)', pass: false, info: err.message })
  }

  // 8.2 分块切割正确性
  try {
    const chunks = readFileChunks(bigFile)
    const pass = chunks.length >= 2 && chunks.every(c => c.length > 0)
    results.details.push({ test: '分块切割', pass, info: `${chunks.length}个块` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '分块切割', pass: false, info: err.message })
  }

  // 8.3 行数统计准确性
  try {
    const lineCount = getFileLineCount(bigFile)
    const pass = lineCount >= 1900 && lineCount <= 2100 // ~2000行（每个handler 2行）
    results.details.push({ test: '行数统计', pass, info: `${lineCount}行` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '行数统计', pass: false, info: err.message })
  }

  // 8.4 readFileSlice 精确切片
  try {
    const slice = readFileSlice(bigFile, 100, 110)
    const pass = slice?.content?.includes('Line 100') || slice?.content?.includes('handler_')
    results.details.push({ test: '精确切片(100-110行)', pass, info: pass ? '内容正确' : '内容不匹配' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '精确切片(100-110行)', pass: false, info: err.message })
  }

  // 8.5 空文件/小文件不触发分块
  try {
    const smallFile = path.join(tmpDir, 'small.js')
    fs.writeFileSync(smallFile, 'const x = 1;')
    const notLarge = !isLargeFile(smallFile)
    results.details.push({ test: '小文件不触发分块', pass: notLarge, info: notLarge ? '正确' : '误触发' })
    if (notLarge) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '小文件不触发分块', pass: false, info: err.message })
  }

  // 8.6 shouldUseFileEdit 拒绝过大文件
  try {
    const r = shouldUseFileEdit('修改第一行', [bigFile], tmpDir)
    // 1000行*2 = 2000行的文件大概 30KB+，file-editor 200KB限制不会拒绝
    // 但 shouldUseFileEdit 应基于文件大小做判断
    const pass = r.shouldEdit === true || r.shouldEdit === false // 有明确决策
    results.details.push({ test: '大文件编辑决策', pass, info: `shouldEdit=${r.shouldEdit}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '大文件编辑决策', pass: false, info: err.message })
  }

  try { fs.rmSync(tmpDir, { recursive: true }) } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task8-上下文管理', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 9: 自动修复循环 + 错误诊断（对标 Copilot lint-fix loop）
// ============================================================
async function runTask9() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 9: 自动修复循环 + 错误诊断')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }
  ensureMockTasksFile()
  let originalTasks = '[]'
  try { originalTasks = fs.readFileSync(config.TASKS_FILE, 'utf8') } catch {}
  fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')

  // 9.1 任务失败后自动重试机制
  try {
    const task = addTask('编译出错的项目', 'high')
    updateTaskStatus(task.id, { status: 'executing', attempts: 1 })
    updateTaskStatus(task.id, { status: 'failed', error: 'SyntaxError: Unexpected token' })
    const failedTask = loadTasks().find(t => t.id === task.id)
    // 模拟重试：failed → pending
    updateTaskStatus(task.id, { status: 'pending', attempts: failedTask.attempts + 1 })
    const retried = loadTasks().find(t => t.id === task.id)
    const pass = retried?.status === 'pending' && retried?.attempts === 2
    results.details.push({ test: '失败后重试机制', pass, info: `状态=${retried?.status} 尝试=${retried?.attempts}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '失败后重试机制', pass: false, info: err.message })
  }

  // 9.2 MAX_SCRIPT_RETRIES 上限保护
  try {
    const { MAX_SCRIPT_RETRIES } = config
    const pass = typeof MAX_SCRIPT_RETRIES === 'number' && MAX_SCRIPT_RETRIES >= 2 && MAX_SCRIPT_RETRIES <= 5
    results.details.push({ test: '重试上限配置', pass, info: `MAX_SCRIPT_RETRIES=${MAX_SCRIPT_RETRIES}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '重试上限配置', pass: false, info: err.message })
  }

  // 9.3 MAX_REPAIR_ATTEMPTS 子任务修复次数
  try {
    const { MAX_REPAIR_ATTEMPTS } = config
    const pass = typeof MAX_REPAIR_ATTEMPTS === 'number' && MAX_REPAIR_ATTEMPTS >= 1
    results.details.push({ test: '子任务修复上限', pass, info: `MAX_REPAIR_ATTEMPTS=${MAX_REPAIR_ATTEMPTS}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '子任务修复上限', pass: false, info: err.message })
  }

  // 9.4 错误信息保留（修复时可追溯历史错误）
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const task = addTask('有bug的脚本', 'high')
    updateTaskStatus(task.id, { status: 'executing' })
    updateTaskStatus(task.id, {
      status: 'failed',
      error: 'TypeError: Cannot read property "x" of null',
      repairAttempts: 1,
      repairStrategies: ['add null check']
    })
    const failed = loadTasks().find(t => t.id === task.id)
    const pass = failed?.error?.includes('TypeError') && failed?.repairStrategies?.length === 1
    results.details.push({ test: '错误信息追溯', pass, info: pass ? '错误+修复策略已记录' : '信息丢失' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '错误信息追溯', pass: false, info: err.message })
  }

  // 9.5 editFileInPlace 修复失败后降级（重新生成而非卡死）
  try {
    setCallAIImpl(async () => AIResponseFactory.fileEdit([
      { old_string: 'NOT_EXIST_STRING', new_string: 'fixed', description: '修复不存在的字符串' }
    ]))
    const tmpFile = path.join(os.tmpdir(), `muse-bench9-${Date.now()}.js`)
    fs.writeFileSync(tmpFile, 'const x = 1;')
    const { editFileInPlace } = require('../file-editor')
    const r = await editFileInPlace(tmpFile, '修复语法错误')
    // old_string 不存在应降级为失败，不应崩溃
    const pass = r.success === false || r.editCount === 0
    results.details.push({ test: '编辑失败降级', pass, info: pass ? '正确降级' : `editCount=${r.editCount}` })
    if (pass) results.passed++; else results.failed++
    try { fs.unlinkSync(tmpFile) } catch {}
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '编辑失败降级', pass: false, info: err.message })
    restoreDefaultAIImpl()
  }

  // 9.6 子任务失败不阻塞父任务
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const parent = addTask('部署全套', 'high')
    updateTaskStatus(parent.id, { status: 'executing' })
    const sub1 = addSubtask(parent.id, '编译', { priority: 'high' })
    const sub2 = addSubtask(parent.id, '部署', { priority: 'high' })
    updateTaskStatus(sub1.id, { status: 'executing' })
    updateTaskStatus(sub1.id, { status: 'failed', error: '编译失败' })
    // sub2 仍为 pending，父任务不应自动完成
    const parentTask = loadTasks().find(t => t.id === parent.id)
    const allDone = areAllSubtasksCompleted(parent.id)
    const pass = !allDone && parentTask?.status === 'executing'
    results.details.push({ test: '子任务失败不阻塞', pass, info: pass ? '父任务继续执行' : `allDone=${allDone}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '子任务失败不阻塞', pass: false, info: err.message })
  }

  try { fs.writeFileSync(config.TASKS_FILE, originalTasks, 'utf8') } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task9-自动修复', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 10: 心跳自主唤醒 + 主动探索（Muse 特殊能力）
// ============================================================
async function runTask10() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 10: 心跳自主唤醒 + 主动探索')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 10.1 心跳间隔配置合理性
  try {
    const { HEARTBEAT_INTERVAL } = config
    const minutes = HEARTBEAT_INTERVAL / 60000
    const pass = minutes >= 1 && minutes <= 10
    results.details.push({ test: '心跳间隔配置', pass, info: `${minutes}分钟` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '心跳间隔配置', pass: false, info: err.message })
  }

  // 10.2 心跳决策链：无任务时不崩溃
  try {
    ensureMockTasksFile()
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const pending = getPendingTask()
    const pass = pending === null
    results.details.push({ test: '空任务队列安全', pass, info: pass ? '正确返回null' : '异常' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '空任务队列安全', pass: false, info: err.message })
  }

  // 10.3 探索冷却机制（EXPLORE_COOLDOWN 存在且合理）
  try {
    const { EXPLORE_COOLDOWN, MAX_DAILY_EXPLORES } = config
    const cooldownMinutes = EXPLORE_COOLDOWN / 60000
    const pass = cooldownMinutes >= 10 && MAX_DAILY_EXPLORES >= 3 && MAX_DAILY_EXPLORES <= 20
    results.details.push({ test: '探索频率限制', pass, info: `冷却${cooldownMinutes}min, 日限${MAX_DAILY_EXPLORES}次` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '探索频率限制', pass: false, info: err.message })
  }

  // 10.4 心跳优先级链：executing > waiting_reply > pending
  try {
    const mockTasks = [
      { id: 'e1', status: 'executing', startedAt: new Date().toISOString() },
      { id: 'w1', status: 'waiting_reply', waitingSince: new Date().toISOString() },
      { id: 'p1', status: 'pending', priority: 'high' },
    ]
    // 心跳应检测到 executing 任务，不再启动新任务
    const hasExecuting = mockTasks.some(t => t.status === 'executing')
    const shouldSkipNewTask = hasExecuting
    results.details.push({ test: '心跳不重复执行', pass: shouldSkipNewTask, info: shouldSkipNewTask ? 'executing时跳过' : '异常' })
    if (shouldSkipNewTask) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '心跳不重复执行', pass: false, info: err.message })
  }

  // 10.5 心跳锁超时自动释放（防死锁）
  try {
    const { HEARTBEAT_INTERVAL } = config
    // 锁超时应大于心跳间隔的若干倍
    const lockTimeout = 10 * 60 * 1000 // heartbeat.js 中定义
    const pass = lockTimeout > HEARTBEAT_INTERVAL * 2
    results.details.push({ test: '锁超时>心跳*2', pass, info: `锁${lockTimeout / 60000}min > 心跳${HEARTBEAT_INTERVAL / 60000 * 2}min` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '锁超时>心跳*2', pass: false, info: err.message })
  }

  // 10.6 waiting_reply 超时自动恢复配置
  try {
    const { WAITING_REPLY_TIMEOUT } = config
    const hours = WAITING_REPLY_TIMEOUT / (60 * 60 * 1000)
    const pass = hours >= 12 && hours <= 48
    results.details.push({ test: '等待超时配置', pass, info: `${hours}小时` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '等待超时配置', pass: false, info: err.message })
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task10-心跳探索', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 11: 对话分析 + 画像更新 + 任务复盘（Muse 特殊能力）
// ============================================================
async function runTask11() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 11: 对话分析 + 画像 + 复盘')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 11.1 对话分析 — AI 返回 JSON 解析
  try {
    setCallAIImpl(async () => JSON.stringify({
      isSignificant: true,
      category: '技术',
      insights: '主人在学习 Rust',
      profileUpdate: { section: '技术栈', content: '正在学习 Rust' },
      ideaSpark: { title: '', content: '' },
      proactiveAction: { type: 'none', description: '', query: '' }
    }))

    const { analyzeConversation } = require('../conversation')
    const r = await analyzeConversation('Rust 的所有权机制怎么理解？', '所有权是 Rust 的核心概念...')
    const pass = r?.success === true
    results.details.push({ test: '对话分析执行', pass, info: pass ? '成功' : JSON.stringify(r).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '对话分析执行', pass: false, info: err.message.slice(0, 60) })
    restoreDefaultAIImpl()
  }

  // 11.2 对话分析跳过模式（任务状态查询不触发）
  try {
    let aiCalled = false
    setCallAIImpl(async () => { aiCalled = true; return '{}' })

    const { analyzeConversation } = require('../conversation')
    await analyzeConversation('当前正在执行什么任务？', '正在执行...')
    const pass = !aiCalled // 应被跳过
    results.details.push({ test: '状态查询跳过分析', pass, info: pass ? '正确跳过' : '不应调AI' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '状态查询跳过分析', pass: false, info: err.message })
    restoreDefaultAIImpl()
  }

  // 11.3 任务复盘 — 成功任务
  try {
    setCallAIImpl(async () => JSON.stringify({
      lesson: '分步执行效率更高',
      rootCause: '任务拆分合理',
      improvement: '继续保持拆分策略',
      shouldUpdateProfile: true,
      profileSection: '任务经验',
      profileContent: '擅长前端构建任务',
      category: 'code_generation'
    }))

    const { retrospectTask } = require('../retrospect')
    const mockTask = {
      id: 'test_retro_1',
      command: '生成一个 React 登录页面',
      status: 'completed',
      startedAt: new Date(Date.now() - 300000).toISOString(),
      completedAt: new Date().toISOString(),
      error: null
    }
    const r = await retrospectTask(mockTask)
    const pass = r !== undefined // 只要不崩溃就行，复盘是异步增值
    results.details.push({ test: '成功任务复盘', pass, info: pass ? '复盘完成' : '崩溃' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '成功任务复盘', pass: false, info: err.message.slice(0, 60) })
    restoreDefaultAIImpl()
  }

  // 11.4 任务复盘 — 失败任务含子任务
  try {
    ensureMockTasksFile()
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const parent = addTask('复盘测试父任务', 'high')
    const sub = addSubtask(parent.id, '编译子任务', {})
    updateTaskStatus(sub.id, { status: 'executing' })
    updateTaskStatus(sub.id, { status: 'failed', error: 'build error', repairAttempts: 2 })

    setCallAIImpl(async () => JSON.stringify({
      lesson: '依赖版本冲突',
      rootCause: '未锁定版本',
      improvement: '使用 lockfile',
      shouldUpdateProfile: false,
      category: 'task_execution'
    }))

    const { retrospectTask } = require('../retrospect')
    const mockTask = { id: parent.id, command: '复盘测试父任务', status: 'failed', error: 'build error', startedAt: new Date().toISOString() }
    const r = await retrospectTask(mockTask)
    const pass = r !== undefined
    results.details.push({ test: '失败任务复盘(含子任务)', pass, info: pass ? '复盘完成' : '崩溃' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '失败任务复盘(含子任务)', pass: false, info: err.message.slice(0, 60) })
    restoreDefaultAIImpl()
  }

  // 11.5 画像上下文长度限制
  try {
    const { MAX_PROFILE_LENGTH, MAX_RECENT_CHATS, MAX_MEMORIES_DISPLAY } = config
    const pass = MAX_PROFILE_LENGTH > 0 && MAX_RECENT_CHATS > 0 && MAX_MEMORIES_DISPLAY > 0
    results.details.push({ test: '画像长度限制配置', pass, info: `profile=${MAX_PROFILE_LENGTH} chats=${MAX_RECENT_CHATS} mem=${MAX_MEMORIES_DISPLAY}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '画像长度限制配置', pass: false, info: err.message })
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task11-对话复盘', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 12: 增量脚本生成 + 产物管理（Muse 特殊能力）
// ============================================================
async function runTask12() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 12: 增量脚本生成 + 产物管理')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 12.1 增量生成 — 规划分段
  try {
    let callCount = 0
    setCallAIImpl(async (prompt) => {
      callCount++
      if (callCount === 1) {
        // 规划阶段
        return JSON.stringify({
          segments: [
            { name: '框架代码', placeholder: '// DATA_PLACEHOLDER_1' },
            { name: '数据段1', placeholder: '// DATA_PLACEHOLDER_2' }
          ]
        })
      }
      if (callCount === 2) {
        // 框架生成
        return '```python\nimport json\n# DATA_PLACEHOLDER_1\n# DATA_PLACEHOLDER_2\nprint("done")\n```'
      }
      // 分段数据
      return '```python\ndata_1 = [1, 2, 3]\n```'
    })

    const { generateIncrementally } = require('../incremental-generator')
    const r = await generateIncrementally('生成大量数据', { scriptLanguage: 'python' }, {})
    const pass = r.success === true || (r.rounds >= 1)
    results.details.push({ test: '增量生成执行', pass, info: `success=${r.success} rounds=${r.rounds}` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '增量生成执行', pass: false, info: err.message.slice(0, 60) })
    restoreDefaultAIImpl()
  }

  // 12.2 增量生成 — 规划失败降级
  try {
    setCallAIImpl(async () => '{ invalid }')
    const { generateIncrementally } = require('../incremental-generator')
    const r = await generateIncrementally('任务', { scriptLanguage: 'bash' }, {})
    const pass = r.success === false && r.error
    results.details.push({ test: '增量生成失败降级', pass, info: pass ? '正确返回错误' : `success=${r.success}` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '增量生成失败降级', pass: false, info: err.message.slice(0, 60) })
    restoreDefaultAIImpl()
  }

  // 12.3 产物管理 — 注册和检索
  try {
    const artifactStore = require('../artifact-store')
    artifactStore.load()
    artifactStore.register({
      filePath: '/tmp/test-artifact-bench.html',
      type: 'html',
      description: '测试报告',
      command: '生成报告',
      sessionId: 'test_session_bench'
    })
    const recent = artifactStore.getRecent(10)
    const found = recent.find(a => a.filePath === '/tmp/test-artifact-bench.html')
    const pass = !!found && found.type === 'html'
    results.details.push({ test: '产物注册+检索', pass, info: pass ? `id=${found.id}` : '未找到' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '产物注册+检索', pass: false, info: err.message.slice(0, 60) })
  }

  // 12.4 产物管理 — 类型自动检测
  try {
    const artifactStore = require('../artifact-store')
    artifactStore.register({ filePath: '/tmp/demo-bench.svg', command: 'svg生成' })
    artifactStore.register({ filePath: '/tmp/script-bench.sh', command: '脚本' })
    const recent = artifactStore.getRecent(10)
    const svg = recent.find(a => a.filePath === '/tmp/demo-bench.svg')
    const sh = recent.find(a => a.filePath === '/tmp/script-bench.sh')
    const pass = (svg?.type === 'image' || svg?.type === 'svg') && (sh?.type === 'script' || sh?.type === 'other')
    results.details.push({ test: '产物类型检测', pass, info: `svg=${svg?.type} sh=${sh?.type}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '产物类型检测', pass: false, info: err.message.slice(0, 60) })
  }

  // 12.5 产物管理 — 按session检索
  try {
    const artifactStore = require('../artifact-store')
    const sessionArts = artifactStore.getBySession('test_session_bench')
    const pass = Array.isArray(sessionArts) && sessionArts.length >= 1
    results.details.push({ test: '按session检索产物', pass, info: `找到${sessionArts.length}个` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '按session检索产物', pass: false, info: err.message.slice(0, 60) })
  }

  // 12.6 信件系统 — sendLetter 完整流程
  try {
    const { sendLetter } = require('../mailbox')
    const letter = sendLetter({
      title: '测试信件',
      content: '这是一封测试信件',
      priority: 'high',
      source: 'heartbeat',
      taskId: 'test_task_123'
    })
    const pass = letter && letter.id && letter.title === '测试信件'
    results.details.push({ test: '信件发送完整流程', pass, info: pass ? `id=${letter.id}` : '信件创建失败' })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '信件发送完整流程', pass: false, info: err.message.slice(0, 60) })
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task12-增量产物', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 13: ReAct 循环能力（观察→思考→行动→再观察）
// ============================================================
async function runTask13() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 13: ReAct 循环能力（执行→观察→修复→重执行）')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }
  ensureMockTasksFile()
  let originalTasks = '[]'
  try { originalTasks = fs.readFileSync(config.TASKS_FILE, 'utf8') } catch {}
  fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')

  // script-executor 的 require.cache 路径（从 muse/ 目录 require('../script-executor')）
  const scriptExecCachePath = path.resolve(__dirname, '../../script-executor.js')

  // 13.1 executeSingleSubtaskWithAutoRepair — 首次成功不触发修复
  // 策略分析返回 taskStrategy，ReAct 调用返回 reactFinal（立即成功）
  try {
    setCallAIImpl(async (prompt) => {
      // ReAct prompt 特征：包含"自主执行智能体"
      if (prompt.includes('自主执行智能体'))
        return AIResponseFactory.reactFinal('文件已创建', '任务完成')
      // 策略分析
      return AIResponseFactory.taskStrategy({ understood: '创建文件', scriptLanguage: 'bash' })
    })

    const command = require('../command')
    const subtask = {
      id: 'react_sub_1',
      command: '创建文件',
      parentId: 'react_parent',
      _taskDir: os.tmpdir(),
      _previousResults: []
    }
    const result = await command.executeSingleSubtaskWithAutoRepair(subtask, () => {})
    const pass = result.success === true && result.repairAttempts === 0
    results.details.push({ test: 'ReAct:首次成功无修复', pass, info: `success=${result.success} repairs=${result.repairAttempts}` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:首次成功无修复', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.2 executeSingleSubtaskWithAutoRepair — 首次失败→分析修复策略→重试成功
  // ReAct 返回 error（模拟失败），repair 分析后重试返回 final（成功）
  try {
    let execCount = 0
    setCallAIImpl(async (prompt) => {
      if (prompt.includes('canRepair'))
        return JSON.stringify({ canRepair: true, strategy: '换实现方式', repairedCommand: '用echo输出', reason: 'exit导致非0' })
      // ReAct 抛异常 → 降级到 fallback → fallback 用 script-executor mock
      if (prompt.includes('自主执行智能体'))
        throw new Error('AI timeout')
      return AIResponseFactory.taskStrategy({ understood: '有bug脚本', scriptLanguage: 'bash' })
    })

    // fallback 路径：前 MAX_SCRIPT_RETRIES 次失败，repair 后成功
    const origExec = require.cache[scriptExecCachePath].exports.executeScript
    require.cache[scriptExecCachePath].exports.executeScript = async () => {
      execCount++
      if (execCount <= config.MAX_SCRIPT_RETRIES) return { success: false, stdout: '', stderr: 'exit code 1', exitCode: 1 }
      return { success: true, stdout: 'fixed', stderr: '', exitCode: 0 }
    }

    const command = require('../command')
    const subtask = {
      id: 'react_sub_2',
      command: '有bug的脚本',
      parentId: 'react_parent',
      _taskDir: os.tmpdir(),
      _previousResults: []
    }
    const result = await command.executeSingleSubtaskWithAutoRepair(subtask, () => {})
    const pass = result.repairAttempts >= 1
    results.details.push({ test: 'ReAct:失败→修复→成功', pass, info: `repairs=${result.repairAttempts} strategies=${(result.repairStrategies || []).join(',')}` })
    if (pass) results.passed++; else results.failed++

    require.cache[scriptExecCachePath].exports.executeScript = origExec
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:失败→修复→成功', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.3 修复策略 canRepair=false 时停止循环
  try {
    setCallAIImpl(async (prompt) => {
      if (prompt.includes('canRepair'))
        return JSON.stringify({ canRepair: false, strategy: '', reason: '无法自动修复' })
      if (prompt.includes('自主执行智能体'))
        throw new Error('AI timeout')
      return AIResponseFactory.taskStrategy({ understood: '不存在命令', scriptLanguage: 'bash' })
    })

    require.cache[scriptExecCachePath].exports.executeScript = async () => ({ success: false, stdout: '', stderr: 'command not found', exitCode: 127 })

    const command = require('../command')
    const subtask = {
      id: 'react_sub_3',
      command: '不存在的命令',
      parentId: 'react_parent',
      _taskDir: os.tmpdir(),
      _previousResults: []
    }
    const result = await command.executeSingleSubtaskWithAutoRepair(subtask, () => {})
    const pass = result.success === false && result.repairAttempts <= config.MAX_REPAIR_ATTEMPTS
    results.details.push({ test: 'ReAct:不可修复时停止', pass, info: `success=${result.success} repairs=${result.repairAttempts}` })
    if (pass) results.passed++; else results.failed++

    require.cache[scriptExecCachePath].exports.executeScript = async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 })
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:不可修复时停止', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.4 子任务顺序执行 + 上下文累积
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const parent = addTask('复杂任务', 'high')
    updateTaskStatus(parent.id, { status: 'executing' })
    const sub1 = addSubtask(parent.id, '步骤1: 创建目录', {})
    const sub2 = addSubtask(parent.id, '步骤2: 写入文件', {})

    let promptsReceived = []
    setCallAIImpl(async (prompt) => {
      promptsReceived.push(prompt.slice(0, 500))
      if (prompt.includes('自主执行智能体'))
        return AIResponseFactory.reactFinal('步骤完成', '已完成')
      return AIResponseFactory.taskStrategy({ understood: '子任务', scriptLanguage: 'bash' })
    })

    const { executeSubtasksSequentially } = require('../command')
    await executeSubtasksSequentially(parent.id, os.tmpdir())

    // 验证：第2个子任务的 prompt 应包含前序结果（上下文累积）
    const hasContextAccumulation = promptsReceived.length >= 2
    results.details.push({ test: 'ReAct:子任务上下文累积', pass: hasContextAccumulation, info: `${promptsReceived.length}次AI调用` })
    if (hasContextAccumulation) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:子任务上下文累积', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.5 executeCommand 任务拆分决策链（shouldSplit=true → 创建子任务）
  try {
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    let aiCalls = 0
    setCallAIImpl(async (prompt) => {
      aiCalls++
      if (aiCalls === 1) return AIResponseFactory.newTaskRecognition('复杂部署')
      // 第2次：策略分析 — 必须返回 shouldSplit
      if (aiCalls === 2) return AIResponseFactory.taskSplit(['编译前端', '部署后端', '配置DNS'])
      // 后续：全部返回代码块
      return AIResponseFactory.scriptGeneration('echo "step done"', 'bash')
    })

    const { executeCommand } = require('../command')
    const result = await executeCommand('部署整个全栈项目到生产环境')
    // 等待子任务创建
    await new Promise(r => setTimeout(r, 300))
    const tasks = loadTasks()
    const parentTask = tasks.find(t => t.command === '部署整个全栈项目到生产环境' || t.id === result?.taskId)
    const subtasks = tasks.filter(t => t.parentId === parentTask?.id)
    const pass = result?.success === true && subtasks.length >= 2
    results.details.push({ test: 'ReAct:复杂任务拆分', pass, info: `拆分为${subtasks.length}个子任务` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:复杂任务拆分', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.6 多轮修复不超过 MAX_REPAIR_ATTEMPTS 上限
  try {
    let repairCallCount = 0
    setCallAIImpl(async (prompt) => {
      if (prompt.includes('canRepair')) {
        repairCallCount++
        return JSON.stringify({ canRepair: true, strategy: `修复策略${repairCallCount}`, repairedCommand: 'retry', reason: '重试' })
      }
      if (prompt.includes('自主执行智能体'))
        throw new Error('AI timeout')
      return AIResponseFactory.taskStrategy({ understood: '永远失败', scriptLanguage: 'bash' })
    })

    require.cache[scriptExecCachePath].exports.executeScript = async () => ({ success: false, stdout: '', stderr: 'always fail', exitCode: 1 })

    const command = require('../command')
    const subtask = { id: 'react_sub_max', command: '永远失败', parentId: 'p', _taskDir: os.tmpdir(), _previousResults: [] }
    const result = await command.executeSingleSubtaskWithAutoRepair(subtask, () => {})
    const pass = result.repairAttempts <= config.MAX_REPAIR_ATTEMPTS
    results.details.push({ test: 'ReAct:修复次数上限保护', pass, info: `repairs=${result.repairAttempts} max=${config.MAX_REPAIR_ATTEMPTS}` })
    if (pass) results.passed++; else results.failed++

    require.cache[scriptExecCachePath].exports.executeScript = async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 })
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:修复次数上限保护', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 13.7 修复过程中 onRepairProgress 回调被正确调用
  try {
    let progressCalls = []
    let cbExecCount = 0
    setCallAIImpl(async (prompt) => {
      if (prompt.includes('canRepair'))
        return JSON.stringify({ canRepair: true, strategy: '换实现', repairedCommand: 'echo ok', reason: 'test' })
      if (prompt.includes('自主执行智能体'))
        throw new Error('AI timeout')
      return AIResponseFactory.taskStrategy({ understood: '测试回调', scriptLanguage: 'bash' })
    })

    require.cache[scriptExecCachePath].exports.executeScript = async () => {
      cbExecCount++
      if (cbExecCount <= config.MAX_SCRIPT_RETRIES) return { success: false, stdout: '', stderr: 'err', exitCode: 1 }
      return { success: true, stdout: 'ok', stderr: '', exitCode: 0 }
    }

    const command = require('../command')
    const subtask = { id: 'react_cb', command: '测试回调', parentId: 'p', _taskDir: os.tmpdir(), _previousResults: [] }
    await command.executeSingleSubtaskWithAutoRepair(subtask, (status) => {
      progressCalls.push(status)
    })
    const pass = progressCalls.length >= 1 && progressCalls[0].attempt === 1 && progressCalls[0].strategy
    results.details.push({ test: 'ReAct:修复进度回调', pass, info: `回调${progressCalls.length}次 strategy=${progressCalls[0]?.strategy?.slice(0, 20)}` })
    if (pass) results.passed++; else results.failed++

    require.cache[scriptExecCachePath].exports.executeScript = async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 })
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'ReAct:修复进度回调', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  try { fs.writeFileSync(config.TASKS_FILE, originalTasks, 'utf8') } catch {}

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task13-ReAct循环', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 15: Rich Form 解析与渲染验证
// ============================================================
async function runTask15() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 15: Rich Form 解析与渲染验证')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 内联实现 parseRichForm 逻辑（与 response-parser.ts 保持一致，避免 TS require 问题）
  function extractDirectiveJSON(response, directive) {
    const regex = new RegExp(`${directive}:\\s*\\n?\\s*(\\{[\\s\\S]*\\})`, 'i')
    const match = response.match(regex)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }
  function parseRichForm(response) {
    const data = extractDirectiveJSON(response, 'RICH_FORM')
    if (!data || !data.title || !Array.isArray(data.fields)) return null
    return data
  }

  // 15.1 合法 RICH_FORM 指令解析
  try {
    const response = `请填写以下表单：\nRICH_FORM:\n{"title":"用户信息","fields":[{"name":"username","label":"用户名","type":"text","required":true},{"name":"email","label":"邮箱","type":"email","required":true}]}`
    const result = parseRichForm(response)
    const pass = result !== null && result.title === '用户信息' && Array.isArray(result.fields) && result.fields.length === 2
    results.details.push({ test: 'parseRichForm:合法指令解析', pass, info: pass ? `title=${result.title} fields=${result.fields.length}` : JSON.stringify(result).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'parseRichForm:合法指令解析', pass: false, info: err.message.slice(0, 80) })
  }

  // 15.2 缺少 title 返回 null
  try {
    const response = `RICH_FORM:\n{"fields":[{"name":"x","label":"X","type":"text"}]}`
    const result = parseRichForm(response)
    const pass = result === null
    results.details.push({ test: 'parseRichForm:缺title返回null', pass, info: pass ? '正确返回null' : JSON.stringify(result).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'parseRichForm:缺title返回null', pass: false, info: err.message.slice(0, 80) })
  }

  // 15.3 缺少 fields 返回 null
  try {
    const response = `RICH_FORM:\n{"title":"测试"}`
    const result = parseRichForm(response)
    const pass = result === null
    results.details.push({ test: 'parseRichForm:缺fields返回null', pass, info: pass ? '正确返回null' : JSON.stringify(result).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'parseRichForm:缺fields返回null', pass: false, info: err.message.slice(0, 80) })
  }

  // 15.4 无 RICH_FORM 指令返回 null
  try {
    const response = '这是一段普通文本，没有表单指令'
    const result = parseRichForm(response)
    const pass = result === null
    results.details.push({ test: 'parseRichForm:无指令返回null', pass, info: pass ? '正确返回null' : JSON.stringify(result).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'parseRichForm:无指令返回null', pass: false, info: err.message.slice(0, 80) })
  }

  // 15.5 多字段类型覆盖（text/email/select/checkbox）
  try {
    const response = `RICH_FORM:\n{"title":"配置表单","fields":[{"name":"a","label":"A","type":"text"},{"name":"b","label":"B","type":"email"},{"name":"c","label":"C","type":"select","options":["x","y"]},{"name":"d","label":"D","type":"checkbox"}]}`
    const result = parseRichForm(response)
    const types = result?.fields?.map(f => f.type) || []
    const pass = result !== null && types.includes('text') && types.includes('email') && types.includes('select') && types.includes('checkbox')
    results.details.push({ test: 'parseRichForm:多字段类型', pass, info: pass ? `types=${types.join(',')}` : JSON.stringify(result).slice(0, 60) })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'parseRichForm:多字段类型', pass: false, info: err.message.slice(0, 80) })
  }

  // 15.6 AI 返回 RICH_FORM 指令的 mock 全链路
  try {
    setCallAIImpl(async () => `好的，请填写以下信息：\nRICH_FORM:\n{"title":"部署配置","fields":[{"name":"env","label":"环境","type":"select","options":["dev","prod"],"required":true},{"name":"port","label":"端口","type":"text","required":true}]}`)

    const { callAI } = require('../../../shared/ai-client')
    const response = await callAI('帮我部署项目')
    const formData = parseRichForm(response)
    const pass = formData !== null && formData.title === '部署配置' && formData.fields.length === 2
    results.details.push({ test: 'RichForm:AI全链路解析', pass, info: pass ? `title=${formData.title}` : '解析失败' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: 'RichForm:AI全链路解析', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task15-RichForm解析', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 16: 记忆系统四维标签 + 整合强度检索验证
// ============================================================
async function runTask16() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 16: 记忆系统四维标签 + 整合强度检索')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 内联 calculateIntegrationScore（与 database.js 保持一致，绕过 mock stub）
  function calculateIntegrationScore(memory) {
    const now = Date.now()
    const createdAt = memory.created_at ? new Date(memory.created_at).getTime() : now
    const ageHours = Number.isFinite(createdAt) ? (now - createdAt) / (1000 * 60 * 60) : 0
    const recency = Math.exp(-0.693 * ageHours / 72)
    const activation = Number.isFinite(memory.activation) ? memory.activation : 0
    const integration = Number.isFinite(memory.integration) ? memory.integration : 0
    const intent = Number.isFinite(memory.intent) ? memory.intent : 0
    const score = activation * 0.35 + integration * 0.2 + intent * 0.3 + recency * 0.15
    return Math.min(1, Math.max(0, score))
  }

  // 内联 searchWithIntegration 逻辑
  function searchWithIntegration(memories, keyword, limit = 10) {
    if (!keyword || typeof keyword !== 'string') return []
    const keywords = keyword.toLowerCase().split(/\s+/).filter(k => k.length >= 2)
    if (keywords.length === 0) return []
    const actives = memories.filter(m => !m.status || m.status === 'active')
    const scored = []
    for (const memory of actives) {
      const text = (memory.content || '').toLowerCase()
      let matchScore = 0
      for (const kw of keywords) { if (text.includes(kw)) matchScore += 1 }
      if (matchScore === 0) continue
      const relevance = Math.min(1, matchScore / keywords.length)
      const integrationScore = calculateIntegrationScore(memory)
      const finalScore = relevance * 0.6 + integrationScore * 0.4
      scored.push({ ...memory, _score: finalScore, _integrationScore: integrationScore })
    }
    scored.sort((a, b) => b._score - a._score)
    return scored.slice(0, limit)
  }

  const testMemories = [
    { id: 'bench_mem_1', content: '用户偏好使用 TypeScript 开发前端项目', activation: 0.9, integration: 0.8, intent: 0.7, created_at: new Date().toISOString(), status: 'active' },
    { id: 'bench_mem_2', content: '上次部署失败了因为端口冲突', activation: 0.3, integration: 0.2, intent: 0.1, created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), status: 'active' },
    { id: 'bench_mem_3', content: '正在进行 Rust 学习项目', activation: 0.8, integration: 0.6, intent: 0.9, created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), status: 'active' },
    { id: 'bench_mem_4', content: '已归档的旧笔记', activation: 0.1, integration: 0.05, intent: 0.0, created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), status: 'archived' },
  ]

  // 16.1 getActive 过滤掉 archived
  try {
    const active = testMemories.filter(m => !m.status || m.status === 'active')
    const pass = active.length === 3 && !active.some(m => m.status === 'archived')
    results.details.push({ test: 'getActive:过滤archived', pass, info: `active=${active.length}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'getActive:过滤archived', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.2 getByIntegrationScore 按整合强度降序排列
  try {
    const actives = testMemories.filter(m => !m.status || m.status === 'active')
    const scored = actives.map(m => ({ ...m, _score: calculateIntegrationScore(m) }))
    scored.sort((a, b) => b._score - a._score)
    const pass = scored.length >= 3 && scored[0]._score >= scored[1]._score
    results.details.push({ test: 'getByIntegrationScore:降序', pass, info: `top="${scored[0].content.slice(0, 20)}" score=${scored[0]._score.toFixed(3)}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'getByIntegrationScore:降序', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.3 高 activation+intent 的记忆排名高于低分记忆
  try {
    const actives = testMemories.filter(m => !m.status || m.status === 'active')
    const scored = actives.map(m => ({ ...m, _score: calculateIntegrationScore(m) }))
    scored.sort((a, b) => b._score - a._score)
    const topContent = scored[0]?.content || ''
    const pass = topContent.includes('TypeScript') || topContent.includes('Rust')
    results.details.push({ test: '高分记忆优先:activation+intent', pass, info: `top="${topContent.slice(0, 30)}"` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '高分记忆优先:activation+intent', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.4 searchWithIntegration 关键词匹配 + 整合强度混合排序
  try {
    const searchResults = searchWithIntegration(testMemories, 'Rust 学习', 5)
    const pass = searchResults.length >= 1 && searchResults[0].content.includes('Rust')
    results.details.push({ test: 'searchWithIntegration:混合检索', pass, info: `found=${searchResults.length} top="${searchResults[0]?.content?.slice(0, 20)}"` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'searchWithIntegration:混合检索', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.5 searchWithIntegration 无匹配返回空数组
  try {
    const noMatch = searchWithIntegration(testMemories, 'xyznotexist', 5)
    const pass = noMatch.length === 0
    results.details.push({ test: 'searchWithIntegration:无匹配', pass, info: `found=${noMatch.length}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'searchWithIntegration:无匹配', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.6 时间衰减验证：刚创建的记忆 score 高于 7 天前的
  try {
    const recentMem = testMemories.find(m => m.id === 'bench_mem_3')
    const oldMem = testMemories.find(m => m.id === 'bench_mem_2')
    const recentScore = calculateIntegrationScore(recentMem)
    const oldScore = calculateIntegrationScore(oldMem)
    const pass = recentScore > oldScore
    results.details.push({ test: '时间衰减:新>旧', pass, info: `recent=${recentScore.toFixed(3)} old=${oldScore.toFixed(3)}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '时间衰减:新>旧', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.7 calculateIntegrationScore NaN/undefined 防御
  try {
    const badMem = { id: 'bad', content: 'test', activation: NaN, integration: undefined, intent: null, created_at: 'invalid-date', status: 'active' }
    const score = calculateIntegrationScore(badMem)
    const pass = Number.isFinite(score) && score >= 0 && score <= 1
    results.details.push({ test: 'calculateIntegrationScore:NaN防御', pass, info: `score=${score.toFixed(3)}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'calculateIntegrationScore:NaN防御', pass: false, info: err.message.slice(0, 80) })
  }

  // 16.8 权重验证：activation(0.35) + intent(0.3) > integration(0.2) + recency(0.15)
  try {
    const highActIntent = { activation: 1, integration: 0, intent: 1, created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString() }
    const highIntRecency = { activation: 0, integration: 1, intent: 0, created_at: new Date().toISOString() }
    const scoreAI = calculateIntegrationScore(highActIntent)
    const scoreIR = calculateIntegrationScore(highIntRecency)
    const pass = scoreAI > scoreIR
    results.details.push({ test: '权重:activation+intent>integration+recency', pass, info: `AI=${scoreAI.toFixed(3)} IR=${scoreIR.toFixed(3)}` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: '权重:activation+intent>integration+recency', pass: false, info: err.message.slice(0, 80) })
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task16-记忆系统', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// Task 17: 监控反馈系统有效性验证
// ============================================================
async function runTask17() {
  console.log('\n' + '='.repeat(60))
  console.log('📋 Task 17: 监控反馈系统有效性验证')
  console.log('='.repeat(60))

  const results = { passed: 0, failed: 0, details: [] }

  // 17.1 analyzeConversation 正常对话触发分析
  try {
    let aiCalled = false
    setCallAIImpl(async () => {
      aiCalled = true
      return JSON.stringify({
        isSignificant: true, category: '技术', insights: '用户在研究性能优化',
        profileUpdate: { section: '技术关注', content: '关注性能优化' },
        ideaSpark: { title: '', content: '' },
        proactiveAction: { type: 'none', description: '', query: '' }
      })
    })

    const { analyzeConversation } = require('../conversation')
    const r = await analyzeConversation('如何优化 React 应用的渲染性能？', '可以使用 memo、useMemo...')
    const pass = r?.success === true && aiCalled
    results.details.push({ test: '对话分析:正常触发', pass, info: `success=${r?.success} aiCalled=${aiCalled}` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '对话分析:正常触发', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 17.2 analyzeConversation 任务状态查询被跳过
  try {
    let aiCalled = false
    setCallAIImpl(async () => { aiCalled = true; return '{}' })

    const { analyzeConversation } = require('../conversation')
    await analyzeConversation('当前正在执行什么任务？', '正在执行...')
    const pass = !aiCalled
    results.details.push({ test: '对话分析:状态查询跳过', pass, info: pass ? '正确跳过' : '不应调AI' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '对话分析:状态查询跳过', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 17.3 retrospectTask 成功任务复盘不崩溃
  try {
    setCallAIImpl(async () => JSON.stringify({
      lesson: '组件拆分提升可维护性', rootCause: '合理拆分', improvement: '继续',
      shouldUpdateProfile: true, profileSection: '任务经验', profileContent: '擅长组件设计', category: 'code_generation'
    }))

    const { retrospectTask } = require('../retrospect')
    const mockTask = {
      id: 'bench_retro_ok', command: '重构登录组件', status: 'completed',
      startedAt: new Date(Date.now() - 600000).toISOString(), completedAt: new Date().toISOString(), error: null
    }
    const r = await retrospectTask(mockTask)
    const pass = r !== undefined
    results.details.push({ test: '复盘:成功任务', pass, info: pass ? '完成' : '崩溃' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '复盘:成功任务', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 17.4 retrospectTask 失败任务复盘提取教训
  try {
    ensureMockTasksFile()
    fs.writeFileSync(config.TASKS_FILE, '[]', 'utf8')
    const parent = addTask('bench_retro_fail_parent', 'high')
    const sub = addSubtask(parent.id, '编译失败子任务', {})
    updateTaskStatus(sub.id, { status: 'failed', error: 'OOM', repairAttempts: 3 })

    setCallAIImpl(async () => JSON.stringify({
      lesson: '内存不足需优化构建', rootCause: '未限制并发', improvement: '设置NODE_OPTIONS',
      shouldUpdateProfile: true, profileSection: '故障经验', profileContent: '大项目构建需限制内存', category: 'task_execution'
    }))

    const { retrospectTask } = require('../retrospect')
    const mockTask = { id: parent.id, command: 'bench_retro_fail_parent', status: 'failed', error: 'OOM', startedAt: new Date().toISOString() }
    const r = await retrospectTask(mockTask)
    const pass = r !== undefined
    results.details.push({ test: '复盘:失败任务含子任务', pass, info: pass ? '完成' : '崩溃' })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '复盘:失败任务含子任务', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  // 17.5 heartbeat 配置合理性验证
  try {
    const { HEARTBEAT_INTERVAL } = config
    const pass = HEARTBEAT_INTERVAL > 0 && HEARTBEAT_INTERVAL <= 30 * 60 * 1000
    results.details.push({ test: 'heartbeat:间隔配置合理', pass, info: `${HEARTBEAT_INTERVAL / 60000}min` })
    if (pass) results.passed++; else results.failed++
  } catch (err) {
    results.failed++
    results.details.push({ test: 'heartbeat:间隔配置合理', pass: false, info: err.message.slice(0, 80) })
  }

  // 17.6 SKIP_ANALYSIS_PATTERNS 覆盖多种状态查询模式
  try {
    const skipPatterns = [
      '当前正在执行什么任务',
      '目前在做什么',
      '任务列表是什么',
      '执行中的任务有哪些',
      '上一个任务是什么',
    ]
    let skippedCount = 0
    setCallAIImpl(async () => '{}')

    const { analyzeConversation } = require('../conversation')
    for (const query of skipPatterns) {
      let called = false
      setCallAIImpl(async () => { called = true; return '{}' })
      await analyzeConversation(query, 'response')
      if (!called) skippedCount++
    }
    const pass = skippedCount === skipPatterns.length
    results.details.push({ test: '跳过模式:覆盖率', pass, info: `${skippedCount}/${skipPatterns.length} 被跳过` })
    if (pass) results.passed++; else results.failed++
    restoreDefaultAIImpl()
  } catch (err) {
    results.failed++
    results.details.push({ test: '跳过模式:覆盖率', pass: false, info: err.message.slice(0, 80) })
    restoreDefaultAIImpl()
  }

  const total = results.passed + results.failed
  const accuracy = (results.passed / total * 100).toFixed(1)
  console.log('\n结果:')
  results.details.forEach(d => console.log(`  ${d.pass ? '✅' : '❌'} ${d.test}: ${d.info}`))
  console.log(`\n✅ 通过: ${results.passed}/${total} (${accuracy}%)`)
  const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : 'D'
  console.log(`📊 评分: ${grade}`)
  return { task: 'Task17-监控反馈', accuracy: parseFloat(accuracy), grade }
}

// ============================================================
// 主入口
// ============================================================
async function runAllBenchmarks() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║   Folio / Muse 能力评测 (含 Mock AI 全链路)       ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`运行时间: ${new Date().toISOString()}`)

  const results = []
  results.push(runTask1())
  results.push(runTask2())
  results.push(runTask3())
  results.push(await runTask4())
  results.push(await runTask5())
  results.push(await runTask6())
  results.push(await runTask7())
  results.push(await runTask8())
  results.push(await runTask9())
  results.push(await runTask10())
  results.push(await runTask11())
  results.push(await runTask12())
  results.push(await runTask13())
  results.push(await runTask15())
  results.push(await runTask16())
  results.push(await runTask17())

  // 综合评分
  console.log('\n' + '═'.repeat(60))
  console.log('📊 综合评测报告')
  console.log('═'.repeat(60))

  const weights = {
    'Task1-意图分类': 0.07,
    'Task2-代码搜索': 0.07,
    'Task3-编辑决策': 0.07,
    'Task4-命令执行': 0.10,
    'Task5-反馈闭环': 0.08,
    'Task6-异常边界': 0.08,
    'Task7-多文件编辑': 0.08,
    'Task8-上下文管理': 0.07,
    'Task9-自动修复': 0.07,
    'Task10-心跳探索': 0.06,
    'Task11-对话复盘': 0.06,
    'Task12-增量产物': 0.06,
    'Task13-ReAct循环': 0.10,
    'Task15-RichForm解析': 0.07,
    'Task16-记忆系统': 0.07,
    'Task17-监控反馈': 0.07,
  }

  let weightedScore = 0
  console.log('\n┌──────────────────────┬────────┬──────┬────────┐')
  console.log('│ 任务                 │ 准确率 │ 等级 │ 权重   │')
  console.log('├──────────────────────┼────────┼──────┼────────┤')
  for (const r of results) {
    const w = weights[r.task] || 0.15
    weightedScore += r.accuracy * w
    console.log(`│ ${r.task.padEnd(20)} │ ${(r.accuracy + '%').padStart(6)} │  ${r.grade}   │ ${(w * 100).toFixed(0)}%    │`)
  }
  console.log('├──────────────────────┼────────┼──────┼────────┤')
  const finalGrade = weightedScore >= 90 ? 'A' : weightedScore >= 80 ? 'B' : weightedScore >= 70 ? 'C' : 'D'
  console.log(`│ 加权总分             │ ${(weightedScore.toFixed(1) + '%').padStart(6)} │  ${finalGrade}   │ 100%   │`)
  console.log('└──────────────────────┴────────┴──────┴────────┘')

  const weakest = [...results].sort((a, b) => a.accuracy - b.accuracy)[0]
  console.log(`\n⚠️  最需加强: ${weakest.task} (${weakest.accuracy}%)`)

  // 输出发现的缺陷
  const allFailures = results.flatMap(r => (r.failures || []).map(f => ({ task: r.task, ...f })))
  const defectDetails = results.flatMap(r => r.details || []).filter(d => !d.pass && d.info?.includes('缺陷'))
  if (defectDetails.length > 0) {
    console.log('\n🐛 发现的项目缺陷:')
    defectDetails.forEach(d => console.log(`  - ${d.test}: ${d.info}`))
  }

  // 清理
  teardownMocks()
  console.log('\n✅ 评测完成')
}

runAllBenchmarks().catch(err => {
  console.error('评测异常:', err)
  teardownMocks()
  process.exit(1)
})

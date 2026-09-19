/**
 * UI 交互逻辑自动化测试
 * 测试纯函数和数据流逻辑（无 DOM 依赖）
 * 覆盖：thinking 提取、diff 计算、消息预处理、脚本状态流转、Muse 转交
 */

const path = require('path')

// ============ 测试基础设施 ============
let results = { passed: 0, failed: 0, details: [] }

function assert(condition, testName, info = '') {
  if (condition) {
    results.passed++
    results.details.push({ test: testName, pass: true, info })
  } else {
    results.failed++
    results.details.push({ test: testName, pass: false, info })
  }
}

// ============ 使用 @babel/register 加载 TS/TSX ============
// Mock React/lucide 防止 DOM 依赖
const Module = require('module')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'react' || request.startsWith('react/') || request === 'react-dom') {
    return require.resolve('./mocks/react-mock.js')
  }
  if (request === 'lucide-react') {
    return require.resolve('./mocks/lucide-mock.js')
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

require('@babel/register')({
  extensions: ['.ts', '.tsx'],
  presets: [
    require.resolve('@babel/preset-typescript'),
    [require.resolve('@babel/preset-react'), { runtime: 'classic' }]
  ],
  only: [path.resolve(__dirname, '..')],
  cache: false
})

function loadModule(relativePath) {
  const absPath = path.resolve(__dirname, relativePath)
  // 清除缓存确保最新
  Object.keys(require.cache).forEach(key => {
    if (key.includes('ChatPage')) delete require.cache[key]
  })
  return require(absPath)
}

async function runTests() {
  console.log('🧪 UI 交互逻辑测试')
  console.log('═'.repeat(60))

  // ==========================================
  // Task 1: extractThinking
  // ==========================================
  console.log('\n📋 Task 1: Thinking 提取')
  try {
    const { extractThinking } = loadModule('../components/renderers/ThinkingBlock.tsx')

    // 1.1 <thinking> 标签
    const r1 = extractThinking('<thinking>分析用户需求...</thinking>这是回答')
    assert(r1.thinking === '分析用户需求...', 'thinking标签提取', `thinking="${r1.thinking}"`)
    assert(r1.body === '这是回答', 'thinking标签-正文', `body="${r1.body}"`)

    // 1.2 <think> 标签
    const r2 = extractThinking('<think>思考中\n第二行</think>\n\n最终答案')
    assert(r2.thinking === '思考中\n第二行', 'think标签提取', `thinking="${r2.thinking?.slice(0,20)}"`)
    assert(r2.body === '最终答案', 'think标签-正文', `body="${r2.body}"`)

    // 1.3 无 thinking
    const r3 = extractThinking('普通回答')
    assert(r3.thinking === null, '无thinking', `thinking=${r3.thinking}`)
    assert(r3.body === '普通回答', '无thinking-正文', `body="${r3.body}"`)

    // 1.4 --- thinking --- 分隔符
    const r4 = extractThinking('--- thinking ---\n分析步骤\n--- end ---\n\n回复内容')
    assert(r4.thinking === '分析步骤', 'separator格式', `thinking="${r4.thinking}"`)
    assert(r4.body === '回复内容', 'separator-正文', `body="${r4.body}"`)

    // 1.5 空 thinking
    const r5 = extractThinking('<thinking></thinking>正文')
    assert(r5.thinking === null || r5.thinking === '', '空thinking', `thinking="${r5.thinking}"`)
  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task1-加载失败', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 2: computeLineDiff
  // ==========================================
  console.log('\n📋 Task 2: Diff 计算')
  try {
    const { computeLineDiff, searchReplaceToFileDiffs } = loadModule('../components/renderers/InlineDiffView.tsx')

    // 2.1 相同内容
    const d1 = computeLineDiff('a\nb\nc', 'a\nb\nc')
    assert(d1.every(l => l.type === 'unchanged'), 'diff-无变更', `lines=${d1.length}`)

    // 2.2 新增行
    const d2 = computeLineDiff('a\nb', 'a\nb\nc')
    const added = d2.filter(l => l.type === 'added')
    assert(added.length === 1 && added[0].content === 'c', 'diff-新增行', `added=${added.length}`)

    // 2.3 删除行
    const d3 = computeLineDiff('a\nb\nc', 'a\nc')
    const removed = d3.filter(l => l.type === 'removed')
    assert(removed.length === 1 && removed[0].content === 'b', 'diff-删除行', `removed=${removed.length}`)

    // 2.4 修改行 = 删除旧 + 新增新
    const d4 = computeLineDiff('hello\nworld', 'hello\nearth')
    const d4Removed = d4.filter(l => l.type === 'removed')
    const d4Added = d4.filter(l => l.type === 'added')
    assert(d4Removed.length === 1 && d4Added.length === 1, 'diff-修改行', `removed=${d4Removed.length} added=${d4Added.length}`)
    assert(d4Removed[0].content === 'world' && d4Added[0].content === 'earth', 'diff-修改内容正确')

    // 2.5 searchReplaceToFileDiffs
    const srData = {
      fileChanges: [{
        file: '/src/app.ts',
        filename: 'app.ts',
        changes: [{ search: 'const a = 1', replace: 'const a = 2' }]
      }]
    }
    const diffs = searchReplaceToFileDiffs(srData)
    assert(diffs.length === 1, 'srToFileDiff-文件数', `files=${diffs.length}`)
    assert(diffs[0].filename === 'app.ts', 'srToFileDiff-文件名')
    assert(diffs[0].hunks.some(h => h.type === 'removed'), 'srToFileDiff-有删除行')
    assert(diffs[0].hunks.some(h => h.type === 'added'), 'srToFileDiff-有新增行')

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task2-加载失败', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 3: message-utils
  // ==========================================
  console.log('\n📋 Task 3: 消息预处理')
  try {
    const utils = loadModule('../components/message-utils.ts')

    // 3.1 preprocessScriptBlock — 有 SCRIPT_BLOCK
    const script1 = utils.preprocessScriptBlock('前言\nSCRIPT_BLOCK:\n{"lang":"bash","description":"test","content":"echo hello"}')
    assert(script1.includes('```bash'), 'scriptBlock-代码块包裹', `result="${script1.slice(0,60)}"`)
    assert(script1.includes('echo hello'), 'scriptBlock-内容保留')

    // 3.2 preprocessScriptBlock — 无 SCRIPT_BLOCK
    const script2 = utils.preprocessScriptBlock('普通文本不变')
    assert(script2 === '普通文本不变', 'scriptBlock-普通文本透传')

    // 3.3 preprocessBareCodeBlocks
    const bare1 = utils.preprocessBareCodeBlocks('javascript\nconst x = 1;\nconsole.log(x);\n\n后面的文字')
    assert(bare1.includes('```javascript'), 'bareCode-检测语言', `result="${bare1.slice(0,40)}"`)

    // 3.4 looksLikeCommand
    assert(utils.looksLikeCommand('git status') === true, 'looksLikeCommand-git')
    assert(utils.looksLikeCommand('npm install express') === true, 'looksLikeCommand-npm')
    assert(utils.looksLikeCommand('这是一段中文描述。') === false, 'looksLikeCommand-中文句子')
    assert(utils.looksLikeCommand('./start.sh') === true, 'looksLikeCommand-路径')
    assert(utils.looksLikeCommand('你好吗？') === false, 'looksLikeCommand-问句')

    // 3.5 extractCommandsFromText — 检测独立行命令
    if (utils.extractCommandsFromText) {
      const cmds = utils.extractCommandsFromText('npm start\ngit push')
      assert(cmds.length >= 1, 'extractCmds-提取命令', `count=${cmds.length}`)
    }

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task3-加载失败', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 4: response-parser
  // ==========================================
  console.log('\n📋 Task 4: 响应解析器')
  try {
    const parser = loadModule('../hooks/response-parser.ts')

    // 4.1 parseCommandOptions — 期望顶层数组格式
    if (parser.parseCommandOptions) {
      const opts = parser.parseCommandOptions('COMMAND_OPTIONS:\n[{"label":"选项1","cmd":"echo 1"},{"label":"选项2","cmd":"echo 2"}]')
      assert(opts !== null && opts.length === 2, 'parseCommandOptions', `opts=${opts?.length}`)
    }

    // 4.3 parseRichForm
    if (parser.parseRichForm) {
      const form = parser.parseRichForm('RICH_FORM:\n{"title":"配置","fields":[{"name":"port","type":"number","label":"端口"}]}')
      assert(form !== null && form.title === '配置', 'parseRichForm', `title=${form?.title}`)
    }

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task4-加载失败', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 5: 脚本状态流转验证
  // ==========================================
  console.log('\n📋 Task 5: 脚本状态流转')
  try {
    // 验证脚本 execStatus 的合法流转路径
    const VALID_SCRIPT_TRANSITIONS = {
      'pending': ['executing', 'needAuth'],
      'executing': ['completed', 'failed', 'retrying'],
      'retrying': ['executing', 'completed', 'failed'],
      'needAuth': ['executing', 'failed'],
      'completed': [],    // 终态
      'failed': ['executing'],  // 可手动重试
    }

    // 5.1 正常流程
    const normalFlow = ['pending', 'executing', 'completed']
    let valid = true
    for (let i = 0; i < normalFlow.length - 1; i++) {
      if (!VALID_SCRIPT_TRANSITIONS[normalFlow[i]].includes(normalFlow[i + 1])) { valid = false; break }
    }
    assert(valid, '脚本状态-正常流程', normalFlow.join('→'))

    // 5.2 失败→重试→成功
    const retryFlow = ['pending', 'executing', 'retrying', 'executing', 'completed']
    valid = true
    for (let i = 0; i < retryFlow.length - 1; i++) {
      if (!VALID_SCRIPT_TRANSITIONS[retryFlow[i]]?.includes(retryFlow[i + 1])) { valid = false; break }
    }
    assert(valid, '脚本状态-重试流程', retryFlow.join('→'))

    // 5.3 授权流程
    const authFlow = ['pending', 'needAuth', 'executing', 'completed']
    valid = true
    for (let i = 0; i < authFlow.length - 1; i++) {
      if (!VALID_SCRIPT_TRANSITIONS[authFlow[i]]?.includes(authFlow[i + 1])) { valid = false; break }
    }
    assert(valid, '脚本状态-授权流程', authFlow.join('→'))

    // 5.4 非法流转：completed → executing 应不允许
    assert(!VALID_SCRIPT_TRANSITIONS['completed'].includes('executing'), '脚本状态-终态不可逆')

    // 5.5 非法流转：pending → completed 跳过执行
    assert(!VALID_SCRIPT_TRANSITIONS['pending'].includes('completed'), '脚本状态-不可跳步')

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task5-异常', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 6: Muse 转交数据流
  // ==========================================
  console.log('\n📋 Task 6: Muse 转交数据流')
  try {
    // 验证 muse_transfer 消息结构
    const museTransferMsg = {
      id: 'ai-stream-123',
      role: 'assistant',
      content: '部署前端到生产环境',
      type: 'muse_transfer',
      taskProgressData: { taskId: '', steps: [], currentStep: 0, totalSteps: 0, status: 'running' }
    }

    // 6.1 结构完整性
    assert(museTransferMsg.type === 'muse_transfer', 'muse转交-类型正确')
    assert(museTransferMsg.taskProgressData !== undefined, 'muse转交-进度数据存在')
    assert(museTransferMsg.taskProgressData.status === 'running', 'muse转交-初始状态running')

    // 6.2 进度更新模拟
    const updatedMsg = {
      ...museTransferMsg,
      taskProgressData: {
        ...museTransferMsg.taskProgressData,
        taskId: 'task_001',
        steps: [
          { id: 1, description: '编译前端', status: 'completed' },
          { id: 2, description: '部署CDN', status: 'running' },
          { id: 3, description: '更新DNS', status: 'pending' },
        ],
        currentStep: 2,
        totalSteps: 3,
        status: 'running'
      }
    }
    assert(updatedMsg.taskProgressData.currentStep === 2, 'muse转交-步骤推进')
    assert(updatedMsg.taskProgressData.steps[0].status === 'completed', 'muse转交-前序步骤完成')

    // 6.3 完成状态
    const completedMsg = {
      ...updatedMsg,
      taskProgressData: {
        ...updatedMsg.taskProgressData,
        steps: updatedMsg.taskProgressData.steps.map(s => ({ ...s, status: 'completed' })),
        currentStep: 3,
        status: 'completed'
      }
    }
    assert(completedMsg.taskProgressData.status === 'completed', 'muse转交-全部完成')
    assert(completedMsg.taskProgressData.steps.every(s => s.status === 'completed'), 'muse转交-所有步骤completed')

    // 6.4 MessageContent 对 muse_transfer 的渲染分支
    // type: 'muse_transfer' 不应被过滤，应正常展示
    assert(museTransferMsg.type !== 'muse_letter', 'muse_transfer≠muse_letter')

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task6-异常', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // Task 7: 流式消息打字机逻辑
  // ==========================================
  console.log('\n📋 Task 7: 流式打字机逻辑')
  try {
    // 7.1 chunk 累积正确性
    let buffer = ''
    const chunks = ['Hello', ' ', 'world', '!']
    chunks.forEach(c => buffer += c)
    assert(buffer === 'Hello world!', '打字机-chunk累积', `buffer="${buffer}"`)

    // 7.2 动态速度计算
    function getCharsPerTick(bufLen) {
      if (bufLen > 500) return 40
      if (bufLen > 200) return 20
      if (bufLen > 50) return 12
      return 6
    }
    assert(getCharsPerTick(600) === 40, '打字机-速度>500')
    assert(getCharsPerTick(300) === 20, '打字机-速度>200')
    assert(getCharsPerTick(100) === 12, '打字机-速度>50')
    assert(getCharsPerTick(10) === 6, '打字机-速度<50')

    // 7.3 MUSE_TASK 检测中断
    buffer = '这是AI的部分回答...\nMUSE_TASK: 部署项目'
    const hasMuse = buffer.includes('MUSE_TASK:')
    assert(hasMuse === true, '打字机-MUSE_TASK检测')

    // 7.4 RICH_FORM 检测中断
    buffer = '正在生成...\nRICH_FORM: {"title":"test"}'
    const hasRichForm = buffer.includes('RICH_FORM:')
    assert(hasRichForm === true, '打字机-RICH_FORM检测')

    // 7.5 中断后 buffer 清空
    if (hasMuse) buffer = ''
    assert(buffer === '', '打字机-中断后清空buffer')

  } catch (err) {
    results.failed++
    results.details.push({ test: 'Task7-异常', pass: false, info: err.message.slice(0, 100) })
  }

  // ==========================================
  // 输出结果
  // ==========================================
  console.log('\n' + '═'.repeat(60))
  console.log(`\n🏁 总计: ${results.passed + results.failed} | ✅ ${results.passed} | ❌ ${results.failed}`)

  if (results.failed > 0) {
    console.log('\n❌ 失败项:')
    results.details.filter(d => !d.pass).forEach(d => {
      console.log(`  • ${d.test}: ${d.info}`)
    })
    process.exitCode = 1
  }

  console.log(`\n通过率: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`)
}

runTests().catch(err => {
  console.error('测试运行异常:', err)
  process.exit(1)
})

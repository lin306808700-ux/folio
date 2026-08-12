/**
 * 工具注册中心
 * 统一管理和暴露所有可用工具
 */

const fileTool = require('./file');
const commandTool = require('./command');
const memoryTool = require('./memory');
const webSearchTool = require('./websearch');
const cliTools = require('./cli-tools');
const pythonTool = require('./python');
const envCheckerTool = require('./env-checker');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this._registerDefaults();
  }

  /**
   * 注册默认工具
   */
  _registerDefaults() {
    this.register('file', fileTool);
    this.register('command', commandTool);
    this.register('memory', memoryTool);
    // 功能减法：browser（内置浏览器自动化）与 arch-designer（变更分析）已下线，文件保留不注册
    this.register('websearch', webSearchTool);
    this.register('cli-tools', cliTools);
    this.register('python', pythonTool);
    this.register('env-checker', envCheckerTool);
  }

  /**
   * 注册工具
   */
  register(name, tool) {
    this.tools.set(name, tool);
  }

  /**
   * 获取工具
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getAllNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取工具描述（用于 Planner Prompt）
   */
  getToolDescriptions() {
    // 功能减法：隐藏已下线工具的描述，避免模型调用不存在的工具
    const HIDDEN_TOOLS = new Set(['browser', 'arch-designer']);
    return [
      {
        name: 'listDir',
        tool: 'file',
        params: { path: '目录路径' },
        description: '列出目录内容，返回文件和子目录列表'
      },
      {
        name: 'readFile',
        tool: 'file',
        params: { path: '文件路径' },
        description: '读取文件内容'
      },
      {
        name: 'readFiles',
        tool: 'file',
        params: { paths: '文件路径数组' },
        description: '批量读取多个文件'
      },
      {
        name: 'findFiles',
        tool: 'file',
        params: { path: '搜索目录', pattern: '文件名正则' },
        description: '在目录中查找匹配的文件'
      },
      {
        name: 'execute',
        tool: 'command',
        params: { command: '命令字符串' },
        description: '执行终端命令（安全命令自动执行，危险命令需确认）'
      },
      {
        name: 'addMemory',
        tool: 'memory',
        params: { content: '记忆内容' },
        description: '添加一条记忆'
      },
      {
        name: 'addMemories',
        tool: 'memory',
        params: { contents: '记忆内容数组' },
        description: '批量添加多条记忆'
      },
      {
        name: 'getMemories',
        tool: 'memory',
        params: { limit: '数量限制' },
        description: '获取记忆列表'
      },
      {
        name: 'browserLaunch',
        tool: 'browser',
        method: 'launch',
        params: { headless: '是否无头模式(默认true)', slowMo: '操作延迟毫秒数', devtools: '是否打开开发者工具', useProfile: '是否启用自动化profile保留登录态(默认false)' },
        description: '启动浏览器。可视化模式设 headless:false。操作内部平台(需登录态)时设 useProfile:true，会使用独立Chrome profile，登录态持久保存'
      },
      {
        name: 'browserGoto',
        tool: 'browser',
        method: 'goto',
        params: { url: '目标网址' },
        description: '访问指定 URL'
      },
      {
        name: 'browserScreenshot',
        tool: 'browser',
        method: 'screenshot',
        params: { fullPage: '是否全页面', selector: '元素选择器' },
        description: '截取网页截图'
      },
      {
        name: 'browserClick',
        tool: 'browser',
        method: 'click',
        params: { selector: 'CSS选择器', text: '按钮文本' },
        description: '点击页面元素'
      },
      {
        name: 'browserType',
        tool: 'browser',
        method: 'type',
        params: { selector: '输入框选择器', text: '输入文本' },
        description: '在输入框中输入文本'
      },
      {
        name: 'browserGetContent',
        tool: 'browser',
        method: 'getContent',
        params: { selector: '元素选择器' },
        description: '获取页面或元素内容'
      },
      {
        name: 'browserClose',
        tool: 'browser',
        method: 'close',
        params: {},
        description: '关闭浏览器'
      },
      {
        name: 'browserWaitForNavigation',
        tool: 'browser',
        method: 'waitForNavigation',
        params: { timeout: '超时时间(毫秒)', waitUntil: '等待条件(networkidle2/load/domcontentloaded)' },
        description: '等待页面导航完成'
      },
      {
        name: 'browserNewPage',
        tool: 'browser',
        method: 'newPage',
        params: {},
        description: '打开新标签页'
      },
      {
        name: 'browserSwitchPage',
        tool: 'browser',
        method: 'switchPage',
        params: { index: '页面索引(从0开始)' },
        description: '切换到指定标签页'
      },
      {
        name: 'browserScroll',
        tool: 'browser',
        method: 'scroll',
        params: { direction: '方向(up/down)', amount: '像素数' },
        description: '滚动页面'
      },
      {
        name: 'browserEvaluate',
        tool: 'browser',
        method: 'evaluate',
        params: { script: 'JavaScript代码' },
        description: '在页面中执行JavaScript代码'
      },
      {
        name: 'browserWaitForSelector',
        tool: 'browser',
        method: 'waitForSelector',
        params: { selector: 'CSS选择器', timeout: '超时时间(毫秒)' },
        description: '等待指定元素出现在页面上'
      },
      {
        name: 'browserWaitForText',
        tool: 'browser',
        method: 'waitForText',
        params: { text: '等待出现的文本', timeout: '超时毫秒数(默认120000即2分钟)' },
        description: '等待页面上出现包含指定文本的内容，适用于等待用户登录完成、页面加载等场景'
      },
      // === Browser Use: 页面感知 ===
      {
        name: 'browserGetElements',
        tool: 'browser',
        method: 'getInteractiveElements',
        params: { viewport: '是否仅视口内(默认true)', filter: '过滤条件(button/input/link/all)' },
        description: '获取页面所有可交互元素列表（按钮、链接、输入框等），用于AI理解页面结构并决策操作目标'
      },
      {
        name: 'browserGetStructure',
        tool: 'browser',
        method: 'getPageStructure',
        params: {},
        description: '获取页面语义化结构概览（标题、导航、主要内容、警告信息、表格）'
      },
      {
        name: 'browserGetPageState',
        tool: 'browser',
        method: 'getPageState',
        params: { includeContent: '是否包含页面文本内容(默认true)', contentLimit: '内容字符数上限(默认2000)' },
        description: '获取当前浏览器页面的完整状态（URL、标题、内容摘要、结构、表单、表格等），用于AI理解和分析当前页面'
      },
      // === Browser Use: 日志捕获 ===
      {
        name: 'browserGetConsoleLogs',
        tool: 'browser',
        method: 'getConsoleLogs',
        params: { level: '日志级别(error/warn/all)', limit: '返回条数' },
        description: '获取浏览器Console日志，用于定位前端错误和调试信息'
      },
      {
        name: 'browserGetNetworkLogs',
        tool: 'browser',
        method: 'getNetworkLogs',
        params: { filter: '过滤条件(failed/xhr/all)', limit: '返回条数' },
        description: '获取网络请求日志，用于定位接口错误和请求失败'
      },
      // === Browser Use: 智能操作 ===
      {
        name: 'browserSmartClick',
        tool: 'browser',
        method: 'smartClick',
        params: { text: '按钮/链接文本', role: '元素角色(可选:button/link/tab)' },
        description: '按文本内容智能定位并点击元素，无需CSS选择器，优先精确匹配'
      },
      {
        name: 'browserSmartType',
        tool: 'browser',
        method: 'smartType',
        params: { label: '输入框label/placeholder', text: '要输入的内容' },
        description: '按label/placeholder智能定位输入框并输入文本，无需CSS选择器'
      },
      {
        name: 'browserSmartSelect',
        tool: 'browser',
        method: 'smartSelect',
        params: { label: '下拉框label/name', value: '要选择的选项文本' },
        description: '按label智能定位下拉框并选择选项，未找到选项时返回可用选项列表'
      },
      {
        name: 'browserDismissOverlay',
        tool: 'browser',
        method: 'dismissOverlay',
        params: {},
        description: '自动检测并关闭页面上的遮罩、浮层、新手引导、弹窗等。支持查找关闭按钮、隐藏高z-index遮罩层、发送ESC键等策略'
      },
      {
        name: 'webSearch',
        tool: 'websearch',
        method: 'search',
        params: { keywords: '搜索关键词', limit: '结果数量限制' },
        description: '执行网络搜索，获取实时信息'
      },
      {
        name: 'webSearchAndAnalyze',
        tool: 'websearch',
        method: 'searchAndAnalyze',
        params: { keywords: '搜索关键词', limit: '结果数量限制' },
        description: '执行网络搜索并整理结果，用于后续分析'
      },
      // === CLI Tools: 文件与文本处理 ===
      {
        name: 'cliFindFiles',
        tool: 'cli-tools',
        method: 'findFiles',
        params: { pattern: '文件名模式', path: '搜索目录', type: '类型(f/d/l)', maxDepth: '最大深度', limit: '结果数量' },
        description: '使用 fd 快速查找文件，支持正则模式匹配'
      },
      {
        name: 'cliReadFile',
        tool: 'cli-tools',
        method: 'readFile',
        params: { path: '文件路径', lineNumbers: '是否显示行号', syntaxHighlight: '是否语法高亮' },
        description: '使用 bat 读取文件，带语法高亮和行号'
      },
      {
        name: 'cliProcessJson',
        tool: 'cli-tools',
        method: 'processJson',
        params: { json: 'JSON字符串', query: 'jq查询表达式', compact: '是否紧凑输出' },
        description: '使用 jq 处理 JSON 数据，支持复杂查询和转换'
      },
      {
        name: 'cliSearchContent',
        tool: 'cli-tools',
        method: 'searchContent',
        params: { pattern: '搜索模式', path: '搜索目录', glob: '文件类型过滤', context: '上下文行数', ignoreCase: '是否忽略大小写', limit: '结果数量' },
        description: '使用 ripgrep 搜索文件内容，超快的正则搜索'
      },
      {
        name: 'cliCheckInstalled',
        tool: 'cli-tools',
        method: 'checkInstalled',
        params: {},
        description: '检查 CLI 工具是否已安装（fd/bat/jq/rg）'
      },
      // === 架构图设计器 ===
      {
        name: 'archDesignerGenerate',
        tool: 'arch-designer',
        method: 'generate',
        params: { description: '用户的架构需求描述，如"微服务电商平台架构"' },
        description: '调用 AI 根据用户描述生成符合规范的架构图 JSON 数据。返回 data 字段包含完整的 ArchData 对象'
      },
      {
        name: 'archDesignerOpen',
        tool: 'arch-designer',
        method: 'open',
        params: {},
        description: '在侧边栏浏览器中打开架构图画布（dev server 已预启动）'
      },
      {
        name: 'archDesignerRender',
        tool: 'arch-designer',
        method: 'render',
        params: { archData: '架构图 JSON 数据对象，通常引用 generate 步骤的结果 $stepId.data' },
        description: '将架构图 JSON 数据注入到已打开的画布中进行渲染'
      },
      {
        name: 'archDesignerSave',
        tool: 'arch-designer',
        method: 'save',
        params: { archData: '架构图 JSON 数据对象', filename: '(可选) 文件名，不含扩展名' },
        description: '将架构图 JSON 数据保存到工作区 .arch 目录下，方便后续二次调优。文件名默认基于架构图标题生成'
      },
      {
        name: 'archDesignerClose',
        tool: 'arch-designer',
        method: 'close',
        params: {},
        description: '关闭架构图编辑器的开发服务器'
      },
      {
        name: 'archDesignerStatus',
        tool: 'arch-designer',
        method: 'status',
        params: {},
        description: '获取架构图编辑器的运行状态'
      },
      // === Python 工具 ===
      {
        name: 'pythonDetectEnvironment',
        tool: 'python',
        method: 'detectEnvironment',
        params: { cwd: '工作目录（可选，用于检测项目 venv）' },
        description: '检测 Python 环境信息，包括版本、pip 可用性、venv 状态'
      },
      {
        name: 'pythonRunScript',
        tool: 'python',
        method: 'runScript',
        params: { script: 'Python 脚本文件路径', args: '命令行参数数组（可选）', cwd: '工作目录（可选）', timeout: '超时毫秒（默认60000）' },
        description: '执行 Python 脚本文件，自动使用项目 venv（若存在）'
      },
      {
        name: 'pythonRunCode',
        tool: 'python',
        method: 'runCode',
        params: { code: 'Python 代码字符串', cwd: '工作目录（可选）', timeout: '超时毫秒（默认30000）' },
        description: '直接执行 Python 代码片段，代码写入临时文件后运行，避免 shell 转义问题'
      },
      {
        name: 'pythonInstallPackages',
        tool: 'python',
        method: 'installPackages',
        params: { packages: '包名或包名数组', cwd: '工作目录（可选）', upgrade: '是否升级（默认false）' },
        description: '使用 pip 安装 Python 包，自动检测 venv'
      },
      {
        name: 'pythonInstallRequirements',
        tool: 'python',
        method: 'installRequirements',
        params: { requirementsFile: 'requirements.txt 路径（默认 requirements.txt）', cwd: '工作目录（可选）' },
        description: '从 requirements.txt 批量安装 Python 依赖'
      },
      {
        name: 'pythonListPackages',
        tool: 'python',
        method: 'listPackages',
        params: { cwd: '工作目录（可选）', filter: '过滤关键词（可选）' },
        description: '列出已安装的 pip 包'
      },
      {
        name: 'pythonCheckPackages',
        tool: 'python',
        method: 'checkPackages',
        params: { packages: '包名或包名数组', cwd: '工作目录（可选）' },
        description: '检查指定 Python 包是否已安装，返回缺失列表'
      },
      {
        name: 'pythonCreateVenv',
        tool: 'python',
        method: 'createVenv',
        params: { cwd: '项目目录', name: 'venv 目录名（默认 .venv）' },
        description: '在项目目录中创建 Python 虚拟环境'
      },
      {
        name: 'pythonCheckVenv',
        tool: 'python',
        method: 'checkVenv',
        params: { cwd: '项目目录' },
        description: '检查项目目录中是否存在虚拟环境'
      },
      // === 环境检测工具 ===
      {
        name: 'envCheckTools',
        tool: 'env-checker',
        method: 'checkTools',
        params: { tools: '工具名数组，支持：python/node/ffmpeg/conda/git/docker/imagemagick' },
        description: '批量检测指定工具是否已安装，返回版本信息和缺失列表'
      },
      {
        name: 'envSnapshot',
        tool: 'env-checker',
        method: 'snapshot',
        params: {},
        description: '全量环境快照：检测 python/node/ffmpeg/conda/git/docker/imagemagick 的安装状态'
      },
      {
        name: 'envCheckProjectDeps',
        tool: 'env-checker',
        method: 'checkProjectDeps',
        params: { cwd: '项目目录（默认当前目录）' },
        description: '检测项目依赖就绪状态（requirements.txt / package.json / node_modules）'
      },
      {
        name: 'envPrecheck',
        tool: 'env-checker',
        method: 'precheck',
        params: { requires: '所需工具名数组', pythonPackages: '所需 Python 包名数组', cwd: '工作目录（可选）' },
        description: '执行前环境预检：检测工具和 Python 包是否就绪，返回 ready 状态和 issues 列表'
      }
    ].filter(d => !HIDDEN_TOOLS.has(d.tool));
  }

  /**
   * 执行工具方法
   */
  async execute(toolName, methodName, params = {}, context = {}) {
    const tool = this.get(toolName);
    if (!tool) {
      throw new Error(`工具不存在: ${toolName}`);
    }

    let actualMethod = methodName;

    // 如果直接找不到方法，尝试从工具描述中映射（name → method）
    if (!tool[actualMethod] || typeof tool[actualMethod] !== 'function') {
      const desc = this.getToolDescriptions().find(
        d => d.name === methodName && d.tool === toolName
      );
      if (desc && desc.method) {
        actualMethod = desc.method;
      }
    }

    const method = tool[actualMethod];
    if (!method || typeof method !== 'function') {
      // 收集该工具的可用方法名
      const availableMethods = this.getToolDescriptions()
        .filter(d => d.tool === toolName)
        .map(d => d.name);
      throw new Error(
        `工具方法不存在: ${toolName}.${methodName}。` +
        `${toolName} 的可用方法: ${availableMethods.join(', ')}`
      );
    }

    // 解析参数中的变量引用（如 $step1.result）
    const resolvedParams = this._resolveParams(params, context);
    
    // 将 context 中的 currentDir 注入为 cwd，让命令工具在正确的工作区目录下执行
    if (context.currentDir && typeof resolvedParams === 'object' && resolvedParams !== null && !resolvedParams.cwd) {
      resolvedParams.cwd = context.currentDir;
    }
    
    // 调用方法，传递解析后的参数
    return await method.call(tool, resolvedParams);
  }

  /**
   * 执行指定名称的工具方法（通过工具名.方法名）
   */
  async executeByName(fullMethodName, params = {}, context = {}) {
    const [toolName, methodName] = fullMethodName.split('.');
    if (!toolName || !methodName) {
      throw new Error(`无效的工具方法名: ${fullMethodName}，格式应为 "toolName.methodName"`);
    }
    return await this.execute(toolName, methodName, params, context);
  }

  /**
   * 解析参数中的变量引用
   * 支持格式：$stepId 或 $stepId.property
   */
  _resolveParams(params, context) {
    if (typeof params === 'string') {
      // 处理字符串中的变量引用
      if (params.startsWith('$')) {
        const path = params.slice(1); // 移除 $
        const parts = path.split('.');
        let value = context;
        for (const part of parts) {
          value = value?.[part];
        }
        return value;
      }
      return params;
    }

    if (Array.isArray(params)) {
      return params.map(p => this._resolveParams(p, context));
    }

    if (typeof params === 'object' && params !== null) {
      const resolved = {};
      for (const [key, value] of Object.entries(params)) {
        resolved[key] = this._resolveParams(value, context);
      }
      return resolved;
    }

    return params;
  }
}

// 导出单例
module.exports = new ToolRegistry();

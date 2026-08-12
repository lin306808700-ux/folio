const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * CLI 工具集
 * 封装常用的命令行工具：fd、bat、jq、ripgrep
 * 这些工具需要用户预先安装
 */

class CliTools {
  constructor() {
    this.name = 'cli-tools';
    this._checkToolsInstalled();
  }

  /**
   * 检查工具是否已安装
   */
  _checkToolsInstalled() {
    const tools = ['fd', 'bat', 'jq', 'rg'];
    tools.forEach(tool => {
      try {
        execSync(`which ${tool}`, { stdio: 'ignore' });
      } catch (e) {
        console.warn(`[CliTools] 警告: ${tool} 未安装，相关功能将不可用`);
      }
    });
  }

  /**
   * 使用 fd 查找文件
   * @param {object} params
   * @param {string} params.pattern - 文件名模式（支持正则）
   * @param {string} params.path - 搜索目录（默认当前目录）
   * @param {string} params.type - 类型过滤：f(文件), d(目录), l(链接)
   * @param {number} params.maxDepth - 最大搜索深度
   * @param {number} params.limit - 结果数量限制
   */
  async findFiles(params = {}) {
    const { pattern, path = '.', type, maxDepth, limit } = params;
    
    let cmd = `fd`;
    if (type) cmd += ` -${type}`;
    if (maxDepth) cmd += ` -${maxDepth}`;
    if (limit) cmd += ` -${limit}`;
    if (pattern) cmd += ` "${pattern}"`;
    cmd += ` "${path}"`;

    try {
      const { stdout } = await execAsync(cmd);
      return {
        success: true,
        data: stdout.trim().split('\n').filter(Boolean),
        command: cmd
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        command: cmd
      };
    }
  }

  /**
   * 使用 bat 读取文件（带语法高亮）
   * @param {object} params
   * @param {string} params.path - 文件路径
   * @param {boolean} params.lineNumbers - 是否显示行号（默认true）
   * @param {boolean} params.syntaxHighlight - 是否语法高亮（默认true）
   */
  async readFile(params = {}) {
    const { path, lineNumbers = true, syntaxHighlight = true } = params;
    
    if (!path) {
      return { success: false, error: '缺少 path 参数' };
    }

    let cmd = 'bat';
    if (!lineNumbers) cmd += ' --style=plain';
    if (!syntaxHighlight) cmd += ' --color=never';
    cmd += ` "${path}"`;

    try {
      const { stdout } = await execAsync(cmd);
      return {
        success: true,
        data: stdout,
        command: cmd
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        command: cmd
      };
    }
  }

  /**
   * 使用 jq 处理 JSON 数据
   * @param {object} params
   * @param {string} params.json - JSON 字符串
   * @param {string} params.query - jq 查询表达式
   * @param {boolean} params.compact - 是否紧凑输出（默认false）
   */
  async processJson(params = {}) {
    const { json, query, compact = false } = params;
    
    if (!json || !query) {
      return { success: false, error: '缺少 json 或 query 参数' };
    }

    const cmd = `echo "${json.replace(/"/g, '\\"')}" | jq ${compact ? '-c ' : ''}"${query}"`;

    try {
      const { stdout } = await execAsync(cmd);
      return {
        success: true,
        data: stdout.trim(),
        command: cmd
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        command: cmd
      };
    }
  }

  /**
   * 使用 ripgrep 搜索文件内容
   * @param {object} params
   * @param {string} params.pattern - 搜索模式（支持正则）
   * @param {string} params.path - 搜索目录（默认当前目录）
   * @param {string} params.glob - 文件类型过滤（如 *.js, *.ts）
   * @param {number} params.context - 上下文行数
   * @param {boolean} params.ignoreCase - 是否忽略大小写（默认true）
   * @param {number} params.limit - 结果数量限制
   */
  async searchContent(params = {}) {
    const { pattern, path = '.', glob, context, ignoreCase = true, limit } = params;
    
    if (!pattern) {
      return { success: false, error: '缺少 pattern 参数' };
    }

    let cmd = 'rg';
    if (ignoreCase) cmd += ' -i';
    if (context) cmd += ` -${context}`;
    if (glob) cmd += ` --glob "${glob}"`;
    if (limit) cmd += ` -${limit}`;
    cmd += ` "${pattern}" "${path}"`;

    try {
      const { stdout } = await execAsync(cmd);
      return {
        success: true,
        data: stdout,
        command: cmd
      };
    } catch (error) {
      // ripgrep 找不到匹配时返回非零退出码，但不算错误
      if (error.code === 1 && !error.stdout) {
        return {
          success: true,
          data: '',
          message: '未找到匹配内容',
          command: cmd
        };
      }
      return {
        success: false,
        error: error.message,
        command: cmd
      };
    }
  }

  /**
   * 检查工具是否已安装
   */
  async checkInstalled() {
    const tools = ['fd', 'bat', 'jq', 'rg'];
    const result = {};
    
    for (const tool of tools) {
      try {
        execSync(`which ${tool}`, { stdio: 'ignore' });
        result[tool] = true;
      } catch (e) {
        result[tool] = false;
      }
    }
    
    return {
      success: true,
      data: result
    };
  }

  /**
   * 获取工具安装说明
   */
  getInstallInstructions() {
    return {
      fd: 'brew install fd',
      bat: 'brew install bat',
      jq: 'brew install jq',
      rg: 'brew install ripgrep'
    };
  }
}

module.exports = new CliTools();

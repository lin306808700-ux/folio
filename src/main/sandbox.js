'use strict'

/**
 * Sandbox — 工作区隔离与命令执行安全层
 *
 * 职责：
 * 1. 路径隔离：文件操作限制在工作区内，防止路径逃逸
 * 2. 命令安全：黑名单拦截 + 超时 + 输出截断
 * 3. 环境变量清理：移除敏感密钥，防止泄漏
 * 4. 资源限制：CPU 时间、内存、输出大小上限
 *
 * 用法：
 *   const sandbox = new Sandbox('/path/to/workspace')
 *   await sandbox.writeFile('test.js', 'console.log(1)')
 *   const result = await sandbox.exec('node test.js')
 */

const fsModule = require('fs')
const fs = fsModule.promises
const path = require('path')
const os = require('os')
const { exec } = require('child_process')
const { promisify } = require('util')
const { evaluateCommand } = require('./command-policy')

const execAsync = promisify(exec)

// ========== 常量 ==========

const DEFAULT_TIMEOUT = 30000
const MAX_OUTPUT = 10 * 1024 * 1024 // 10MB

// 敏感环境变量（执行命令时清理）
const SENSITIVE_ENV_KEYS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID',
  'GITHUB_TOKEN', 'GH_TOKEN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'MUSE_API_KEY',
  'DATABASE_URL', 'DB_PASSWORD',
]

// ========== Sandbox 类 ==========

class Sandbox {
  /**
   * @param {string} workspace - 工作区根目录
   * @param {object} [options]
   * @param {string[]} [options.allowedPaths] - 额外允许访问的路径
   * @param {number} [options.timeout] - 命令超时(ms)
   * @param {boolean} [options.allowHomeDir] - 允许访问用户家目录
   */
  constructor(workspace, options = {}) {
    this.workspace = path.resolve(workspace)
    this.timeout = options.timeout || DEFAULT_TIMEOUT
    this.allowHomeDir = options.allowHomeDir || false

    // 允许的路径列表
    this.allowedPaths = [this.workspace]
    if (options.allowedPaths) {
      this.allowedPaths.push(...options.allowedPaths.map(p => path.resolve(p)))
    }
    if (this.allowHomeDir) {
      this.allowedPaths.push(os.homedir())
    }

    // 安全的环境变量副本
    this.env = { ...process.env }
    for (const key of SENSITIVE_ENV_KEYS) {
      delete this.env[key]
    }
  }

  /**
   * 解析路径（支持 ~ 和相对路径，相对路径基于 workspace）
   */
  resolvePath(p) {
    if (!p) return this.workspace
    if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1))
    if (path.isAbsolute(p)) return path.resolve(p)
    return path.resolve(this.workspace, p)
  }

  /**
   * 检查路径是否在允许范围内
   */
  isPathAllowed(targetPath) {
    const resolved = this.resolvePath(targetPath)
    return this.allowedPaths.some(allowed =>
      resolved === allowed || resolved.startsWith(allowed + path.sep)
    )
  }

  /**
   * 校验词法路径和真实路径，防止允许目录内的符号链接指向沙箱外。
   * 对尚不存在的写入目标，校验其最近的已存在父目录。
   */
  async assertPathAllowed(targetPath) {
    const resolved = this.resolvePath(targetPath)
    if (!this.isPathAllowed(resolved)) {
      throw new Error(`路径超出沙箱范围: ${resolved}`)
    }

    let existingPath = resolved
    while (!fsModule.existsSync(existingPath)) {
      const parent = path.dirname(existingPath)
      if (parent === existingPath) break
      existingPath = parent
    }

    const realExistingPath = await fs.realpath(existingPath)
    const realAllowedPaths = await Promise.all(this.allowedPaths.map(async allowed => {
      try {
        return await fs.realpath(allowed)
      } catch {
        return allowed
      }
    }))
    const isRealPathAllowed = realAllowedPaths.some(allowed =>
      realExistingPath === allowed || realExistingPath.startsWith(allowed + path.sep)
    )

    if (!isRealPathAllowed) {
      throw new Error(`路径通过符号链接超出沙箱范围: ${resolved}`)
    }
    return resolved
  }

  /**
   * 沙箱内读取文件
   */
  async readFile(filePath) {
    const resolved = await this.assertPathAllowed(filePath)
    return fs.readFile(resolved, 'utf-8')
  }

  /**
   * 沙箱内写入文件
   */
  async writeFile(filePath, content) {
    const resolved = await this.assertPathAllowed(filePath)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, content, 'utf-8')
    return resolved
  }

  /**
   * 沙箱内编辑文件（search/replace）
   */
  async editFile(filePath, search, replace) {
    const resolved = await this.assertPathAllowed(filePath)
    let content = await fs.readFile(resolved, 'utf-8')
    if (!content.includes(search)) {
      throw new Error(`在 ${path.basename(resolved)} 中未找到匹配内容`)
    }
    content = content.replace(search, replace)
    await fs.writeFile(resolved, content, 'utf-8')
    return resolved
  }

  /**
   * 沙箱内列出目录
   */
  async listDir(dirPath) {
    const resolved = await this.assertPathAllowed(dirPath)
    const entries = await fs.readdir(resolved, { withFileTypes: true })
    return entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: path.join(resolved, e.name)
    }))
  }

  /**
   * 沙箱内执行命令
   * @param {string} command - 命令
   * @param {object} [options]
   * @param {string} [options.cwd] - 工作目录（默认 workspace）
   * @param {number} [options.timeout] - 超时(ms)
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async exec(command, options = {}) {
    // 安全检查
    if (isDangerous(command)) {
      throw new Error(`命令被安全策略拒绝: ${command}`)
    }

    const cwd = options.cwd
      ? this.resolvePath(options.cwd)
      : this.workspace

    await this.assertPathAllowed(cwd)

    const timeout = options.timeout || this.timeout

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: MAX_OUTPUT,
        env: this.env,
      })
      return {
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      }
    } catch (error) {
      if (error.killed) {
        throw new Error(`命令执行超时 (${timeout}ms): ${command}`)
      }
      // 保留 stdout/stderr 供调用者使用
      throw {
        message: error.message,
        stdout: truncate(error.stdout || ''),
        stderr: truncate(error.stderr || ''),
        code: error.code,
      }
    }
  }

  /**
   * 检查路径是否存在
   */
  async exists(targetPath) {
    try {
      const resolved = await this.assertPathAllowed(targetPath)
      await fs.access(resolved)
      return true
    } catch {
      return false
    }
  }

  /**
   * 添加允许的路径
   */
  allowPath(p) {
    const resolved = path.resolve(p)
    if (!this.allowedPaths.includes(resolved)) {
      this.allowedPaths.push(resolved)
    }
  }
}

// ========== 辅助函数 ==========

function isDangerous(cmd) {
  return evaluateCommand(cmd).requiresConfirmation
}

function truncate(str, max = MAX_OUTPUT) {
  if (!str || str.length <= max) return str
  return str.slice(0, max) + '\n... (输出已截断)'
}

// ========== 默认沙箱 ==========

let _defaultSandbox = null

function getDefaultSandbox() {
  if (!_defaultSandbox) {
    const workspace = process.env.MUSE_WORKSPACE || process.cwd()
    _defaultSandbox = new Sandbox(workspace, { allowHomeDir: true })
  }
  return _defaultSandbox
}

function setDefaultSandbox(sandbox) {
  _defaultSandbox = sandbox
}

module.exports = {
  Sandbox,
  isDangerous,
  getDefaultSandbox,
  setDefaultSandbox,
}

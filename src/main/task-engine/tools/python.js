const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Python 工具
 * 提供 Python 脚本执行、pip 包管理、虚拟环境管理等能力
 */
class PythonTool {
  constructor() {
    this.name = 'python';
    this._pythonBin = null; // 缓存检测到的 Python 可执行路径
    this._venvCache = new Map(); // cwd -> venv 路径缓存
  }

  // ─── 内部：检测可用的 Python 可执行文件 ───────────────────────────────────

  async _detectPython() {
    if (this._pythonBin) return this._pythonBin;

    const candidates = ['python3', 'python', 'python3.11', 'python3.10', 'python3.9'];
    for (const candidate of candidates) {
      try {
        const { stdout } = await execAsync(`which ${candidate}`);
        if (stdout.trim()) {
          this._pythonBin = stdout.trim();
          return this._pythonBin;
        }
      } catch {
        // 继续尝试下一个
      }
    }
    return null;
  }

  async _getPythonBin(cwd) {
    // 优先使用当前目录的 venv
    const venvPython = await this._findVenvPython(cwd);
    if (venvPython) return venvPython;
    return this._detectPython();
  }

  async _findVenvPython(cwd) {
    if (!cwd) return null;

    const venvDirs = ['venv', '.venv', 'env', '.env'];
    for (const dirName of venvDirs) {
      const venvPython = path.join(cwd, dirName, 'bin', 'python');
      try {
        await fs.access(venvPython);
        return venvPython;
      } catch {
        // 不存在
      }
    }
    return null;
  }

  // ─── 检测 Python 环境 ─────────────────────────────────────────────────────

  /**
   * 检测 Python 环境信息
   * @param {object} params
   * @param {string} params.cwd - 工作目录（用于检测项目 venv）
   */
  async detectEnvironment(params = {}) {
    const { cwd } = params;

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return {
        success: false,
        error: 'Python 未安装，请先安装 Python 3.x',
        installed: false
      };
    }

    try {
      const versionResult = await execAsync(`${pythonBin} --version`);
      const version = (versionResult.stdout || versionResult.stderr).trim();

      const pipResult = await execAsync(`${pythonBin} -m pip --version`).catch(() => ({ stdout: '' }));
      const hasPip = pipResult.stdout.includes('pip');

      const venvPython = await this._findVenvPython(cwd);

      return {
        success: true,
        installed: true,
        pythonBin,
        version,
        hasPip,
        hasVenv: !!venvPython,
        venvPython: venvPython || null,
        cwd: cwd || null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        installed: false
      };
    }
  }

  // ─── 执行 Python 脚本/代码 ────────────────────────────────────────────────

  /**
   * 执行 Python 脚本文件
   * @param {object} params
   * @param {string} params.script - 脚本文件路径
   * @param {string[]} params.args - 命令行参数
   * @param {string} params.cwd - 工作目录
   * @param {number} params.timeout - 超时毫秒（默认 60000）
   */
  async runScript(params = {}) {
    const { script, args = [], cwd, timeout = 60000 } = params;

    if (!script) {
      return { success: false, error: 'runScript 需要 script 参数（脚本文件路径）' };
    }

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    const argsStr = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
    const command = `${pythonBin} "${script}" ${argsStr}`.trim();

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || '',
        command
      };
    }
  }

  /**
   * 执行 Python 代码片段（内联代码）
   * @param {object} params
   * @param {string} params.code - Python 代码字符串
   * @param {string} params.cwd - 工作目录
   * @param {number} params.timeout - 超时毫秒（默认 30000）
   */
  async runCode(params = {}) {
    const { code, cwd, timeout = 30000 } = params;

    if (!code) {
      return { success: false, error: 'runCode 需要 code 参数' };
    }

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    // 将代码写入临时文件，避免 shell 转义问题
    const tempFile = path.join(os.tmpdir(), `muse_py_${Date.now()}.py`);
    try {
      await fs.writeFile(tempFile, code, 'utf-8');
      const { stdout, stderr } = await execAsync(`${pythonBin} "${tempFile}"`, { cwd, timeout });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || ''
      };
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  // ─── pip 包管理 ───────────────────────────────────────────────────────────

  /**
   * 安装 pip 包
   * @param {object} params
   * @param {string|string[]} params.packages - 包名或包名数组
   * @param {string} params.cwd - 工作目录（自动检测 venv）
   * @param {boolean} params.upgrade - 是否升级（-U）
   */
  async installPackages(params = {}) {
    const { packages, cwd, upgrade = false } = params;

    if (!packages) {
      return { success: false, error: 'installPackages 需要 packages 参数' };
    }

    const packageList = Array.isArray(packages) ? packages : [packages];
    if (packageList.length === 0) {
      return { success: false, error: 'packages 不能为空数组' };
    }

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    const upgradeFlag = upgrade ? ' -U' : '';
    const pkgStr = packageList.join(' ');
    const command = `${pythonBin} -m pip install${upgradeFlag} ${pkgStr}`;

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000 });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        packages: packageList,
        command
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || '',
        command
      };
    }
  }

  /**
   * 从 requirements.txt 安装依赖
   * @param {object} params
   * @param {string} params.requirementsFile - requirements.txt 路径（默认 requirements.txt）
   * @param {string} params.cwd - 工作目录
   */
  async installRequirements(params = {}) {
    const { requirementsFile = 'requirements.txt', cwd } = params;

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    const reqPath = path.isAbsolute(requirementsFile)
      ? requirementsFile
      : path.join(cwd || process.cwd(), requirementsFile);

    try {
      await fs.access(reqPath);
    } catch {
      return { success: false, error: `requirements 文件不存在: ${reqPath}` };
    }

    const command = `${pythonBin} -m pip install -r "${reqPath}"`;

    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 180000 });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        requirementsFile: reqPath,
        command
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stdout: error.stdout?.trim() || '',
        stderr: error.stderr?.trim() || ''
      };
    }
  }

  /**
   * 列出已安装的 pip 包
   * @param {object} params
   * @param {string} params.cwd - 工作目录
   * @param {string} params.filter - 过滤关键词
   */
  async listPackages(params = {}) {
    const { cwd, filter } = params;

    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    try {
      const { stdout } = await execAsync(`${pythonBin} -m pip list --format=json`, { cwd });
      const packages = JSON.parse(stdout.trim());

      const filtered = filter
        ? packages.filter(pkg => pkg.name.toLowerCase().includes(filter.toLowerCase()))
        : packages;

      return { success: true, packages: filtered, total: filtered.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 检查指定包是否已安装
   * @param {object} params
   * @param {string|string[]} params.packages - 包名或包名数组
   * @param {string} params.cwd - 工作目录
   */
  async checkPackages(params = {}) {
    const { packages, cwd } = params;
    if (!packages) {
      return { success: false, error: 'checkPackages 需要 packages 参数' };
    }

    const packageList = Array.isArray(packages) ? packages : [packages];
    const pythonBin = await this._getPythonBin(cwd);
    if (!pythonBin) {
      return { success: false, error: 'Python 未安装' };
    }

    const results = {};
    for (const pkg of packageList) {
      try {
        await execAsync(`${pythonBin} -m pip show ${pkg}`, { cwd });
        results[pkg] = { installed: true };
      } catch {
        results[pkg] = { installed: false };
      }
    }

    const missingPackages = Object.entries(results)
      .filter(([, info]) => !info.installed)
      .map(([name]) => name);

    return {
      success: true,
      results,
      allInstalled: missingPackages.length === 0,
      missingPackages
    };
  }

  // ─── 虚拟环境管理 ─────────────────────────────────────────────────────────

  /**
   * 创建虚拟环境
   * @param {object} params
   * @param {string} params.cwd - 项目目录
   * @param {string} params.name - venv 目录名（默认 .venv）
   */
  async createVenv(params = {}) {
    const { cwd, name = '.venv' } = params;

    const systemPython = await this._detectPython();
    if (!systemPython) {
      return { success: false, error: 'Python 未安装，无法创建虚拟环境' };
    }

    const venvPath = cwd ? path.join(cwd, name) : path.join(process.cwd(), name);
    const command = `${systemPython} -m venv "${venvPath}"`;

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return {
        success: true,
        venvPath,
        pythonBin: path.join(venvPath, 'bin', 'python'),
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 检查虚拟环境是否存在
   * @param {object} params
   * @param {string} params.cwd - 项目目录
   */
  async checkVenv(params = {}) {
    const { cwd } = params;
    const venvPython = await this._findVenvPython(cwd);

    return {
      success: true,
      hasVenv: !!venvPython,
      venvPython: venvPython || null,
      cwd: cwd || null
    };
  }
}

module.exports = new PythonTool();

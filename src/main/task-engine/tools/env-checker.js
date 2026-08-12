const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

/**
 * 环境检测工具
 * 检测运行环境（Python/Node/ffmpeg/conda 等）和依赖安装状态
 * 用于技能执行前的 precheck
 */
class EnvCheckerTool {
  constructor() {
    this.name = 'env-checker';
    this._cache = new Map(); // 工具名 -> { version, path, checkedAt }
    this._cacheTtlMs = 60 * 1000; // 缓存 1 分钟
  }

  // ─── 内部：运行命令获取版本 ────────────────────────────────────────────────

  async _runVersionCmd(command) {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 5000 });
      return (stdout || stderr).trim().split('\n')[0];
    } catch {
      return null;
    }
  }

  async _which(name) {
    try {
      const { stdout } = await execAsync(`which ${name}`, { timeout: 3000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  _isCacheValid(entry) {
    return entry && Date.now() - entry.checkedAt < this._cacheTtlMs;
  }

  async _checkTool(name, versionCmd) {
    const cached = this._cache.get(name);
    if (this._isCacheValid(cached)) return cached;

    const binPath = await this._which(name);
    const version = binPath ? await this._runVersionCmd(versionCmd) : null;

    const entry = { name, installed: !!binPath, path: binPath, version, checkedAt: Date.now() };
    this._cache.set(name, entry);
    return entry;
  }

  // ─── 单项检测 ─────────────────────────────────────────────────────────────

  async checkPython(params = {}) {
    const candidates = ['python3', 'python'];
    for (const candidate of candidates) {
      const result = await this._checkTool(candidate, `${candidate} --version`);
      if (result.installed) {
        // 额外检测 pip
        const hasPip = !!(await this._which('pip3') || await this._which('pip'));
        return { ...result, name: 'python', hasPip };
      }
    }
    return { name: 'python', installed: false, path: null, version: null, hasPip: false };
  }

  async checkNode(params = {}) {
    const node = await this._checkTool('node', 'node --version');
    const npm = await this._checkTool('npm', 'npm --version');
    return { ...node, name: 'node', npm: { installed: npm.installed, version: npm.version } };
  }

  async checkFfmpeg(params = {}) {
    return this._checkTool('ffmpeg', 'ffmpeg -version');
  }

  async checkConda(params = {}) {
    return this._checkTool('conda', 'conda --version');
  }

  async checkGit(params = {}) {
    return this._checkTool('git', 'git --version');
  }

  async checkDocker(params = {}) {
    return this._checkTool('docker', 'docker --version');
  }

  async checkImageMagick(params = {}) {
    return this._checkTool('convert', 'convert --version');
  }

  // ─── 批量检测 ─────────────────────────────────────────────────────────────

  /**
   * 检测指定工具列表
   * @param {object} params
   * @param {string[]} params.tools - 工具名列表，支持：python/node/ffmpeg/conda/git/docker/imagemagick
   */
  async checkTools(params = {}) {
    const { tools = [] } = params;

    if (!tools.length) {
      return { success: false, error: 'checkTools 需要 tools 参数（工具名数组）' };
    }

    const checkers = {
      python: () => this.checkPython(),
      node: () => this.checkNode(),
      ffmpeg: () => this.checkFfmpeg(),
      conda: () => this.checkConda(),
      git: () => this.checkGit(),
      docker: () => this.checkDocker(),
      imagemagick: () => this.checkImageMagick()
    };

    const results = {};
    const missing = [];

    await Promise.all(
      tools.map(async toolName => {
        const checker = checkers[toolName.toLowerCase()];
        if (!checker) {
          results[toolName] = { installed: false, error: `未知工具: ${toolName}` };
          return;
        }
        const info = await checker();
        results[toolName] = info;
        if (!info.installed) missing.push(toolName);
      })
    );

    return { success: true, results, missing, allInstalled: missing.length === 0 };
  }

  /**
   * 全量环境快照
   */
  async snapshot(params = {}) {
    const allTools = ['python', 'node', 'ffmpeg', 'conda', 'git', 'docker', 'imagemagick'];
    return this.checkTools({ tools: allTools });
  }

  // ─── 项目依赖检测 ─────────────────────────────────────────────────────────

  /**
   * 检测项目所需的依赖是否就绪（requirements.txt / package.json）
   * @param {object} params
   * @param {string} params.cwd - 项目目录
   */
  async checkProjectDeps(params = {}) {
    const { cwd = process.cwd() } = params;

    const report = { cwd, python: null, node: null };

    // 检测 requirements.txt
    const reqFile = path.join(cwd, 'requirements.txt');
    try {
      await fs.access(reqFile);
      const content = await fs.readFile(reqFile, 'utf-8');
      const packages = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      report.python = { hasRequirements: true, packages };
    } catch {
      report.python = { hasRequirements: false };
    }

    // 检测 package.json
    const pkgFile = path.join(cwd, 'package.json');
    try {
      await fs.access(pkgFile);
      const content = JSON.parse(await fs.readFile(pkgFile, 'utf-8'));
      const deps = Object.keys(content.dependencies || {});
      const devDeps = Object.keys(content.devDependencies || {});

      // 检测 node_modules 是否存在
      let nodeModulesInstalled = false;
      try {
        await fs.access(path.join(cwd, 'node_modules'));
        nodeModulesInstalled = true;
      } catch { /* 不存在 */ }

      report.node = { hasPackageJson: true, deps, devDeps, nodeModulesInstalled };
    } catch {
      report.node = { hasPackageJson: false };
    }

    return { success: true, ...report };
  }

  /**
   * 技能执行前的环境预检
   * 根据技能 SKILL.md 中声明的 sideEffects/requirements 检测
   * @param {object} params
   * @param {string[]} params.requires - 技能所需工具列表
   * @param {string[]} params.pythonPackages - 技能所需 Python 包
   * @param {string} params.cwd - 工作目录
   */
  async precheck(params = {}) {
    const { requires = [], pythonPackages = [], cwd } = params;

    const issues = [];
    const info = {};

    // 检测工具
    if (requires.length > 0) {
      const toolResult = await this.checkTools({ tools: requires });
      info.tools = toolResult.results;
      for (const missingTool of toolResult.missing) {
        issues.push({ type: 'missing_tool', tool: missingTool, message: `缺少工具: ${missingTool}` });
      }
    }

    // 检测 Python 包
    if (pythonPackages.length > 0) {
      const pythonTool = await this.checkPython();
      if (!pythonTool.installed) {
        issues.push({ type: 'missing_tool', tool: 'python', message: 'Python 未安装' });
      } else {
        // 用 pip show 检测包
        const pkgResults = {};
        await Promise.all(
          pythonPackages.map(async pkg => {
            try {
              await execAsync(`${pythonTool.path} -m pip show ${pkg}`, { timeout: 5000 });
              pkgResults[pkg] = { installed: true };
            } catch {
              pkgResults[pkg] = { installed: false };
              issues.push({ type: 'missing_python_package', package: pkg, message: `缺少 Python 包: ${pkg}` });
            }
          })
        );
        info.pythonPackages = pkgResults;
      }
    }

    return {
      success: true,
      ready: issues.length === 0,
      issues,
      info
    };
  }
}

module.exports = new EnvCheckerTool();

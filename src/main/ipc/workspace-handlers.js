// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { Worker } = require('node:worker_threads');

/**
 * 候选编辑器清单 — 按热门程度从高到低排序。
 * Qoder 作为高优放最前，其次 VSCode / Cursor / WebStorm 等。
 * appNames: macOS /Applications 下的 .app 名（不含扩展名），用于安装检测与 `open -a`。
 * cli: 命令行可执行名（若在 PATH 中可用则优先用 CLI 打开目录）。
 */
const EDITOR_CANDIDATES = [
  { id: 'qoder', name: 'Qoder', appNames: ['Qoder'], cli: 'qoder' },
  { id: 'vscode', name: 'VS Code', appNames: ['Visual Studio Code'], cli: 'code' },
  { id: 'cursor', name: 'Cursor', appNames: ['Cursor'], cli: 'cursor' },
  { id: 'webstorm', name: 'WebStorm', appNames: ['WebStorm'], cli: 'webstorm' },
  { id: 'idea', name: 'IntelliJ IDEA', appNames: ['IntelliJ IDEA', 'IntelliJ IDEA CE'], cli: 'idea' },
  { id: 'sublime', name: 'Sublime Text', appNames: ['Sublime Text'], cli: 'subl' },
  { id: 'zed', name: 'Zed', appNames: ['Zed'], cli: 'zed' },
  { id: 'atom', name: 'Atom', appNames: ['Atom'], cli: 'atom' },
  { id: 'trae', name: 'Trae', appNames: ['Trae'], cli: 'trae' },
];

// 冷启动扫描结果缓存（避免每次面板渲染都扫盘）
let cachedEditors = null;

function analyzeRepositoryOffMainThread(repoPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../architecture-analyzer-worker.js'), {
      workerData: { repoPath },
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('变更分析超时'));
    }, 30000);
    worker.once('message', result => {
      clearTimeout(timeout);
      if (result.success) resolve(result.data);
      else reject(new Error(result.error || '变更分析失败'));
    });
    worker.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', code => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`变更分析线程异常退出 (${code})`));
      }
    });
  });
}

/**
 * 检测某个 CLI 是否在 PATH 中可用
 */
function isCliAvailable(cli) {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-lc', `command -v ${cli}`], (err, stdout) => {
      resolve(!err && !!String(stdout).trim());
    });
  });
}

/**
 * 扫描已安装的编辑器（macOS：检查 /Applications 与 ~/Applications）。
 * 返回按热门度排序的已安装编辑器列表。
 */
async function scanInstalledEditors() {
  const appDirs = ['/Applications', path.join(process.env.HOME || '', 'Applications')];
  const installed = [];

  for (const candidate of EDITOR_CANDIDATES) {
    let appPath = null;
    for (const dir of appDirs) {
      for (const appName of candidate.appNames) {
        const candidatePath = path.join(dir, `${appName}.app`);
        if (fs.existsSync(candidatePath)) {
          appPath = candidatePath;
          break;
        }
      }
      if (appPath) break;
    }

    const cliAvailable = candidate.cli ? await isCliAvailable(candidate.cli) : false;

    if (appPath || cliAvailable) {
      installed.push({
        id: candidate.id,
        name: candidate.name,
        appPath,
        cli: cliAvailable ? candidate.cli : null,
      });
    }
  }

  return installed;
}

/**
 * 用指定编辑器打开目录。优先 CLI，回退到 `open -a`。
 */
function openPathInEditor(editor, targetPath) {
  return new Promise((resolve) => {
    if (editor.cli) {
      execFile(editor.cli, [targetPath], (err) => {
        if (!err) return resolve({ success: true });
        // CLI 失败回退到 app
        if (editor.appPath) {
          spawn('open', ['-a', editor.appPath, targetPath], { detached: true }).on('error', (e2) =>
            resolve({ success: false, error: e2.message })
          );
          resolve({ success: true });
        } else {
          resolve({ success: false, error: err.message });
        }
      });
      return;
    }
    if (editor.appPath) {
      const child = spawn('open', ['-a', editor.appPath, targetPath], { detached: true });
      child.on('error', (e) => resolve({ success: false, error: e.message }));
      resolve({ success: true });
      return;
    }
    resolve({ success: false, error: '该编辑器不可用' });
  });
}

/**
 * 检测工作区环境类型，返回类型标签与推荐启动命令。
 */
function detectWorkspaceEnv(workspacePath) {
  const has = (rel) => fs.existsSync(path.join(workspacePath, rel));

  let pkg = null;
  if (has('package.json')) {
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf-8'));
    } catch (e) {
      pkg = null;
    }
  }

  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const scripts = (pkg && pkg.scripts) || {};
  const pickScript = (...names) => names.find((n) => scripts[n]);

  // 收集所有可用的快捷脚本
  const quickScripts = collectQuickScripts(workspacePath, scripts);

  // Vite
  if (deps.vite || has('vite.config.ts') || has('vite.config.js')) {
    const script = pickScript('dev', 'start', 'serve') || 'dev';
    return { type: 'vite', label: 'Vite', startCommand: `npm run ${script}`, runnable: true, quickScripts };
  }
  // Next.js
  if (deps.next || has('next.config.js') || has('next.config.mjs')) {
    const script = pickScript('dev', 'start') || 'dev';
    return { type: 'next', label: 'Next.js', startCommand: `npm run ${script}`, runnable: true, quickScripts };
  }
  // Vue CLI / 通用前端框架（有 dev/serve 脚本）
  if (pkg && (scripts.dev || scripts.serve || scripts.start)) {
    const script = pickScript('dev', 'serve', 'start');
    const frameworkLabel = deps.vue ? 'Vue' : deps.react ? 'React' : 'Node';
    return { type: 'node', label: frameworkLabel, startCommand: `npm run ${script}`, runnable: true, quickScripts };
  }
  // 纯 Node 项目（有 package.json 但无可运行脚本）
  if (pkg) {
    return { type: 'node', label: 'Node', startCommand: null, runnable: false, quickScripts };
  }
  // Python
  if (has('pyproject.toml') || has('requirements.txt') || has('manage.py')) {
    const startCommand = has('manage.py') ? 'python manage.py runserver' : null;
    return { type: 'python', label: 'Python', startCommand, runnable: !!startCommand, quickScripts };
  }
  // 静态 HTML
  if (has('index.html')) {
    return { type: 'html', label: 'HTML', startCommand: 'npx serve .', runnable: true, quickScripts };
  }

  return { type: 'unknown', label: '未知', startCommand: null, runnable: false, quickScripts };
}

/**
 * 收集工作区中的快捷脚本入口
 * 优先级：start.sh > Makefile targets > package.json scripts
 */
function collectQuickScripts(workspacePath, pkgScripts) {
  const has = (rel) => fs.existsSync(path.join(workspacePath, rel));
  const result = [];

  // 1. 项目根目录的 start.sh / run.sh / dev.sh
  const shellScripts = ['start.sh', 'run.sh', 'dev.sh', 'build.sh', 'deploy.sh', 'setup.sh'];
  for (const script of shellScripts) {
    if (has(script)) {
      result.push({ name: script, command: `bash ${script}`, icon: 'terminal', source: 'shell' });
    }
  }

  // 2. Makefile targets（解析常用 target）
  if (has('Makefile')) {
    try {
      const makefile = fs.readFileSync(path.join(workspacePath, 'Makefile'), 'utf-8');
      const targets = makefile.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm) || [];
      const usefulTargets = ['dev', 'start', 'build', 'test', 'run', 'serve', 'clean', 'lint', 'deploy', 'install', 'setup'];
      for (const raw of targets) {
        const target = raw.replace(':', '').trim();
        if (usefulTargets.includes(target) && result.length < 8) {
          result.push({ name: `make ${target}`, command: `make ${target}`, icon: 'cog', source: 'makefile' });
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. package.json scripts（选取有意义的）
  const usefulPkgScripts = ['dev', 'start', 'build', 'test', 'lint', 'serve', 'preview', 'typecheck', 'format', 'deploy'];
  for (const name of usefulPkgScripts) {
    if (pkgScripts[name] && result.length < 10) {
      result.push({ name: `npm run ${name}`, command: `npm run ${name}`, icon: 'package', source: 'package.json' });
    }
  }

  // 4. Docker Compose
  if (has('docker-compose.yml') || has('docker-compose.yaml') || has('compose.yml')) {
    result.push({ name: 'docker compose up', command: 'docker compose up -d', icon: 'container', source: 'docker' });
  }

  return result;
}

// Workspace 配置存储路径
const WORKSPACE_CONFIG_PATH = path.join(process.env.HOME, '.folio', 'workspace.json');

/**
 * 读取当前工作区配置
 */
function readWorkspaceConfig() {
  try {
    if (fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const data = fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[Workspace] 读取配置失败:', e.message);
  }
  return { currentWorkspace: null, recentWorkspaces: [] };
}

/**
 * 写入工作区配置
 */
function writeWorkspaceConfig(config) {
  try {
    const dir = path.dirname(WORKSPACE_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(WORKSPACE_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[Workspace] 写入配置失败:', e.message);
  }
}

/**
 * 获取工作区名称（从路径提取）
 */
function getWorkspaceName(workspacePath) {
  return path.basename(workspacePath);
}

/**
 * 注册 Workspace IPC handlers
 */
function register(ipcMain) {
  // 获取当前工作区
  ipcMain.handle('workspace:getCurrent', async () => {
    const config = readWorkspaceConfig();
    if (config.currentWorkspace) {
      return {
        success: true,
        data: {
          path: config.currentWorkspace,
          name: getWorkspaceName(config.currentWorkspace)
        }
      };
    }
    return {
      success: true,
      data: null
    };
  });

  // 打开工作区选择器
  ipcMain.handle('workspace:openWorkspaceSelector', async () => {
    const config = readWorkspaceConfig();
    const defaultPath = config.currentWorkspace && fs.existsSync(config.currentWorkspace)
      ? config.currentWorkspace
      : undefined;
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择工作区',
      defaultPath
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0];
      return await setWorkspace(selectedPath);
    }
    return {
      success: true,
      data: null
    };
  });

  // 设置工作区
  async function setWorkspace(workspacePath) {
    const config = readWorkspaceConfig();
    
    // 更新当前工作区
    config.currentWorkspace = workspacePath;
    
    // 添加到最近使用列表
    const existingIndex = config.recentWorkspaces.findIndex(
      w => w.path === workspacePath
    );
    if (existingIndex > -1) {
      config.recentWorkspaces.splice(existingIndex, 1);
    }
    config.recentWorkspaces.unshift({
      path: workspacePath,
      name: getWorkspaceName(workspacePath),
      lastUsed: Date.now()
    });
    
    // 限制最近使用列表长度
    config.recentWorkspaces = config.recentWorkspaces.slice(0, 10);
    
    writeWorkspaceConfig(config);
    
    // 通知前端工作区已变更
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('workspace:changed', {
        path: workspacePath,
        name: getWorkspaceName(workspacePath)
      });
    }
    
    return {
      success: true,
      data: {
        path: workspacePath,
        name: getWorkspaceName(workspacePath)
      }
    };
  }

  // 设置工作区（从前端调用）
  ipcMain.handle('workspace:setWorkspace', async (event, { path: workspacePath }) => {
    return await setWorkspace(workspacePath);
  });

  // 列出最近使用的工作区
  ipcMain.handle('workspace:listWorkspaces', async () => {
    const config = readWorkspaceConfig();
    return {
      success: true,
      data: config.recentWorkspaces.map(w => ({
        path: w.path,
        name: w.name,
        lastUsed: w.lastUsed
      }))
    };
  });

  // 在系统文件管理器中打开工作区目录（打开目录内容，而非高亮该项）
  ipcMain.handle('workspace:openInFolder', async (event, payload) => {
    try {
      const targetPath = (payload && payload.path) || readWorkspaceConfig().currentWorkspace;
      if (!targetPath) return { success: false, error: '未设置工作区' };
      const errMsg = await shell.openPath(targetPath);
      if (errMsg) return { success: false, error: errMsg };
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 检测当前工作区的环境类型
  ipcMain.handle('workspace:detectEnv', async () => {
    const config = readWorkspaceConfig();
    const workspacePath = config.currentWorkspace;
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: '未设置工作区或路径不存在' };
    }
    try {
      const env = detectWorkspaceEnv(workspacePath);
      return { success: true, data: { ...env, workspacePath } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 列出已安装的编辑器（优先返回冷启动缓存结果）
  ipcMain.handle('workspace:detectEditors', async () => {
    try {
      if (!cachedEditors) {
        cachedEditors = await scanInstalledEditors();
      }
      return { success: true, data: cachedEditors };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 用指定编辑器打开当前工作区
  ipcMain.handle('workspace:openInEditor', async (event, { editorId }) => {
    const config = readWorkspaceConfig();
    const workspacePath = config.currentWorkspace;
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return { success: false, error: '未设置工作区或路径不存在' };
    }
    if (!cachedEditors) {
      cachedEditors = await scanInstalledEditors();
    }
    const editor = cachedEditors.find((e) => e.id === editorId);
    if (!editor) return { success: false, error: '编辑器不可用' };
    return await openPathInEditor(editor, workspacePath);
  });

  // 扫描当前工作区的文件列表（用于 @ 触发器检索）
  ipcMain.handle('workspace:listFiles', async () => {
    const config = readWorkspaceConfig();
    const workspacePath = config.currentWorkspace;

    if (!workspacePath) {
      return { success: false, error: '未设置工作区' };
    }

    if (!fs.existsSync(workspacePath)) {
      return { success: false, error: '工作区路径不存在' };
    }

    const IGNORED_DIRS = new Set([
      'node_modules', 'dist', 'build', '.git', '.svn',
      '__pycache__', '.cache', '.tmp', 'coverage',
      '.next', '.nuxt', '.output', 'vendor', '.DS_Store'
    ]);

    const MAX_FILES = 500;
    const allFiles = [];

    function scanDir(dir, depth = 0) {
      if (depth > 6 || allFiles.length >= MAX_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(dir);
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        if (allFiles.length >= MAX_FILES) break;
        if (entry.startsWith('.') || IGNORED_DIRS.has(entry)) continue;

        const fullPath = path.join(dir, entry);
        const relativePath = path.relative(workspacePath, fullPath);

        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          allFiles.push({
            name: entry,
            path: fullPath,
            relativePath,
            isDirectory: true,
            modified: stat.mtime,
          });
          scanDir(fullPath, depth + 1);
        } else {
          allFiles.push({
            name: entry,
            path: fullPath,
            relativePath,
            isDirectory: false,
            size: stat.size,
            modified: stat.mtime,
            ext: path.extname(entry).toLowerCase(),
          });
        }
      }
    }

    scanDir(workspacePath);

    // 目录优先，同类按修改时间倒序
    allFiles.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return new Date(b.modified) - new Date(a.modified);
    });

    return {
      success: true,
      workspacePath,
      workspaceName: getWorkspaceName(workspacePath),
      files: allFiles,
    };
  });

  // 只读分析当前工作区的真实 Git 变更，不接受 renderer 传入任意路径。
  ipcMain.handle('workspace:analyzeArchitecture', async () => {
    const config = readWorkspaceConfig();
    const workspacePath = config.currentWorkspace || process.cwd();
    try {
      return { success: true, data: await analyzeRepositoryOffMainThread(workspacePath) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 单层目录浏览（供右侧面板 Files 标签使用）
  ipcMain.handle('workspace:listDir', async (_event, { dirPath } = {}) => {
    const config = readWorkspaceConfig();
    const workspacePath = config.currentWorkspace;
    if (!workspacePath) return { success: false, error: '未设置工作区' };

    const targetDir = dirPath || workspacePath;

    // 安全检查：不允许跳出工作区根目录
    const resolved = path.resolve(targetDir);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      return { success: false, error: '不允许访问工作区外的目录' };
    }

    if (!fs.existsSync(resolved)) {
      return { success: false, error: '目录不存在' };
    }

    const IGNORED = new Set([
      'node_modules', 'dist', 'build', '.git', '.svn',
      '__pycache__', '.cache', '.tmp', 'coverage',
      '.next', '.nuxt', '.output', 'vendor',
    ]);

    try {
      const entries = fs.readdirSync(resolved);
      const files = [];
      for (const name of entries) {
        if (name.startsWith('.') || IGNORED.has(name)) continue;
        const fullPath = path.join(resolved, name);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { continue; }
        files.push({
          name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          size: stat.isDirectory() ? 0 : stat.size,
          extension: stat.isDirectory() ? '' : path.extname(name).replace('.', ''),
        });
      }
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { success: true, files, currentDir: resolved };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== Muse 任务管理 IPC =====
  ipcMain.handle('workspace:listTasks', async () => {
    try {
      const { loadTasks } = require('../muse/tasks');
      const tasks = loadTasks();
      return { success: true, tasks };
    } catch (e) {
      return { success: false, error: e.message, tasks: [] };
    }
  });

  ipcMain.handle('workspace:retryTask', async (_event, { taskId }) => {
    try {
      const { updateTaskStatus } = require('../muse/tasks');
      const result = updateTaskStatus(taskId, { status: 'pending', error: null, completedAt: null });
      return { success: !!result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('workspace:cancelTask', async (_event, { taskId }) => {
    try {
      const { updateTaskStatus } = require('../muse/tasks');
      const result = updateTaskStatus(taskId, { status: 'cancelled' });
      return { success: !!result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 冷启动预热：后台扫描已安装编辑器，结果缓存供前端秒开
  scanInstalledEditors()
    .then((editors) => {
      cachedEditors = editors;
      console.log('[Workspace] 编辑器冷启动扫描完成:', editors.map((e) => e.name).join(', ') || '无');
    })
    .catch((e) => console.warn('[Workspace] 编辑器扫描失败:', e.message));
}

module.exports = { register };

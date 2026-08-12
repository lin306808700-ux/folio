'use strict'

/**
 * 插件系统管理器
 *
 * 职责：
 * 1. 扫描 ~/.folio/plugins/ 目录加载插件
 * 2. 管理插件生命周期（load/unload/enable/disable）
 * 3. 提供工具注册表供 ReAct 引擎调用
 * 4. 管理钩子链（before/after hooks）
 * 5. 管理上下文注入器
 *
 * 插件目录结构：
 *   ~/.folio/plugins/
 *     ├── my-plugin/
 *     │   ├── plugin.js          (或 index.js)
 *     │   ├── package.json       (可选，元数据)
 *     │   └── ...                (插件自带资源)
 *     └── another-plugin/
 *         └── ...
 *
 * 插件状态文件：
 *   ~/.folio/plugins/.plugin-state.json
 *   记录每个插件的 enabled/disabled 状态
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { validatePlugin, summarizePlugin } = require('./plugin-interface')

const PLUGINS_DIR = path.join(os.homedir(), '.folio', 'plugins')
const STATE_FILE = path.join(PLUGINS_DIR, '.plugin-state.json')

// 插件注册表
const _plugins = new Map()        // name → plugin instance
const _toolRegistry = new Map()   // toolName → { plugin, execute, def }
let _state = {}                   // name → { enabled: boolean }
let _watcher = null
let _loaded = false

// ========== 状态持久化 ==========

function ensurePluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }
  return PLUGINS_DIR
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      _state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {
    _state = {}
  }
}

function saveState() {
  try {
    ensurePluginsDir()
    fs.writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2), 'utf-8')
  } catch (e) {
    console.error('[Plugins] 保存状态失败:', e.message)
  }
}

// ========== 插件加载 ==========

/**
 * 查找插件入口文件
 * 优先级：plugin.js > index.js
 */
function findPluginEntry(dirPath) {
  const candidates = ['plugin.js', 'index.js']
  for (const file of candidates) {
    const fullPath = path.join(dirPath, file)
    if (fs.existsSync(fullPath)) {
      return fullPath
    }
  }
  return null
}

/**
 * 加载单个插件
 * @param {string} dirPath - 插件目录路径
 * @param {string} dirName - 插件目录名
 * @returns {{ success: boolean, plugin?: object, error?: string, warnings?: string[] }}
 */
function loadPlugin(dirPath, dirName) {
  try {
    const entryFile = findPluginEntry(dirPath)
    if (!entryFile) {
      return { success: false, error: `未找到插件入口文件 (plugin.js 或 index.js)` }
    }

    // 清除 require 缓存以支持热重载
    const resolvedPath = require.resolve(entryFile)
    delete require.cache[resolvedPath]

    const plugin = require(entryFile)

    // 验证插件接口
    const validation = validatePlugin(plugin)
    if (!validation.valid) {
      return { success: false, error: `插件验证失败: ${validation.errors.join('; ')}`, warnings: validation.warnings }
    }

    // 设置元数据
    plugin._dir = dirPath
    plugin._dirName = dirName
    plugin._entryFile = entryFile

    // 读取状态
    const stateEntry = _state[dirName]
    plugin._enabled = stateEntry ? stateEntry.enabled !== false : true

    return { success: true, plugin, warnings: validation.warnings }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 加载所有插件
 * @param {object} context - 传递给 onLoad 的上下文
 * @returns {{ loaded: number, failed: number, details: Array }}
 */
function loadAll(context = {}) {
  if (_loaded) return { loaded: _plugins.size, failed: 0, details: [] }

  ensurePluginsDir()
  loadState()

  const details = []
  let loaded = 0
  let failed = 0

  try {
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue

      const dirPath = path.join(PLUGINS_DIR, entry.name)
      const result = loadPlugin(dirPath, entry.name)

      if (result.success && result.plugin) {
        const plugin = result.plugin

        // 调用 onLoad
        if (plugin._enabled && plugin.onLoad) {
          try {
            plugin.onLoad({
              ...context,
              pluginsDir: PLUGINS_DIR,
              pluginDir: dirPath,
              logger: console,
            })
          } catch (e) {
            console.error(`[Plugins] ${plugin.name}.onLoad 失败:`, e.message)
          }
        }

        // 注册工具
        if (plugin._enabled && plugin.tools) {
          for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
            _toolRegistry.set(toolName, {
              plugin,
              execute: toolDef.execute,
              def: toolDef,
            })
          }
        }

        _plugins.set(plugin.name, plugin)
        loaded++

        details.push({
          name: plugin.name,
          version: plugin.version,
          enabled: plugin._enabled,
          tools: plugin.tools ? Object.keys(plugin.tools).length : 0,
          warnings: result.warnings || [],
        })

        if (result.warnings && result.warnings.length > 0) {
          console.warn(`[Plugins] ${plugin.name} 警告:`, result.warnings.join('; '))
        }
      } else {
        failed++
        details.push({
          name: entry.name,
          error: result.error,
        })
        console.warn(`[Plugins] 加载失败 ${entry.name}:`, result.error)
      }
    }
  } catch (e) {
    console.error('[Plugins] 扫描插件目录失败:', e.message)
  }

  _loaded = true
  console.log(`[Plugins] 加载完成: ${loaded} 成功, ${failed} 失败`)
  return { loaded, failed, details }
}

/**
 * 卸载单个插件
 */
function unload(name) {
  const plugin = _plugins.get(name)
  if (!plugin) return false

  // 调用 onUnload
  if (plugin.onUnload) {
    try {
      plugin.onUnload()
    } catch (e) {
      console.error(`[Plugins] ${name}.onUnload 失败:`, e.message)
    }
  }

  // 移除工具注册
  if (plugin.tools) {
    for (const toolName of Object.keys(plugin.tools)) {
      _toolRegistry.delete(toolName)
    }
  }

  // 清除 require 缓存
  if (plugin._entryFile) {
    delete require.cache[require.resolve(plugin._entryFile)]
  }

  _plugins.delete(name)
  return true
}

/**
 * 卸载所有插件
 */
function unloadAll() {
  for (const name of Array.from(_plugins.keys())) {
    unload(name)
  }
  _loaded = false
}

// ========== 插件管理操作 ==========

/**
 * 启用/禁用插件
 */
function setEnabled(name, enabled) {
  const plugin = _plugins.get(name)
  if (!plugin) return { success: false, error: `插件 ${name} 未加载` }

  plugin._enabled = enabled
  _state[plugin._dirName] = { enabled }
  saveState()

  if (enabled) {
    // 重新注册工具
    if (plugin.tools) {
      for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
        _toolRegistry.set(toolName, { plugin, execute: toolDef.execute, def: toolDef })
      }
    }
    // 重新调用 onLoad
    if (plugin.onLoad) {
      try { plugin.onLoad({ pluginsDir: PLUGINS_DIR, pluginDir: plugin._dir, logger: console }) }
      catch (e) { console.error(`[Plugins] ${name}.onLoad 失败:`, e.message) }
    }
  } else {
    // 移除工具注册
    if (plugin.tools) {
      for (const toolName of Object.keys(plugin.tools)) {
        _toolRegistry.delete(toolName)
      }
    }
    // 调用 onUnload
    if (plugin.onUnload) {
      try { plugin.onUnload() }
      catch (e) { console.error(`[Plugins] ${name}.onUnload 失败:`, e.message) }
    }
  }

  return { success: true }
}

/**
 * 从目录安装插件（复制到 plugins 目录）
 * @param {string} sourceDir - 源目录
 */
function installFromDir(sourceDir) {
  try {
    ensurePluginsDir()

    // 读取源目录的插件入口验证名称
    const entryFile = findPluginEntry(sourceDir)
    if (!entryFile) {
      return { success: false, error: '源目录未找到插件入口文件' }
    }

    const tempPlugin = require(entryFile)
    if (!tempPlugin.name) {
      return { success: false, error: '插件缺少 name 字段' }
    }

    const destDir = path.join(PLUGINS_DIR, tempPlugin.name)

    // 如果已存在则先删除（覆盖安装）
    if (fs.existsSync(destDir)) {
      // 先卸载旧的
      unload(tempPlugin.name)
      fs.rmSync(destDir, { recursive: true, force: true })
    }

    // 递归复制
    copyDirRecursive(sourceDir, destDir)

    // 加载新插件
    const result = loadPlugin(destDir, tempPlugin.name)
    if (result.success && result.plugin) {
      const plugin = result.plugin
      _plugins.set(plugin.name, plugin)

      if (plugin._enabled && plugin.onLoad) {
        try { plugin.onLoad({ pluginsDir: PLUGINS_DIR, pluginDir: destDir, logger: console }) }
        catch (e) { console.error(`[Plugins] ${plugin.name}.onLoad 失败:`, e.message) }
      }
      if (plugin._enabled && plugin.tools) {
        for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
          _toolRegistry.set(toolName, { plugin, execute: toolDef.execute, def: toolDef })
        }
      }

      return { success: true, plugin: summarizePlugin(plugin) }
    }

    return { success: false, error: result.error }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 卸载并删除插件
 */
function uninstall(name) {
  const plugin = _plugins.get(name)
  if (!plugin) return { success: false, error: `插件 ${name} 未加载` }

  unload(name)

  // 删除目录
  if (plugin._dir && fs.existsSync(plugin._dir)) {
    fs.rmSync(plugin._dir, { recursive: true, force: true })
  }

  // 清除状态
  delete _state[plugin._dirName]
  saveState()

  return { success: true }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// ========== 查询接口 ==========

/**
 * 获取所有插件摘要
 */
function listAll() {
  const result = []
  for (const plugin of _plugins.values()) {
    result.push(summarizePlugin(plugin))
  }
  return result
}

/**
 * 获取已启用的插件
 */
function getEnabledPlugins() {
  return Array.from(_plugins.values()).filter(p => p._enabled)
}

/**
 * 获取所有注册的工具
 */
function getAllTools() {
  const tools = []
  for (const [name, entry] of _toolRegistry) {
    tools.push({
      name,
      description: entry.def.description,
      params: entry.def.params,
      plugin: entry.plugin.name,
    })
  }
  return tools
}

/**
 * 执行注册的工具
 * @param {string} toolName
 * @param {object} params
 * @param {object} context
 */
async function executeTool(toolName, params, context = {}) {
  const entry = _toolRegistry.get(toolName)
  if (!entry) {
    return { success: false, error: `工具 ${toolName} 未注册` }
  }

  try {
    const result = await entry.execute(params, {
      ...context,
      plugin: entry.plugin,
    })
    return result
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ========== 钩子系统 ==========

/**
 * 按顺序执行钩子链
 * @param {string} hookName
 * @param {...any} args
 * @returns {Promise<any>} 最后一个钩子可能修改的结果
 */
async function runHooks(hookName, ...args) {
  const enabledPlugins = getEnabledPlugins()
  // 按优先级排序
  enabledPlugins.sort((a, b) => (b.priority || 0) - (a.priority || 0))

  let result = args[args.length - 1] // 最后一个参数通常是可变结果

  for (const plugin of enabledPlugins) {
    if (!plugin.hooks || typeof plugin.hooks[hookName] !== 'function') continue

    try {
      const hookResult = await plugin.hooks[hookName](...args)
      // 更新结果（如果有返回值）
      if (hookResult !== undefined && hookResult !== null) {
        result = hookResult
        args[args.length - 1] = result
      }
    } catch (e) {
      console.error(`[Plugins] ${plugin.name}.${hookName} 钩子失败:`, e.message)
    }
  }

  return result
}

/**
 * 收集所有 contextProvider 的输出
 * @param {string} userInput
 * @param {object} context
 * @returns {Promise<string>}
 */
async function collectContextProviders(userInput, context = {}) {
  const enabledPlugins = getEnabledPlugins()
  const parts = []

  for (const plugin of enabledPlugins) {
    if (!plugin.contextProvider) continue

    // 检查触发词（如果插件声明了 triggers，则仅在匹配时调用）
    if (plugin.triggers && plugin.triggers.length > 0) {
      const inputLower = userInput.toLowerCase()
      const matched = plugin.triggers.some(t => inputLower.includes(t.toLowerCase()))
      if (!matched) continue
    }

    try {
      const ctxStr = await plugin.contextProvider(userInput, context)
      if (ctxStr && typeof ctxStr === 'string') {
        parts.push(`<!-- plugin: ${plugin.name} -->\n${ctxStr}`)
      }
    } catch (e) {
      console.error(`[Plugins] ${plugin.name}.contextProvider 失败:`, e.message)
    }
  }

  return parts.join('\n\n')
}

// ========== 目录监听 ==========

function watchDir(callback) {
  if (_watcher) return
  ensurePluginsDir()

  let debounce = null
  try {
    _watcher = fs.watch(PLUGINS_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename || filename.startsWith('.')) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        console.log(`[Plugins] 检测到目录变化: ${eventType} ${filename}`)
        // 热重载：卸载所有 → 重新加载
        unloadAll()
        loadAll()
        if (callback) callback()
      }, 1000)
    })
    console.log('[Plugins] 已启动目录监听:', PLUGINS_DIR)
  } catch (e) {
    console.warn('[Plugins] 启动目录监听失败:', e.message)
  }
}

function stopWatch() {
  if (_watcher) {
    _watcher.close()
    _watcher = null
  }
}

module.exports = {
  // 生命周期
  loadAll,
  unloadAll,
  unload,
  // 管理
  setEnabled,
  installFromDir,
  uninstall,
  // 查询
  listAll,
  getEnabledPlugins,
  getAllTools,
  executeTool,
  // 钩子
  runHooks,
  collectContextProviders,
  // 监听
  watchDir,
  stopWatch,
  // 常量
  PLUGINS_DIR,
}

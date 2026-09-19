'use strict'

/**
 * 插件接口定义与验证
 *
 * 插件是一个 Node.js 模块，导出符合 PluginInterface 的对象。
 *
 * 接口规范：
 *
 * module.exports = {
 *   name: 'my-plugin',           // 必填，插件标识（英文小写+连字符）
 *   version: '1.0.0',            // 必填，语义化版本
 *   description: '描述',          // 必填
 *   author: '作者',              // 可选
 *
 *   // 生命周期钩子（均可选）
 *   onLoad(context) {},          // 插件加载时调用，context 提供 logger / sandbox
 *   onUnload() {},               // 插件卸载时调用，用于清理资源
 *
 *   // 工具注册（可选）
 *   // 注册的工具会被 ReAct 引擎作为可调用的 action
 *   tools: {
 *     'my-tool': {
 *       description: '工具描述',
 *       params: {
 *         input: { type: 'string', required: true, description: '输入参数' }
 *       },
 *       execute: async (params, context) => {
 *         return { success: true, data: { result: '...' } }
 *       }
 *     }
 *   },
 *
 *   // 钩子（可选）
 *   hooks: {
 *     beforeContextBuild: async (context) => { /* 可修改 context *\/ },
 *     onUserMessage: async (userInput) => { /* 可返回修改后的输入 *\/ },
 *   },
 *
 *   // 上下文注入器（可选）
 *   // 返回的字符串会被注入到 AI prompt 中
 *   contextProvider: async (userInput, context) => {
 *     return '额外的上下文信息'
 *   },
 *
 *   // 触发词（可选）
 *   // 当用户输入匹配这些词时，插件的 contextProvider 会被优先调用
 *   triggers: ['关键词1', '关键词2'],
 *
 *   // 优先级（可选，默认 0，越高越优先）
 *   priority: 10,
 * }
 */

const REQUIRED_FIELDS = ['name', 'version', 'description']

/**
 * 验证插件接口合法性
 * @param {object} plugin - 插件模块导出对象
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validatePlugin(plugin) {
  const errors = []
  const warnings = []

  if (!plugin || typeof plugin !== 'object') {
    return { valid: false, errors: ['插件导出必须是一个对象'], warnings: [] }
  }

  // 必填字段
  for (const field of REQUIRED_FIELDS) {
    if (!plugin[field]) {
      errors.push(`缺少必填字段: ${field}`)
    }
  }

  // name 格式校验
  if (plugin.name && !/^[a-z0-9][a-z0-9-]*$/.test(plugin.name)) {
    errors.push(`name 必须是英文小写+连字符格式，如: my-plugin`)
  }

  // version 语义化校验
  if (plugin.version && !/^\d+\.\d+\.\d+/.test(plugin.version)) {
    warnings.push(`version 建议使用语义化版本号，如: 1.0.0`)
  }

  // tools 验证
  if (plugin.tools) {
    if (typeof plugin.tools !== 'object' || Array.isArray(plugin.tools)) {
      errors.push('tools 必须是对象')
    } else {
      for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(toolName)) {
          errors.push(`工具名 "${toolName}" 必须是英文小写+连字符格式`)
        }
        if (typeof toolDef !== 'object') {
          errors.push(`工具 "${toolName}" 定义必须是对象`)
          continue
        }
        if (!toolDef.description) {
          warnings.push(`工具 "${toolName}" 缺少 description`)
        }
        if (typeof toolDef.execute !== 'function') {
          errors.push(`工具 "${toolName}" 缺少 execute 函数`)
        }
        if (toolDef.params && typeof toolDef.params !== 'object') {
          errors.push(`工具 "${toolName}" 的 params 必须是对象`)
        }
      }
    }
  }

  // hooks 验证
  if (plugin.hooks) {
    const validHooks = [
      'beforeContextBuild',
      'onUserMessage',
    ]
    for (const [hookName, hookFn] of Object.entries(plugin.hooks)) {
      if (!validHooks.includes(hookName)) {
        warnings.push(`未知的 hook: ${hookName}（有效值: ${validHooks.join(', ')}）`)
      }
      if (typeof hookFn !== 'function') {
        errors.push(`hook "${hookName}" 必须是函数`)
      }
    }
  }

  // contextProvider 验证
  if (plugin.contextProvider && typeof plugin.contextProvider !== 'function') {
    errors.push('contextProvider 必须是函数')
  }

  // triggers 验证
  if (plugin.triggers && !Array.isArray(plugin.triggers)) {
    errors.push('triggers 必须是数组')
  }

  // onLoad / onUnload 验证
  if (plugin.onLoad && typeof plugin.onLoad !== 'function') {
    errors.push('onLoad 必须是函数')
  }
  if (plugin.onUnload && typeof plugin.onUnload !== 'function') {
    errors.push('onUnload 必须是函数')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * 生成插件摘要（用于展示）
 * @param {object} plugin
 * @returns {object}
 */
function summarizePlugin(plugin) {
  return {
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author || 'unknown',
    priority: plugin.priority || 0,
    enabled: plugin._enabled !== false,
    tools: plugin.tools ? Object.keys(plugin.tools) : [],
    hooks: plugin.hooks ? Object.keys(plugin.hooks) : [],
    hasContextProvider: !!plugin.contextProvider,
    triggers: plugin.triggers || [],
  }
}

module.exports = {
  validatePlugin,
  summarizePlugin,
  REQUIRED_FIELDS,
}

# Muse AI-Terminal 插件开发指南

## 概述

Muse AI-Terminal 插件系统允许社区开发者为 Muse Agent 扩展三种核心能力：

1. **工具（Tools）**：注册自定义工具，供 ReAct 引擎作为可调用的 action
2. **钩子（Hooks）**：在技能执行前/后、用户消息处理时注入逻辑
3. **上下文注入器（Context Provider）**：向 AI prompt 动态注入额外上下文

## 快速开始

### 1. 创建插件目录

```bash
mkdir -p ~/.ai-terminal/plugins/my-plugin
```

### 2. 创建插件入口文件

在 `~/.ai-terminal/plugins/my-plugin/plugin.js` 中编写：

```javascript
'use strict'

module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '我的第一个插件',

  onLoad(context) {
    console.log('[My Plugin] 已加载')
  },

  // 注册一个简单工具
  tools: {
    'hello': {
      description: '向指定的人打招呼',
      params: {
        name: { type: 'string', required: true, description: '对方的名字' },
      },
      async execute(params) {
        return {
          success: true,
          data: { message: `Hello, ${params.name}!` },
        }
      },
    },
  },
}
```

### 3. 自动加载

插件系统在应用启动时自动扫描 `~/.ai-terminal/plugins/` 目录。修改插件后可通过 IPC 调用 `plugins:reload` 热重载。

## 插件接口规范

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 插件标识（英文小写+连字符，如 `my-plugin`） |
| `version` | string | 语义化版本号（如 `1.0.0`） |
| `description` | string | 插件描述 |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | string | 作者 |
| `priority` | number | 优先级（0-100，越高越优先，默认 0） |
| `triggers` | string[] | 触发词列表，匹配时 contextProvider 被调用 |
| `onLoad` | function | 插件加载时调用 |
| `onUnload` | function | 插件卸载时调用 |
| `tools` | object | 工具注册表 |
| `hooks` | object | 钩子函数集 |
| `contextProvider` | function | 上下文注入器 |

## 工具（Tools）

工具是插件最强大的能力。注册的工具会被 ReAct 引擎作为可调用的 action。

```javascript
tools: {
  'tool-name': {
    description: '工具描述（AI 会根据描述决定何时调用）',
    params: {
      param1: {
        type: 'string',           // string | number | boolean
        required: true,           // 是否必填
        description: '参数说明',
        default: '默认值',        // 可选
      },
    },
    async execute(params, context) {
      // params: 用户提供的参数
      // context: { plugin, ... }

      // 返回格式
      return {
        success: true,
        data: { result: '...' },
        needConfirm: false,       // 是否需要用户确认
      }
    },
  },
}
```

## 钩子（Hooks）

### beforeSkillExecute

在技能执行前调用。返回 `false` 可阻止执行。

```javascript
hooks: {
  async beforeSkillExecute(skill, params) {
    // skill: 被激活的技能对象
    // params: 参数对象（可修改）
    console.log(`即将执行技能: ${skill.name}`)

    // 返回 false 阻止执行
    if (skill.dangerous && !params._userConfirmed) {
      return false
    }

    return params
  },
}
```

### afterSkillExecute

在技能执行后调用。

```javascript
hooks: {
  async afterSkillExecute(skill, params, result) {
    // 可以修改 result
    console.log(`技能 ${skill.name} 执行完成`)
    return result
  },
}
```

### onUserMessage

在用户消息到达技能匹配前调用。可修改用户输入。

```javascript
hooks: {
  async onUserMessage(userInput) {
    // 返回修改后的输入
    return userInput.replace(/foo/g, 'bar')
  },
}
```

### beforeContextBuild

在上下文构建前调用。

```javascript
hooks: {
  async beforeContextBuild(context) {
    // 可以修改 context 对象
    context.customField = 'value'
  },
}
```

## 上下文注入器（Context Provider）

```javascript
async contextProvider(userInput, context) {
  // userInput: 用户当前输入
  // context: { activeSkillId, sessionId, ... }

  // 返回的字符串会被注入到 AI prompt 中
  return `## 自定义上下文\n当前时间: ${new Date().toISOString()}`
}
```

如果声明了 `triggers`，则 contextProvider 仅在用户输入匹配触发词时被调用。未声明 triggers 则每次都调用。

## 生命周期管理

### onLoad

```javascript
onLoad(context) {
  // context 包含:
  // - logger: console 对象
  // - pluginsDir: 插件根目录
  // - pluginDir: 当前插件目录
  // - skillsDB: 技能数据库（可选）

  // 适合做初始化工作
  this.cache = new Map()
}
```

### onUnload

```javascript
onUnload() {
  // 清理资源
  if (this.timer) clearInterval(this.timer)
}
```

## 插件目录结构

```
~/.ai-terminal/plugins/
├── my-plugin/
│   ├── plugin.js          # 入口文件（或 index.js）
│   ├── package.json       # 可选，依赖声明
│   ├── lib/               # 插件私有库
│   └── assets/            # 静态资源
├── another-plugin/
│   └── plugin.js
└── .plugin-state.json     # 插件状态（启用/禁用）
```

## IPC 接口

前端可通过以下 IPC 管理插件：

| IPC 通道 | 参数 | 说明 |
|----------|------|------|
| `plugins:list` | - | 获取所有插件列表 |
| `plugins:tools` | - | 获取所有注册的工具 |
| `plugins:setEnabled` | `{ name, enabled }` | 启用/禁用插件 |
| `plugins:installFromDir` | `{ sourceDir }` | 从目录安装插件 |
| `plugins:selectDir` | - | 选择插件目录（对话框） |
| `plugins:uninstall` | `{ name }` | 卸载插件 |
| `plugins:reload` | - | 热重载所有插件 |
| `plugins:executeTool` | `{ toolName, params }` | 执行工具 |

## 最佳实践

### 1. 错误处理

所有工具执行都应返回标准格式：

```javascript
async execute(params) {
  try {
    // 业务逻辑
    return { success: true, data: { ... } }
  } catch (error) {
    return { success: false, error: error.message }
  }
}
```

### 2. 资源清理

在 `onUnload` 中清理定时器、文件句柄等资源：

```javascript
onLoad() {
  this.timer = setInterval(() => { ... }, 60000)
}
onUnload() {
  if (this.timer) clearInterval(this.timer)
}
```

### 3. 避免上下文膨胀

contextProvider 返回的内容会被注入到 AI prompt 中。避免返回过长的文本（建议 < 2000 字符）。

### 4. 使用 triggers 限定范围

声明 triggers 可以让 contextProvider 仅在相关场景被调用，避免不必要的上下文注入。

### 5. 优先级设置

高优先级插件的钩子会先执行。对于关键路径上的插件（如安全检查），设置较高的 priority。

## 与技能系统的关系

| 维度 | 技能（Skill） | 插件（Plugin） |
|------|--------------|----------------|
| 定义方式 | SKILL.md（Markdown + YAML） | plugin.js（代码模块） |
| 主要能力 | Prompt 注入、脚本执行 | 工具注册、钩子、上下文注入 |
| 运行时机 | 用户主动激活或 trigger 匹配 | 系统启动自动加载 |
| 修改用户输入 | 否 | 是（通过 onUserMessage 钩子） |
| 注册新工具 | 否 | 是 |
| 适合场景 | 领域知识、工作流 | 基础设施、工具集成 |

技能和插件可以协同工作：插件可以在技能执行前后通过钩子注入逻辑，也可以通过 contextProvider 为技能提供额外的上下文。

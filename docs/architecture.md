# 架构设计

## 分层架构

```
┌─────────────────────────────────────────────┐
│              用户交互层                       │
│    Chat UI / Terminal / Browser Preview      │
├─────────────────────────────────────────────┤
│              引擎调度层                       │
│  Plan FSM │ Batch 执行器 │ 元认知监控        │
│  Context Manager │ Token Monitor │ Recovery  │
├─────────────────────────────────────────────┤
│           Model Provider 层                  │
│  OpenAI Compatible │ Ali Studio (legacy)    │
├─────────────────────────────────────────────┤
│              工具执行层                       │
│  file │ apply_patch │ command │ browser     │
│  search │ sandbox                            │
├─────────────────────────────────────────────┤
│              持久化层                        │
│  Task State │ Memory │ Trace                 │
└─────────────────────────────────────────────┘
```

## 核心模块

### 引擎调度层

| 模块 | 文件 | 职责 |
|------|------|------|
| ReAct Engine | `src/main/muse/react-engine.js` | Thought → Action → Observation 循环 |
| Plan FSM | `src/main/muse/react-engine.js` | Plan 状态机，拦截 premature final |
| Meta-Cognitive | `src/main/muse/react-engine.js` | 死循环检测、失败模式分类 |
| Context Manager | `src/main/context-builder.js` | 4 级上下文压缩 |
| Token Monitor | `src/main/token-monitor.js` | 全链路 token 追踪 |
| Sandbox | `src/main/sandbox.js` | 工作区隔离、命令安全 |

### Model Provider 层

| 模块 | 文件 | 职责 |
|------|------|------|
| Model Provider | `src/shared/model-provider.js` | 统一模型调用抽象（OpenAI / AI Studio） |
| AI Client | `src/shared/ai-client.js` | 对外接口（callAI / callAIStream / analyzeImages） |

### 工具执行层

| 模块 | 文件 | 职责 |
|------|------|------|
| Tool Registry | `src/main/task-engine/tools/index.js` | 工具注册与管理 |
| File Tool | `src/main/task-engine/tools/file.js` | 文件读写编辑 |
| Command Tool | `src/main/task-engine/tools/command.js` | 命令执行（带安全分析） |
| Browser Tool | `src/main/task-engine/tools/browser.js` | 浏览器自动化 |
| MCP Server | `src/mcp-server/index.js` | MCP 协议工具暴露 |

## 数据流

```
用户输入
  │
  ▼
Muse Router (路由判断：聊天 / ReAct / 任务引擎)
  │
  ├── 聊天路径 → AI Client → callAI → Model Provider → OpenAI/AI Studio
  │                 ↓
  │           AI Wrapper (SCRIPT_BLOCK / SEARCH_REPLACE 解析)
  │
  └── ReAct 路径 → ReAct Engine
                     │
                     ├── Plan FSM (plan 完成度检查)
                     ├── Meta-Cognitive (异常检测)
                     ├── Tool Registry (工具调用)
                     │     ├── Sandbox (路径/命令安全)
                     │     └── AI Client (模型调用)
                     └── Token Monitor (用量追踪)
```

## 扩展点

### 1. 自定义工具

在 `src/main/task-engine/tools/` 下创建新文件，实现 `execute()` 方法，注册到 `ToolRegistry`：

```javascript
class MyTool {
  constructor() { this.name = 'my-tool' }
  async execute(params, options) {
    // 实现
    return { success: true, data: result }
  }
}
```

### 2. 自定义 Model Provider

在 `src/shared/model-provider.js` 中添加新的 provider 实现，在 `loadConfig()` 中添加分支。

### 3. MCP 工具

在 `src/mcp-server/index.js` 的 `TOOLS` 数组中添加工具定义，在 `executeTool()` 中添加执行逻辑。

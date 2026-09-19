<div align="center">

# Folio 📖

**The book that writes itself as you learn.**
**你学到哪，书就长到哪。**

本地优先的 AI 学习终端：把知识图谱读成一本活的书 —— 章节由 AI 按需撰写，圈选任意段落当场提问，下钻即长出新章节。

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/lin306808700-ux/folio/actions/workflows/ci.yml/badge.svg)](https://github.com/lin306808700-ux/folio/actions/workflows/ci.yml)
[![Electron](https://img.shields.io/badge/Electron-Desktop-47848F.svg)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

[为什么](#为什么是-folio) · [功能](#功能) · [快速开始](#快速开始) · [架构](#架构) · [路线图](#路线图)

</div>

---

![学习图谱 · 知识结构](docs/screenshots/hero-mindmap.png)

## 为什么是 Folio

大多数人的学习死在了散落的笔记里：收藏了几百篇文章，却拼不出一张完整的知识地图；看懂了某个概念，第二天又忘了它挂在哪个体系下。

Folio 给学习装上一根**脊梁**。

你为任意领域建一张知识图谱 —— Java 后端、前端、分布式系统 —— Folio 把它写成一本有主线的书，一次一章：**清晰的技术要点、讲透「为什么」的讲解、可直接运行的代码实例**，没有含糊其辞的概括。

它读起来像纸书，用起来像 Agent：圈选任何一段就能提问，像划出书中一段去问老师。对任何概念下钻，Folio 就在它下面长出新章节 —— 书的边界跟着你的好奇心一起扩张。你的疑问会留在页边，书记住了你在哪里卡住过。

章节在后台预先写好，翻到那一页时，内容已经等在那里了。

## 功能

### 📖 活的书 · Living Book

每个知识节点就是一章。AI 按固定结构撰写正文：**技术要点 → 深入讲解 → 代码实例 → 常见误区与考点**，拒绝笼统介绍。写完即持久化，下次打开直接读。

章节正文里支持表格、代码高亮与「复制代码」等阅读细节：

![AI 撰写的章节正文](docs/screenshots/book-reader.png)

### ✂️ 圈选提问 · Select & Ask

书上任何看不懂的地方，圈选即问。浮动工具条提供「圈选提问」与「下钻」两个动作，答案流式返回，并沉淀进该章节的 Q&A 区 —— **你的困惑成为书的一部分**。

![圈选提问](docs/screenshots/selection-ask.png)

### 🌱 下钻衍生 · Drill Down

圈选后可让 AI 衍生出子知识点，自动挂到当前节点下长出新章节。结构由你的追问塑造，而不是由预设目录决定。

### ⚡ 后台预生成 · Background Prefetch

打开应用后，AI 在后台按「当前位置 → BFS 子树 → 其余」的顺序逐章预制内容。交互请求（聊天 / 提问 / 手动撰写）随时抢占，零排队；被抢占的章节留队重试，不丢进度。顶栏实时显示预制进度。

### 🗺️ 知识图谱 · Knowledge Graph

- 思维导图与树形大纲双视图，节点四态：**未开始 / 学习中 / 已理解 / 已验证**
- 进度看板：知识分布、当前位置、掌握证据一目了然
- 支持自建图谱，节点可随时增删改与调整掌握状态

![进度看板](docs/screenshots/progress-board.png)

### 🤖 AI Terminal

内置 AI 对话与 ReAct 工具执行引擎：命令安全策略 + 沙箱隔离 + 调用标签注册表（交互请求可抢占后台任务）。支持 MCP Server 与插件体系。

## 快速开始

### 环境要求

- Node.js ≥ 18
- 一个可用的模型通道（二选一）：
  - **qoder**（默认）：本机已安装并登录 `qodercli`，零密钥
  - **openai**：任意 OpenAI 兼容 API（OpenAI / DeepSeek / Ollama / vLLM…）

### 安装

```bash
git clone https://github.com/lin306808700-ux/folio.git
cd folio

# 一次装好主进程 + 渲染层两处依赖
npm run install:all
```

> `npm run install:all` 等价于 `npm install && npm --prefix src/renderer install`。
> 渲染层依赖是独立的，只跑根目录的 `npm install` 不足以启动前端。

### 配置模型通道

```bash
cp .env.example .env
```

默认 `qoder` 模式可不配置。使用 OpenAI 兼容 API 时，编辑 `.env`：

```bash
MUSE_MODEL_PROVIDER=openai
MUSE_API_BASE_URL=https://api.deepseek.com/v1
MUSE_API_KEY=your-deepseek-key
MUSE_MODEL=deepseek-coder
```

### 启动

```bash
# 开发模式（webpack 前端热重载 + Electron）
npm run dev

# 或：以生产模式运行（先构建前端，再启动）
npm run build:renderer && npm start
```

首次打开即可阅读内置的演示图谱 **「AI Agent 实现原理」**（17 章，含完整正文），无需先配置模型也能看到完整效果。

## 架构

```
folio/
├── src/main/                 # Electron 主进程
│   ├── muse/                 # 学习图谱存储 / AI 提示词 / 后台预生成管线
│   │   ├── learning-maps.js           # 图谱持久化（JSON store，原子写）
│   │   ├── learning-seeds.js          # 内置图谱装载（见下方说明）
│   │   ├── learning-prompts.js        # 撰写 / 提问 / 下钻三类提示词
│   │   └── learning-prefetch.js       # 后台预生成队列 + 交互抢占调度
│   ├── ipc/                  # IPC 流式通道（requestId + AbortController）
│   ├── sandbox/              # 命令安全策略与沙箱执行
│   └── task-engine/          # ReAct 任务引擎
├── src/renderer/             # React + Ant Design 渲染层
│   └── src/
│       ├── pages/LearningMapPage.tsx          # 图谱 / 看板 / 抽屉
│       └── components/LearningBookReader.tsx   # 阅读器 + 圈选交互
├── src/shared/model-provider.js  # 模型适配层（qoder / openai，调用标签注册表）
├── src/mcp-server/           # MCP Server
├── scripts/                  # 构建与截图辅助脚本
└── plugins/                  # 插件示例
```

**关键机制**

| 机制 | 说明 |
| --- | --- |
| AI 按需撰写 | 章节正文不落死数据，AI 生成后持久化到节点 `content` |
| 调用标签注册表 | 每次 AI 调用带 label；`isAiBusy()` 让路检测、`abortCallsByLabel()` 交互抢占 |
| 预生成队列 | 当前位置优先的 BFS 排序，被抢占章节留队重试，不丢进度 |
| 流式 IPC | requestId 关联请求与推送，渲染端随时可中断 |

**内置图谱的两个数据源**

`src/main/muse/learning-seeds.js` 按优先级装载：

1. `builtin-learning-maps.json` —— 完整内置内容，由 `scripts/export-builtin-maps.js` 从本地真实生成结果导出，**不随仓库发布**（见 `.gitignore`）
2. `builtin-learning-maps.demo.json` —— 随仓库发布的演示图谱，保证克隆后开箱可读

两者都不存在时降级为空种子，内容全部走 AI 预生成。

更多细节见 [docs/architecture.md](docs/architecture.md) 与 [docs/codebase-map.md](docs/codebase-map.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式：webpack 前端热重载 + Electron |
| `npm run build:renderer && npm start` | 生产模式运行 |
| `npm run build` | 用 electron-builder 打包（dmg / exe / AppImage） |
| `npm test` | 主进程单测 + 渲染层单测 |
| `npm run check` | 语法检查 + 全部测试 + 前端构建（提交前请务必跑通） |

## 路线图

见 [ROADMAP.md](ROADMAP.md)。欢迎在 Issues 里提出你想让 Folio 写的第一本书。

## 贡献

阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md) 了解协作约定。提交前请跑 `npm run check`。

如果 Folio 对你有用，**给个 Star ⭐ 是最好的支持** —— 它能让更多正在搭知识体系的人看到这个项目。

## License

[Apache License 2.0](LICENSE) · Copyright 2026 changyuan.lcy

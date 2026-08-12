# Contributing to Muse AI Terminal

感谢你愿意参与 Muse AI Terminal。项目仍在建立公开协作流程，当前最需要的是可复现问题、测试、文档和跨平台验证。

## 开始之前

1. 搜索现有 Issue，避免重复工作。
2. 对较大的功能或行为变化，先开 Issue 说明问题、用户场景和方案。
3. 安全漏洞不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 报告。

## 本地开发

```bash
npm ci
npm ci --prefix src/renderer --legacy-peer-deps
cp .env.example .env
npm run dev
```

提交前运行：

```bash
npm run check
```

## 变更原则

- 保持 Electron renderer、preload 和 main process 的边界清晰。
- IPC 变更必须同步更新 main handler、preload bridge 和 renderer 类型。
- 涉及取消、持久化、任务状态或安全策略时，必须补充回归测试。
- 不提交 `.env`、API Key、用户数据、安装包、`node_modules` 或生成的 bundle。
- UI 使用共享 `PageShell` 和语义主题变量，不增加页面级全屏背景系统。
- 不在消息气泡中暴露内部协议或原始 JSON。

更详细的模块入口和行为契约见 [docs/codebase-map.md](docs/codebase-map.md)。

## Pull Request

一个 PR 尽量只解决一个明确问题，并包含：

- 为什么要改；
- 用户可见行为；
- 测试或验证方式；
- UI 变更的截图或录屏；
- 已知限制和后续工作。

提交信息建议使用 Conventional Commits，例如 `fix: stop protocol parsing after abort`。

## Issue 标签建议

- `good first issue`：边界清楚、无需深层架构背景；
- `help wanted`：维护者确认方向并欢迎社区实现；
- `security`：只用于已公开且不包含利用细节的问题；
- `platform:macos`、`platform:windows`、`platform:linux`：平台相关问题。

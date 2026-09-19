# 截图目录

README 引用的截图放在这里，文件名与 README 中的引用一一对应：

| 文件名 | 内容 |
| --- | --- |
| `hero-mindmap.png` | 学习图谱 · 知识结构（思维导图全貌） |
| `book-reader.png` | 节点抽屉 · AI 撰写的章节正文（技术要点 / 讲解 / 表格 / 代码实例） |
| `selection-ask.png` | 圈选正文后浮出的「圈选提问 / 下钻」工具条 |
| `progress-board.png` | 进度看板视图（未开始 / 学习中 / 已理解 / 已验证） |

## 截图规范

- 由应用真实界面截取，不使用设计稿或手工合成
- 尺寸 3200×2000（1600×1000 视口的 2x 屏截图），PNG
- 内容基于仓库内置的演示图谱「AI Agent 实现原理」

## 重新生成

截图通过 Chromium DevTools Protocol 驱动真实 Electron 渲染进程采集，不依赖窗口焦点，也不会掺入桌面内容：

```bash
# 1. 构建渲染层并启动应用（开放调试端口）
npm run build:renderer
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9222

# 2. 另开终端执行采集脚本（脚本会依次切换视图、打开节点、构造选区）
node scripts/capture-screenshots.js docs/screenshots
```

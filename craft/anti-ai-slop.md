---
name: anti-ai-slop
description: 检查并消除 AI 生成内容中的典型 AI 痕迹和低质量模式
category: frontend
severity: P0
triggers:
  - html
  - css
  - 前端
  - 页面
  - ui
  - 组件
  - landing
  - dashboard
  - 网页
  - 界面
autoApply: true
---

## 视觉反模式检查清单

以下模式是 AI 生成前端代码的典型痕迹，必须逐项检查并修正：

### 配色
- [ ] 禁止紫蓝渐变（`#667eea → #764ba2` 或类似）作为主色调，选择有品牌辨识度的配色
- [ ] 禁止未经设计的随机渐变，如果需要渐变须有明确的设计意图
- [ ] 颜色不超过 5 种（1 主色 + 1 强调色 + 中性色阶），多于此数需要理由

### 布局
- [ ] 禁止千篇一律的 Hero → Features(3列卡片) → Pricing → FAQ → CTA 结构
- [ ] 禁止毛玻璃卡片（`backdrop-filter: blur`）+ 圆角 + 左边框彩色装饰的组合
- [ ] 禁止无意义的装饰性 blob/wave SVG 背景
- [ ] 至少包含一个非常规的区块设计

### 图标与装饰
- [ ] 禁止用 Emoji 作为功能图标（✨🚀🎯⚡💡🔥），改用单色 SVG 图标或文字
- [ ] 禁止凭空捏造的营销数据（"10x faster"、"99.9% uptime"、"10,000+ users"），用标注为示例的占位数据

### 文案
- [ ] 禁止泛泛的标题如 "Revolutionize Your Workflow"、"Unleash the Power of..."
- [ ] 禁止在每个 feature 卡片用 "With our..." 开头
- [ ] CTA 按钮文案要具体（"开始 14 天试用" 而非 "Get Started"）

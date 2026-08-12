---
name: accessibility-baseline
description: 检查前端代码的基本无障碍可访问性
category: frontend
severity: P1
triggers:
  - html
  - 前端
  - 页面
  - ui
  - 组件
  - 表单
  - form
autoApply: true
---

## 无障碍基线检查清单

### 语义化 HTML（P0）
- [ ] 使用语义标签（`<nav>`, `<main>`, `<article>`, `<section>`, `<header>`, `<footer>`）而非纯 `<div>` 堆砌
- [ ] 标题层级正确递进（不跳级，如 h1 → h3）
- [ ] 列表内容使用 `<ul>/<ol>` 而非 `<div>` 模拟

### 交互元素（P0）
- [ ] 所有可点击元素是 `<button>` 或 `<a>`，不是带 onClick 的 `<div>`/`<span>`
- [ ] 所有交互元素有可见的 focus 状态（`outline` 或自定义 focus 样式）
- [ ] 表单控件有关联的 `<label>`（通过 `for`/`htmlFor` 或嵌套）
- [ ] 图标按钮有 `aria-label` 描述

### 图片与媒体（P1）
- [ ] `<img>` 有 `alt` 属性（装饰性图片用 `alt=""`）
- [ ] 不依赖纯颜色传达信息（色盲友好）

### 键盘（P1）
- [ ] Tab 顺序合理（不使用正数 `tabindex`）
- [ ] 模态框/下拉菜单可通过 Escape 关闭

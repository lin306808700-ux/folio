---
name: code-quality
description: 代码编写的质量标准和最佳实践
triggers:
  - 代码
  - 函数
  - 重构
  - refactor
  - 优化
  - 实现
  - 开发
  - 编写
category: code
priority: 5
exclusive: false
---

## 命名

- 避免 1-2 个字符的变量名，使用有意义的完整单词
- 函数用动词/动词短语，变量用名词/名词短语
- 示例：`genYmdStr` → `generateDateString`，`n` → `numSuccessfulRequests`

## 控制流

- 使用 guard clause / 提前返回，减少嵌套
- 先处理错误和边界情况
- 避免超过 2-3 层的嵌套
- 不要捕获错误后什么都不做

## 注释

- 不要为显而易见的代码加注释
- 复杂逻辑注释解释"为什么"而非"怎么做"
- 禁止 TODO 注释，直接实现

## 结构

- 单一职责：每个函数/模块只做一件事
- 优先组合而非继承
- 保持函数短小（建议不超过 30 行）
- 相关代码放在一起，不相关的分离

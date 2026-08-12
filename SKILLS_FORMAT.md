# 技能 Schema 标准 v2

## 概述

技能（Skill）是 AI 终端的核心扩展机制。每个技能是一个目录，包含 `SKILL.md` 文件和可选的脚本/参考文档。

v2 版本在原有 Markdown 技能基础上，通过 **YAML frontmatter** 引入结构化 Schema，实现：
- **入参校验**：自动检查参数，缺参自动追问
- **触发词匹配**：用户输入自动匹配技能
- **错误恢复**：`onError` 策略（retry/abort/fallback/ask）
- **版本回滚**：`rollback` 命令
- **副作用声明**：`sideEffects` 权限审计
- **向后兼容**：无 Schema 字段的旧技能照常工作

## 目录结构

```
~/.ai-terminal/skills/
├── dashboard-deploy/
│   ├── SKILL.md              # 技能定义（YAML frontmatter + Markdown）
│   ├── script.py             # 可选：关联脚本
│   ├── scripts/              # 可选：脚本目录
│   │   └── deploy_client.py
│   ├── references/           # 可选：参考文档
│   │   └── api-guide.md
│   └── package.json          # 可选：依赖声明
├── code-expert/
│   └── SKILL.md
└── ...
```

## SKILL.md 格式

### 基础格式（向后兼容）

```markdown
---
name: 代码专家
description: "帮助编写高质量代码"
---

你是一个资深的编程专家...
```

### Schema 增强格式（v2）

```markdown
---
name: dashboard-deploy
version: 1.2.0
description: "全自动发布 web-l100-dashboard"

triggers:
  - 发布dashboard
  - 部署dashboard
  - 上线dashboard

inputs:
  env:
    type: enum
    values: [daily, pre, prod]
    default: daily
    description: "部署环境"
    askIfMissing: true
  branch:
    type: string
    default: master
    description: "部署分支"
  force:
    type: boolean
    default: false
    description: "是否强制部署"
    required: false

sideEffects:
  - modifies:git
  - opens:browser
  - writes:file

dangerous: true
onError: retry:2
rollback: "git reset --hard HEAD~1"
autoExecute: false
---

## 发布流程

1. 切换到目标分支并拉取最新代码
2. 执行构建和部署
3. 截图保存部署结果
```

## 字段说明

### 基础字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 技能名称，也是目录名 |
| `description` | string | 推荐 | 技能描述 |
| `version` | string | 可选 | 语义化版本号 |
| `autoExecute` | boolean | 可选 | 是否自动执行 steps（默认 false） |

### Schema 扩展字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `triggers` | string[] | 触发词列表，用户输入匹配时自动激活技能 |
| `inputs` | object | 输入参数定义，支持类型校验和自动追问 |
| `sideEffects` | string[] | 副作用声明，格式 `action:target` |
| `dangerous` | boolean | 是否为危险操作（需用户确认） |
| `onError` | string | 错误处理策略 |
| `rollback` | string | 回滚命令（执行失败时提供） |

### inputs 参数定义

每个参数支持以下属性：

| 属性 | 类型 | 说明 |
|------|------|------|
| `type` | string | 参数类型：`string` / `number` / `boolean` / `enum` |
| `description` | string | 参数描述（用于追问提示） |
| `default` | any | 默认值（有默认值则不追问） |
| `required` | boolean | 是否必填（默认 true） |
| `askIfMissing` | boolean | 缺失时是否追问（默认 true） |
| `values` | string[] | enum 类型的可选值列表 |
| `example` | string | 示例值（用于追问提示） |
| `min` / `max` | number | number 类型的范围限制 |

### onError 策略

| 策略 | 格式 | 说明 |
|------|------|------|
| `retry` | `retry` 或 `retry:N` | 自动重试（默认 2 次） |
| `abort` | `abort` | 立即终止，不重试 |
| `fallback` | `fallback` | 回退到备选方案 |
| `ask` | `ask` | 询问用户下一步操作（默认） |

### sideEffects 格式

```
action:target
```

常见值：
- `modifies:git` — 修改 Git 仓库
- `opens:browser` — 打开浏览器
- `writes:file` — 写入文件
- `deletes:file` — 删除文件
- `network:request` — 发起网络请求
- `system:config` — 修改系统配置

## 触发词匹配规则

当用户输入未激活任何技能时，系统自动扫描所有技能的 `triggers`：

1. **精确包含**：用户输入包含完整触发词（如 "帮我发布dashboard" 匹配 "发布dashboard"）
2. **分词模糊**：触发词的所有词都出现在用户输入中
3. **得分阈值**：匹配得分 > 0.15 才生效，避免误触发
4. **最佳匹配**：多个技能匹配时取得分最高的

匹配成功后：
- 如果 `inputs` 中有缺失参数 → 自动追问
- 参数齐全 → 自动激活技能并通知前端

## 参数提取规则

系统从用户输入中自动提取参数：

- **enum**：检查输入是否包含枚举值（如 "prod" → env=prod）
- **string/number**：匹配 `参数名=值`、`参数名 值`、`--参数名 值` 格式
- **boolean**：匹配 "是/否"、"true/false"、"开启/关闭" 等

提取不到时：
- 有 `default` → 使用默认值
- `askIfMissing: true` → 自动追问
- `required: false` → 跳过

## 安装方式

### 方式 1：从 URL 安装
```
用户："安装技能 https://github.com/your-name/skills 的 dashboard-deploy"
```

### 方式 2：本地创建
在 `~/.ai-terminal/skills/` 下创建目录和 `SKILL.md` 文件。

### 方式 3：AI 对话创建
```
用户："帮我创建一个发布 dashboard 的技能"
AI：引导用户定义技能内容，使用 SAVE_SKILL 格式保存
```

## 迁移指南

### 从 v1 迁移到 v2

v1 技能无需任何修改即可继续使用。要升级到 v2，只需在 frontmatter 中添加 Schema 字段：

**v1（原样保留）：**
```yaml
---
name: my-skill
description: "我的技能"
---
```

**v2（渐进增强）：**
```yaml
---
name: my-skill
description: "我的技能"
version: 1.0.0
triggers:
  - 执行我的技能
inputs:
  target:
    type: string
    description: "目标路径"
    askIfMissing: true
sideEffects:
  - writes:file
onError: ask
---
```

建议按以下顺序渐进迁移：
1. 先加 `triggers`（自动匹配）
2. 再加 `inputs`（参数校验 + 追问）
3. 最后加 `sideEffects` / `dangerous` / `rollback`（安全增强）

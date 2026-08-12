# 技能安装测试指南

## 🧪 测试方法

### 方法 1：使用本地测试服务器（推荐）

1. **启动测试服务器**
```bash
cd test-skills
python3 -m http.server 8000
```

2. **在 AI 终端中测试**
```
输入："npx skills add http://localhost:8000 --skill code-expert"
```

3. **预期结果**
- AI 识别并显示：🎯 检测到技能安装请求
- 显示 [安装技能] 按钮
- 点击按钮后显示：✅ 技能安装成功！
- 切换到"技能矩阵"页面，能看到"代码专家"

---

### 方法 2：使用 GitHub（真实场景）

1. **创建 GitHub 仓库**
```bash
# 创建仓库并推送 test-skills 内容
git init my-skills
cd my-skills
cp -r ../test-skills/* .
git add .
git commit -m "Add test skills"
git push origin main
```

2. **在 AI 终端中安装**
```
输入："npx skills add https://github.com/你的用户名/my-skills --skill code-expert"
```

---

### 方法 3：使用 GitHub Raw URL（直接）

如果技能文件已在 GitHub：
```
输入："npx skills add https://raw.githubusercontent.com/用户名/仓库名/main/skills --skill code-expert"
```

---

## 📝 测试用例

### 测试 1：成功安装
```
命令：npx skills add http://localhost:8000 --skill code-expert
预期：
✅ 识别安装命令
✅ 显示安装按钮
✅ 点击后成功安装
✅ 技能矩阵中出现"代码专家"
```

### 测试 2：安装调试助手
```
命令：npx skills add http://localhost:8000 --skill debug-helper
预期：
✅ 成功安装"调试助手"
```

### 测试 3：错误处理
```
命令：npx skills add http://localhost:8000 --skill not-exist
预期：
❌ 显示错误："HTTP 404: Not Found"
```

### 测试 4：自然语言
```
命令："安装技能 http://localhost:8000 的 code-expert"
预期：
✅ AI 识别
✅ 显示安装按钮
✅ 成功安装
```

---

## 🔍 调试信息

安装失败时，查看 Electron 主进程日志：

```
[Main] 安装技能请求: { url: '...', skillName: '...' }
[Main] 原始 URL: ...
[Main] 转换后 URL: ...
[Main] 最终下载 URL: ...
[Main] 下载成功，响应状态: 200
[Main] 技能安装成功: 代码专家
```

---

## ⚠️ 常见问题

### 问题 1：400 错误
**原因**：可能是 URL 格式不正确或文件不存在
**解决**：检查 URL 是否可访问，技能文件是否存在

### 问题 2：CORS 错误
**原因**：本地测试服务器可能有 CORS 限制
**解决**：使用 GitHub 或配置 CORS 头

### 问题 3：JSON 解析错误
**原因**：JSON 文件格式不正确
**解决**：验证 JSON 格式，确保有 name 和 prompt 字段

---

## 📊 成功示例

### 输入
```
你："npx skills add http://localhost:8000 --skill code-expert"
```

### AI 回复
```
🎯 检测到技能安装请求
仓库：http://localhost:8000
技能：code-expert
[安装技能]  ← 点这里
```

### 安装成功
```
✅ 技能安装成功！

技能名称：代码专家
描述：帮助编写高质量代码，提供最佳实践建议

已添加到技能矩阵，可在技能矩阵页面查看。
```

---

## 🎯 快速开始

**一键测试命令**：

```bash
# 终端 1：启动测试服务器
cd ai-terminal/test-skills && python3 -m http.server 8000

# 终端 2：启动应用
cd ai-terminal && tnpm run dev

# AI 终端中输入：
npx skills add http://localhost:8000 --skill code-expert
```

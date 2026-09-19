# 沙箱安全机制

Muse Folio 提供工作区隔离层，限制 AI 的文件系统和命令执行范围。

## 安全机制

### 1. 路径隔离

文件操作（读/写/编辑）限制在允许的路径范围内：

```javascript
const { Sandbox } = require('./src/main/sandbox')

const sandbox = new Sandbox('/path/to/workspace')

// 允许：workspace 内的路径
await sandbox.writeFile('src/app.js', '...')  // ✅

// 拒绝：workspace 外的路径
await sandbox.writeFile('/etc/passwd', '...')   // ❌ 抛出错误

// 拒绝：路径逃逸
await sandbox.readFile('../../etc/passwd')       // ❌ 抛出错误
```

### 2. 命令安全

危险命令黑名单拦截：

| 模式 | 说明 |
|------|------|
| `rm -rf /` | 递归删除根目录 |
| `sudo` | 提权操作 |
| `mkfs` | 格式化文件系统 |
| `dd if=...of=/dev/` | 写入设备 |
| `:(){ :|:& };:` | Fork bomb |
| `chmod 777 /` | 修改根目录权限 |
| `shutdown` / `halt` / `reboot` | 系统操作 |
| `curl ... \| sh` | 管道执行远程脚本 |

### 3. 环境变量清理

执行命令时自动移除敏感环境变量：

- `AWS_SECRET_ACCESS_KEY` / `AWS_ACCESS_KEY_ID`
- `GITHUB_TOKEN` / `GH_TOKEN`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- `MUSE_API_KEY`
- `DATABASE_URL` / `DB_PASSWORD`

### 4. 资源限制

- 命令超时：默认 30 秒（可配置）
- 输出截断：最大 10MB
- 工作目录：限制在 workspace 内

## 使用方式

### 在 ReAct 引擎中使用

```javascript
const { getDefaultSandbox } = require('./src/main/sandbox')

const sandbox = getDefaultSandbox()

// 在沙箱内执行命令
const { stdout, stderr } = await sandbox.exec('npm test')

// 在沙箱内写文件
await sandbox.writeFile('output.txt', 'content')
```

### 自定义沙箱

```javascript
const { Sandbox } = require('./src/main/sandbox')

const sandbox = new Sandbox('/my/workspace', {
  allowedPaths: ['/shared/libs'],  // 额外允许的路径
  timeout: 60000,                   // 超时 60s
  allowHomeDir: false,              // 禁止访问家目录
})
```

### 在 MCP Server 中使用

MCP Server 默认使用沙箱，所有工具调用都经过路径检查和命令安全分析。

## 配置

通过环境变量配置默认沙箱：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MUSE_WORKSPACE` | 默认工作区路径 | 当前目录 |

## 与 OpenHands Docker 沙箱的区别

| 特性 | Muse Sandbox | OpenHands Docker |
|------|-------------|-----------------|
| 隔离级别 | 进程级 + 路径控制 | 容器级 |
| 资源开销 | 极低 | 较高（需要 Docker） |
| 启动速度 | 即时 | 需要拉取镜像 |
| 网络隔离 | ❌ | ✅ |
| 文件系统隔离 | ✅（路径控制） | ✅（容器隔离） |
| 适用场景 | 桌面应用、本地开发 | 服务端、CI/CD |

Muse 的沙箱设计为**轻量级进程隔离**，适合 Electron 桌面应用场景。如需更强隔离，可结合 Docker 使用。

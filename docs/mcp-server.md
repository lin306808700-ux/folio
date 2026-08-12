# MCP Server 配置指南

Muse AI-Terminal 实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，可以将 Muse 的工具能力暴露给 Claude Desktop、Cursor 等 MCP Client。

## 可用工具

| 工具 | 说明 |
|------|------|
| `file_read` | 读取文件内容 |
| `file_write` | 写入文件（自动创建目录） |
| `file_edit` | 搜索替换编辑文件 |
| `list_dir` | 列出目录内容 |
| `run_command` | 执行 shell 命令（带安全检查） |
| `search_code` | 正则搜索代码（grep -rn） |

## Claude Desktop 配置

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "muse": {
      "command": "node",
      "args": ["/path/to/muse-ai-terminal/src/mcp-server/index.js"]
    }
  }
}
```

重启 Claude Desktop 后，在对话中可以使用 Muse 的工具能力。

## Cursor 配置

在 Cursor Settings → MCP 中添加：

```json
{
  "mcpServers": {
    "muse": {
      "command": "node",
      "args": ["/path/to/muse-ai-terminal/src/mcp-server/index.js"]
    }
  }
}
```

## 环境变量

MCP Server 会自动加载 `.env` 文件，支持以下变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MUSE_WORKSPACE` | 默认工作区路径 | 当前目录 |

## 安全说明

- 命令执行有黑名单拦截（rm -rf /、sudo、mkfs 等）
- 文件操作限制在工作区范围内
- 敏感环境变量（API Key、Token）会被清理
- 命令默认超时 30 秒，输出限制 10MB

## 自定义工具

在 `src/mcp-server/index.js` 的 `TOOLS` 数组中添加工具定义：

```javascript
{
  name: 'my_tool',
  description: '我的自定义工具',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '输入' }
    },
    required: ['input']
  }
}
```

然后在 `executeTool()` 的 switch 中添加执行逻辑。

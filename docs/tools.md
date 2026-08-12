# 工具开发

Muse 的内置工具位于 `src/main/task-engine/tools/`，由工具注册表统一暴露给任务执行引擎。工具是高权限扩展点，设计时应优先保证参数可验证、行为可取消、结果可审计。

## 最小结构

```javascript
class ExampleTool {
  constructor() {
    this.name = 'example'
    this.description = 'Describe when the model should use this tool.'
  }

  async execute(params, context = {}) {
    if (context.signal?.aborted) {
      return { success: false, cancelled: true }
    }

    return { success: true, data: { value: params.value } }
  }
}

module.exports = ExampleTool
```

具体注册方式以 `src/main/task-engine/tools/index.js` 中现有工具为准。

## 设计要求

- 对必填项、类型、长度和枚举进行显式校验。
- 文件路径必须通过统一工作区解析器，禁止自行拼接后直接访问。
- 命令执行必须经过统一命令策略，不能因调用来源“可信”而绕过。
- 在昂贵操作和副作用前后检查 `AbortSignal` 或任务取消状态。
- 返回结构化、大小受控的结果，不把密钥或完整环境变量写入日志。
- 需要用户授权时返回确认状态，不在工具内部伪造授权。

## 测试

安全敏感工具至少覆盖：正常路径、边界输入、目录穿越、符号链接逃逸、取消、授权拒绝和副作用未提交。测试文件放在实现附近，并加入根目录 `test:core` 脚本。

插件工具使用不同的加载入口，参见 [plugin-development.md](plugin-development.md)。MCP 工具参见 [mcp-server.md](mcp-server.md)。

'use strict';

/**
 * AI Terminal 自检测试用例集 (共 20 条)
 * 
 * 设计原则：聚焦项目系统功能稳定性，而非 AI 大模型能力
 * 
 * 用例格式:
 * {
 *   id: 'unique-id',           // 唯一标识
 *   group: '分组名',            // 用于分组运行
 *   input: '模拟的用户输入',      // 发送到 ai:call 管道的内容
 *   expect: {                  // 断言规则
 *     contains: ['关键词'],     // 至少匹配一个关键词 (可选)
 *     notEmpty: true,          // 响应非空即通过 (可选)
 *     minLength: 50            // 最小长度 (可选)
 *   },
 *   description: '场景描述'     // 报告中显示的描述
 * }
 * 
 * 分组统计:
 * - 任务编排执行: 6 条 (task-exec-1 ~ task-exec-6)
 * - 技能CRUD: 5 条 (skill-crud-1 ~ skill-crud-5)
 * - 技能执行: 5 条 (skill-exec-1 ~ skill-exec-5)
 * - 记忆与系统集成: 4 条 (sys-memory-1 ~ sys-env-1)
 * 
 * 注意:
 * - 有依赖顺序的用例（如先创建技能再查询、先写记忆再检索）需保持数组中的先后顺序
 * - 测试数据统一使用 __selfcheck_ 前缀，执行后自动清理
 * - 新增用例只需在对应分组后追加即可
 */

const scenarios = [
  // ===== 第一组: 任务编排执行 (6条) =====
  // 测试任务引擎的多步骤规划和执行能力
  {
    id: 'task-exec-1',
    group: '任务编排执行',
    description: '单步命令执行与结果返回',
    input: '执行命令 echo "__selfcheck_task_ok" 并返回结果',
    expect: { contains: ['__selfcheck_task_ok'] }
  },
  {
    id: 'task-exec-2',
    group: '任务编排执行',
    description: '多步骤文件操作流',
    input: '先创建文件 /tmp/__selfcheck_test.txt 写入内容 "hello_selfcheck"，然后读取这个文件确认内容',
    expect: { contains: ['hello_selfcheck'] }
  },
  {
    id: 'task-exec-3',
    group: '任务编排执行',
    description: '命令管道与结果解析',
    input: '执行 node --version 获取版本号，然后执行 echo "check_done" 确认执行完成',
    expect: { contains: ['v', 'check_done'] }
  },
  {
    id: 'task-exec-4',
    group: '任务编排执行',
    description: '文件查找与统计',
    input: '查找当前项目 src/main 目录下所有 .js 文件并统计数量',
    expect: { contains: ['.js'] }
  },
  {
    id: 'task-exec-5',
    group: '任务编排执行',
    description: '多步骤依赖链执行',
    input: '先执行 echo "step1_ok"，然后执行 echo "step2_ok"，返回两个步骤的结果',
    expect: { contains: ['step1_ok', 'step2_ok'] }
  },
  {
    id: 'task-exec-6',
    group: '任务编排执行',
    description: '批量文件操作',
    input: '批量查看 src/main/task-engine 目录下所有 .js 文件的前5行内容',
    expect: { notEmpty: true, minLength: 50 }
  },

  // ===== 第二组: 技能CRUD (5条) =====
  // 完整的技能创建→查询→更新→删除生命周期
  {
    id: 'skill-crud-1',
    group: '技能CRUD',
    description: '创建新技能',
    input: '帮我创建一个技能，名称叫 "__selfcheck_测试技能"，描述是 "自检测试用技能"，内容是 "这是一个用于自检的测试技能，请回复：技能已激活"',
    expect: { contains: ['创建', '技能', '__selfcheck_'] }
  },
  {
    id: 'skill-crud-2',
    group: '技能CRUD',
    description: '查询技能列表确认创建成功',
    input: '查看当前已安装的技能列表，确认 __selfcheck_测试技能 是否存在',
    expect: { contains: ['__selfcheck_', '技能'] }
  },
  {
    id: 'skill-crud-3',
    group: '技能CRUD',
    description: '更新技能内容',
    input: '更新技能 "__selfcheck_测试技能" 的描述为 "已更新的自检测试技能"',
    expect: { contains: ['更新', '技能'] }
  },
  {
    id: 'skill-crud-4',
    group: '技能CRUD',
    description: '删除技能',
    input: '删除技能 "__selfcheck_测试技能"',
    expect: { contains: ['删除', '成功'] }
  },
  {
    id: 'skill-crud-5',
    group: '技能CRUD',
    description: '确认技能已删除',
    input: '查看技能列表，确认 __selfcheck_测试技能 已经不存在了',
    expect: { notEmpty: true }
  },

  // ===== 第三组: 技能执行 (5条) =====
  // 测试技能加载、上下文注入、自动执行流程
  {
    id: 'skill-exec-1',
    group: '技能执行',
    description: '创建可执行技能',
    input: '创建一个技能叫 "__selfcheck_命令助手"，描述是 "自动执行系统命令的技能"，内容是 "当用户询问系统信息时，使用 uname -a 命令获取完整系统信息并返回"',
    expect: { contains: ['创建', '技能', '__selfcheck_'] }
  },
  {
    id: 'skill-exec-2',
    group: '技能执行',
    description: '技能列表加载验证',
    input: '列出所有技能，告诉我每个技能的名称和描述',
    expect: { contains: ['技能'] }
  },
  {
    id: 'skill-exec-3',
    group: '技能执行',
    description: '创建带步骤的自动执行技能',
    input: '创建一个技能叫 "__selfcheck_文件检查器"，描述是 "检查项目文件结构"，指令内容是 "执行 ls -la 查看当前目录详细信息"',
    expect: { contains: ['创建', '技能', '__selfcheck_'] }
  },
  {
    id: 'skill-exec-4',
    group: '技能执行',
    description: '技能内容完整性验证',
    input: '查看技能 "__selfcheck_文件检查器" 的完整内容',
    expect: { contains: ['__selfcheck_', '文件检查器'] }
  },
  {
    id: 'skill-exec-5',
    group: '技能执行',
    description: '清理执行测试技能',
    input: '删除技能 "__selfcheck_命令助手" 和 "__selfcheck_文件检查器"',
    expect: { contains: ['删除'] }
  },

  // ===== 第四组: 记忆与系统集成 (4条) =====
  // 保留记忆系统测试（它是真正的系统集成测试），精简为核心流程
  {
    id: 'sys-memory-1',
    group: '记忆与系统集成',
    description: '记忆写入',
    input: '请记住：我的测试框架偏好是 Jest + React Testing Library，这是自检测试数据 __selfcheck_',
    expect: { contains: ['记住', '记忆', '已记', '记录', '记下', 'ok', '好的', '收到', 'SAVE_MEMORY'] }
  },
  {
    id: 'sys-memory-2',
    group: '记忆与系统集成',
    description: '记忆检索验证',
    input: '我偏好什么测试框架？请详细回答',
    expect: { contains: ['Jest', 'Testing Library', 'jest', 'testing'] }
  },
  {
    id: 'sys-command-1',
    group: '记忆与系统集成',
    description: '系统命令直接执行',
    input: '执行命令: echo "__selfcheck_sys_ok"',
    expect: { contains: ['__selfcheck_sys_ok'] }
  },
  {
    id: 'sys-env-1',
    group: '记忆与系统集成',
    description: '环境信息获取',
    input: '执行 node -e "console.log(process.platform, process.version)" 获取运行环境信息',
    expect: { contains: ['darwin', 'v'] }
  },
];

module.exports = scenarios;

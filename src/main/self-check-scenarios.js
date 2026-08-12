'use strict';

/**
 * Folio 自检测试用例集 (共 10 条)
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
 * - 记忆与系统集成: 4 条 (sys-memory-1 ~ sys-env-1)
 * 
 * 注意:
 * - 有依赖顺序的用例（如先写记忆再检索）需保持数组中的先后顺序
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

  // ===== 第二组: 记忆与系统集成 (4条) =====
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

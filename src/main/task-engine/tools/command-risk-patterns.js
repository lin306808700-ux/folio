/**
 * 命令风险模式库 + 安全白名单/黑名单
 * 纯数据模块，供 CommandSafetyAnalyzer 使用
 */

// 安全命令白名单（只读/查询类）
const safeCommands = [
  // 文件列表和查看
  'ls', 'll', 'la', 'dir', 'pwd', 'cd',
  'cat', 'head', 'tail', 'less', 'more',
  'find', 'grep', 'ack', 'rg',
  'file', 'stat', 'du', 'df',
  
  // 系统信息
  'ps', 'top', 'htop', 'free', 'uptime',
  'whoami', 'id', 'uname', 'hostname',
  'date', 'cal',
  
  // 网络
  'ping', 'curl', 'wget', 'netstat', 'ss',
  'ifconfig', 'ip', 'host', 'dig', 'nslookup',
  
  // 版本和路径
  'which', 'whereis', 'type',
  'node', 'npm', 'yarn', 'pnpm', 'npx',
  'python', 'python3', 'pip',
  'git', 'go', 'rustc', 'cargo', 'java',
  
  // 其他常用
  'echo', 'printf', 'clear', 'history',
  'wc', 'sort', 'uniq', 'awk', 'sed', 'cut',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'tree', 'fd', 'fzf', 'jq', 'yq'
];

// 危险命令（需要确认）
const dangerousCommands = [
  'rm', 'rmdir', 'del',
  'mv', 'move', 'rename',
  'cp', 'copy', 'xcopy',
  'chmod', 'chown', 'chgrp',
  'sudo', 'su', 'doas',
  'kill', 'killall', 'pkill',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'mkfs', 'fdisk', 'parted', 'dd',
  'mount', 'umount',
  '>', '>>',  // 重定向
];

// 高风险模式签名库
const riskPatterns = [
  // 系统级破坏
  { pattern: /\brm\s+-rf\b/, risk: 90, category: 'system_destruction', desc: '递归强制删除，可能导致系统崩溃' },
  { pattern: /\bdd\b/, risk: 85, category: 'data_destruction', desc: '直接磁盘写入，可能损坏硬件' },
  { pattern: /\bmkfs\b/, risk: 80, category: 'filesystem_destruction', desc: '格式化文件系统，永久丢失数据' },
  
  // 权限提升
  { pattern: /\bsudo\b/, risk: 75, category: 'privilege_escalation', desc: '获取超级用户权限，可执行任意操作' },
  { pattern: /\b(chmod|chown)\s+.*\//, risk: 70, category: 'permission_change', desc: '修改系统目录权限，影响系统稳定性' },
  
  // 网络风险
  { pattern: /\biptables\b/, risk: 65, category: 'network_disruption', desc: '修改防火墙规则，可能断网' },
  { pattern: /\bnc\b.*-e/, risk: 60, category: 'reverse_shell', desc: '可能存在反向shell风险' },
  
  // 资源耗尽
  { pattern: /\bfork\s+bomb\b|\(:\|\:&\)\;/, risk: 55, category: 'resource_exhaustion', desc: 'fork炸弹，可能导致系统无响应' },
  { pattern: /\bwhile\s+true\b/, risk: 50, category: 'infinite_loop', desc: '无限循环，消耗CPU资源' }
];

// 文件类型敏感度映射
const fileSensitivity = {
  '.env': 90,
  '.git': 85,
  'package.json': 70,
  'package-lock.json': 60,
  'node_modules': 80,
  'dist': 40,
  'build': 40,
  '.DS_Store': 20,
  'Thumbs.db': 20
};

module.exports = {
  safeCommands,
  dangerousCommands,
  riskPatterns,
  fileSensitivity
};

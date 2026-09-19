const commandTool = require('./command');

async function testEnhancedSecurity() {
  console.log('🧪 测试增强的命令安全分析功能\n');
  
  // 测试用例
  const testCases = [
    'ls -la',
    'rm -rf /tmp/test',
    'sudo rm -rf /etc/passwd',
    'find . -name "*.js" | xargs grep "TODO"',
    'chmod 777 /important/file',
    'echo "hello" > /tmp/output.txt',
    'cat package.json',
    'npm install',
    'git status'
  ];
  
  console.log('📊 风险评估报告:');
  console.log('==================\n');
  
  for (const command of testCases) {
    const report = await commandTool.getRiskReport(command);
    const suggestions = commandTool.getSafetySuggestions(command);
    
    console.log(`命令: ${command}`);
    console.log(`风险等级: ${report.riskCategory}`);
    console.log(`风险分数: ${report.riskScore}/100`);
    console.log(`是否危险: ${report.isDangerous ? '⚠️ 是' : '✅ 否'}`);
    
    if (report.details) {
      if (report.details.blastRadius) {
        console.log(`爆炸半径: ${JSON.stringify(report.details.blastRadius)}`);
      }
      if (report.details.sideEffects && report.details.sideEffects.length > 0) {
        console.log(`副作用: ${report.details.sideEffects.map(e => e.type).join(', ')}`);
      }
    }
    
    if (suggestions.suggestions.length > 0 && suggestions.suggestions[0] !== '命令看起来是安全的') {
      console.log(`安全建议: ${suggestions.suggestions.join('; ')}`);
    }
    
    console.log('---\n');
  }
  
  // 批量测试
  console.log('📋 批量风险评估:');
  console.log('==================\n');
  
  const batchReport = await commandTool.batchRiskAssessment(testCases);
  console.log(`总命令数: ${batchReport.summary.total}`);
  console.log(`危险命令: ${batchReport.summary.dangerous}`);
  console.log(`安全命令: ${batchReport.summary.safe}`);
  console.log(`平均风险: ${batchReport.summary.averageRisk}/100`);
  console.log(`最高风险: ${batchReport.summary.highestRisk}/100`);
  console.log(`风险分布: ${JSON.stringify(batchReport.summary.riskDistribution)}`);
}

// 运行测试
testEnhancedSecurity().catch(console.error);
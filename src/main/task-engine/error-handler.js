const { callAI } = require('../../shared/ai-client');

/**
 * 智能错误处理器
 * 提供错误识别、分析和自动修复建议
 */

class ErrorHandler {
  constructor() {
    // 常见错误模式库
    this.errorPatterns = [
      // Node.js 相关错误
      {
        pattern: /ENOTFOUND/,
        category: 'network',
        severity: 'medium',
        fixable: true,
        suggestions: [
          '检查网络连接',
          '确认域名解析是否正常',
          '尝试使用IP地址代替域名'
        ]
      },
      {
        pattern: /EACCES|EPERM/,
        category: 'permission',
        severity: 'high',
        fixable: true,
        suggestions: [
          '检查文件/目录权限',
          '使用 sudo 运行命令',
          '修改文件所有者或权限'
        ]
      },
      {
        pattern: /ENOENT/,
        category: 'file_not_found',
        severity: 'medium',
        fixable: true,
        suggestions: [
          '确认文件路径是否正确',
          '检查文件是否存在',
          '创建缺失的文件或目录'
        ]
      },
      {
        pattern: /MODULE_NOT_FOUND/,
        category: 'dependency',
        severity: 'high',
        fixable: true,
        suggestions: [
          '运行 npm install 安装依赖',
          '检查 package.json 配置',
          '清理 node_modules 并重新安装'
        ]
      },
      {
        pattern: /SyntaxError/,
        category: 'syntax',
        severity: 'high',
        fixable: false,
        suggestions: [
          '检查代码语法错误',
          '使用 ESLint 检查代码',
          '查看具体错误位置和信息'
        ]
      },
      {
        pattern: /TypeError/,
        category: 'type',
        severity: 'medium',
        fixable: false,
        suggestions: [
          '检查变量类型是否正确',
          '确认函数参数类型',
          '使用 typeof 检查变量类型'
        ]
      },
      {
        pattern: /ReferenceError/,
        category: 'reference',
        severity: 'high',
        fixable: false,
        suggestions: [
          '确认变量是否已声明',
          '检查变量作用域',
          '验证模块导入是否正确'
        ]
      },
      // Git 相关错误
      {
        pattern: /fatal: not a git repository/,
        category: 'git',
        severity: 'low',
        fixable: true,
        suggestions: [
          '在项目根目录初始化 git 仓库: git init',
          '确认当前目录是否正确',
          '检查 .git 目录是否存在'
        ]
      },
      {
        pattern: /Permission denied \(publickey\)/,
        category: 'git_auth',
        severity: 'high',
        fixable: true,
        suggestions: [
          '配置 SSH 密钥',
          '检查 GitHub SSH 设置',
          '使用 HTTPS 代替 SSH'
        ]
      }
    ];
    
    // 修复命令模板
    this.fixTemplates = {
      'dependency': {
        'npm install': 'npm install',
        'yarn install': 'yarn install',
        'clean install': 'rm -rf node_modules && npm install'
      },
      'git': {
        'init repo': 'git init',
        'add remote': 'git remote add origin <repository-url>'
      },
      'file_ops': {
        'create dir': 'mkdir -p {{path}}',
        'change perms': 'chmod {{perms}} {{path}}'
      }
    };
  }

  /**
   * 分析错误并提供修复建议
   */
  async analyzeError(error, context = {}) {
    const errorStr = this._normalizeError(error);
    
    // 识别错误模式
    const matchedPatterns = this._matchErrorPatterns(errorStr);
    
    // 获取AI分析
    const aiAnalysis = await this._getAIAnalysis(errorStr, context, matchedPatterns);
    
    // 生成修复建议
    const fixes = this._generateFixSuggestions(matchedPatterns, aiAnalysis);
    
    return {
      error: errorStr,
      patterns: matchedPatterns,
      aiAnalysis: aiAnalysis,
      fixes: fixes,
      severity: this._calculateSeverity(matchedPatterns),
      category: this._getPrimaryCategory(matchedPatterns)
    };
  }

  /**
   * 执行自动修复
   */
  async applyFix(fixCommand, options = {}) {
    try {
      // 这里应该调用命令执行工具
      // 暂时返回模拟结果
      console.log(`执行修复命令: ${fixCommand}`);
      
      return {
        success: true,
        command: fixCommand,
        output: '修复命令执行成功'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        command: fixCommand
      };
    }
  }

  /**
   * 批量错误分析
   */
  async analyzeMultipleErrors(errors, context = {}) {
    const results = [];
    
    for (const error of errors) {
      const analysis = await this.analyzeError(error, context);
      results.push(analysis);
    }
    
    return {
      analyses: results,
      summary: this._generateErrorSummary(results)
    };
  }

  /**
   * 标准化错误信息
   */
  _normalizeError(error) {
    if (typeof error === 'string') {
      return error.trim();
    }
    
    if (error instanceof Error) {
      return error.message || error.toString();
    }
    
    if (typeof error === 'object') {
      return this._safeStringify(error);
    }
    
    return String(error);
  }

  /**
   * 匹配错误模式
   */
  _matchErrorPatterns(errorStr) {
    const matches = [];
    
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorStr)) {
        matches.push({
          ...pattern,
          matchedText: errorStr.match(pattern.pattern)[0]
        });
      }
    }
    
    return matches;
  }

  /**
   * 获取AI分析
   */
  async _getAIAnalysis(errorStr, context, patterns) {
    const prompt = `
你是一个经验丰富的开发者，请分析以下错误并提供解决方案：

错误信息: ${errorStr}

已识别的模式: ${patterns.map(p => p.category).join(', ') || '无'}

上下文信息: ${this._safeStringify(context, 2)}

请提供:
1. 错误的根本原因分析
2. 具体的解决步骤
3. 预防措施
4. 相关的最佳实践

请用结构化的方式回答。
`;

    try {
      const analysis = await callAI(prompt, { 
        sessionId: `error_analysis_${Date.now()}`,
        timeout: 30000 
      });
      
      return analysis;
    } catch (error) {
      return 'AI分析暂时不可用，请参考模式匹配的建议';
    }
  }

  /**
   * 生成修复建议
   */
  _generateFixSuggestions(patterns, aiAnalysis) {
    const suggestions = [];
    
    // 基于模式的建议
    for (const pattern of patterns) {
      suggestions.push(...pattern.suggestions);
    }
    
    // 基于AI分析的建议
    if (aiAnalysis && aiAnalysis !== 'AI分析暂时不可用，请参考模式匹配的建议') {
      suggestions.push(`AI建议: ${aiAnalysis.substring(0, 200)}...`);
    }
    
    // 基于可修复性的建议
    const fixablePatterns = patterns.filter(p => p.fixable);
    if (fixablePatterns.length > 0) {
      suggestions.push('系统可以尝试自动修复此错误');
    }
    
    return [...new Set(suggestions)]; // 去重
  }

  /**
   * 计算严重程度
   */
  _calculateSeverity(patterns) {
    if (patterns.length === 0) return 'unknown';
    
    const severities = patterns.map(p => p.severity);
    if (severities.includes('critical')) return 'critical';
    if (severities.includes('high')) return 'high';
    if (severities.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * 获取主要类别
   */
  _getPrimaryCategory(patterns) {
    if (patterns.length === 0) return 'unknown';
    
    // 按出现频率排序
    const categoryCount = {};
    patterns.forEach(p => {
      categoryCount[p.category] = (categoryCount[p.category] || 0) + 1;
    });
    
    return Object.keys(categoryCount).sort((a, b) => 
      categoryCount[b] - categoryCount[a]
    )[0];
  }

  /**
   * 安全序列化，处理循环引用
   */
  _safeStringify(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (typeof value === 'function') {
        return '[Function]';
      }
      return value;
    }, indent);
  }

  /**
   * 生成错误摘要
   */
  _generateErrorSummary(analyses) {
    const summary = {
      total: analyses.length,
      byCategory: {},
      bySeverity: {},
      fixable: 0,
      unfixable: 0
    };
    
    for (const analysis of analyses) {
      // 按类别统计
      const category = analysis.category;
      summary.byCategory[category] = (summary.byCategory[category] || 0) + 1;
      
      // 按严重程度统计
      const severity = analysis.severity;
      summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1;
      
      // 按可修复性统计
      if (analysis.patterns.some(p => p.fixable)) {
        summary.fixable++;
      } else {
        summary.unfixable++;
      }
    }
    
    return summary;
  }
}

module.exports = new ErrorHandler();
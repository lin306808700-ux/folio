// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const path = require('path');
const { safeCommands, dangerousCommands, riskPatterns, fileSensitivity } = require('./command-risk-patterns');

/**
 * 命令安全分析引擎
 * 负责 AST 风格检测、副作用预测、爆炸半径计算、综合风险评估
 */

class CommandSafetyAnalyzer {
  constructor() {
    this.safeCommands = safeCommands;
    this.dangerousCommands = dangerousCommands;
    this.riskPatterns = riskPatterns;
    this.fileSensitivity = fileSensitivity;
  }

  /**
   * 分析命令安全性（增强版）
   * 新增：AST风格检测、副作用预测、爆炸半径计算
   */
  analyzeSafety(command) {
    const cmd = command.trim().toLowerCase();
    const originalCmd = command.trim();
    
    // 1. 基础危险命令检测
    const basicCheck = this._checkBasicSafety(cmd, originalCmd);
    if (basicCheck.isDangerous) {
      return basicCheck;
    }
    
    // 2. AST风格分析
    const astAnalysis = this._performASTAnalysis(originalCmd);
    
    // 3. 副作用预测
    const sideEffects = this._predictSideEffects(originalCmd);
    
    // 4. 爆炸半径计算
    const blastRadius = this._calculateBlastRadius(originalCmd, sideEffects);
    
    // 5. 综合风险评估
    const riskAssessment = this._assessRisk(astAnalysis, sideEffects, blastRadius);
    
    // 如果综合风险较高，标记为危险
    if (riskAssessment.riskScore >= 60) {
      return {
        isDangerous: true,
        reason: riskAssessment.reason,
        riskDetails: {
          score: riskAssessment.riskScore,
          category: riskAssessment.category,
          blastRadius: blastRadius,
          sideEffects: sideEffects,
          astAnalysis: astAnalysis
        }
      };
    }
    
    // 检查是否在白名单中
    const firstCommand = cmd.split(/\s+/)[0];
    if (this.safeCommands.includes(firstCommand)) {
      return { isDangerous: false };
    }
    
    // 未知命令，保守处理，需要确认
    return {
      isDangerous: true,
      reason: `未知命令: ${firstCommand}，需要确认`,
      riskDetails: {
        score: 40,
        category: 'unknown_command',
        warning: '无法识别的命令类型'
      }
    };
  }

  /**
   * 基础安全检查
   */
  _checkBasicSafety(cmd, originalCmd) {
    // 检查危险命令
    for (const dangerous of this.dangerousCommands) {
      const patterns = [
        new RegExp(`^${dangerous}\\b`),
        new RegExp(`[|;]\\s*${dangerous}\\b`),
        new RegExp(`\\$\\(${dangerous}\\b`),
        new RegExp(`\`\\s*${dangerous}\\b`)
      ];
      
      if (patterns.some(p => p.test(cmd))) {
        const astAnalysis = this._performASTAnalysis(originalCmd);
        const sideEffects = this._predictSideEffects(originalCmd);
        const blastRadius = this._calculateBlastRadius(originalCmd, sideEffects);
        const riskAssessment = this._assessRisk(astAnalysis, sideEffects, blastRadius);
        
        return {
          isDangerous: true,
          reason: `包含危险命令: ${dangerous}`,
          riskDetails: {
            score: riskAssessment.riskScore,
            category: riskAssessment.category,
            blastRadius: blastRadius,
            sideEffects: sideEffects,
            astAnalysis: astAnalysis
          }
        };
      }
    }
    
    // 检查文件重定向（写入操作）
    if (/[>][>]?\s*\S+/.test(originalCmd) && !originalCmd.includes('echo')) {
      const astAnalysis = this._performASTAnalysis(originalCmd);
      const sideEffects = this._predictSideEffects(originalCmd);
      const blastRadius = this._calculateBlastRadius(originalCmd, sideEffects);
      const riskAssessment = this._assessRisk(astAnalysis, sideEffects, blastRadius);
      
      return {
        isDangerous: true,
        reason: '包含文件重定向操作',
        riskDetails: {
          score: riskAssessment.riskScore,
          category: riskAssessment.category,
          blastRadius: blastRadius,
          sideEffects: sideEffects,
          astAnalysis: astAnalysis
        }
      };
    }
    
    return { isDangerous: false };
  }

  /**
   * AST风格命令分析
   */
  _performASTAnalysis(command) {
    const tokens = this._tokenizeCommand(command);
    const structure = this._analyzeCommandStructure(tokens);
    const patterns = this._detectRiskPatterns(command);
    
    return {
      tokens: tokens,
      structure: structure,
      riskPatterns: patterns,
      complexity: this._calculateComplexity(tokens, command)
    };
  }

  /**
   * 命令分词
   */
  _tokenizeCommand(command) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      
      if ((char === '"' || char === "'") && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        inQuotes = false;
        quoteChar = '';
      } else if (/\s/.test(char) && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      tokens.push(current);
    }
    
    return tokens;
  }

  /**
   * 分析命令结构
   */
  _analyzeCommandStructure(tokens) {
    const structure = {
      mainCommand: '',
      arguments: [],
      flags: [],
      pipes: 0,
      redirects: 0,
      subshells: 0
    };
    
    let inSubshell = false;
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      
      if (i === 0) {
        structure.mainCommand = token;
      } else if (token.startsWith('-')) {
        structure.flags.push(token);
      } else if (token === '|' && i < tokens.length - 1) {
        structure.pipes++;
      } else if ((token === '>' || token === '>>') && i < tokens.length - 1) {
        structure.redirects++;
      } else if (token === '$(' || token === '`') {
        structure.subshells++;
        inSubshell = true;
      } else if (token === ')' || token === '`' && inSubshell) {
        inSubshell = false;
      } else {
        structure.arguments.push(token);
      }
    }
    
    return structure;
  }

  /**
   * 检测风险模式
   */
  _detectRiskPatterns(command) {
    const detected = [];
    
    for (const pattern of this.riskPatterns) {
      if (pattern.pattern.test(command)) {
        detected.push({
          pattern: pattern.pattern.toString(),
          risk: pattern.risk,
          category: pattern.category,
          description: pattern.desc
        });
      }
    }
    
    return detected;
  }

  /**
   * 计算命令复杂度
   */
  _calculateComplexity(tokens, command) {
    let score = 0;
    
    // 基础长度得分
    score += Math.min(tokens.length * 5, 30);
    
    // 管道和重定向复杂度
    const pipeRedirectCount = tokens.filter(t => ['|', '>', '>>'].includes(t)).length;
    score += pipeRedirectCount * 10;
    
    // 子shell复杂度
    const subshellCount = tokens.filter(t => t === '$(' || t === '`').length;
    score += subshellCount * 15;
    
    // 特殊字符复杂度
    const specialChars = command.match(/[;&|$`{}[\]()]/g) || [];
    score += Math.min(specialChars.length * 3, 20);
    
    return Math.min(score, 100);
  }

  /**
   * 预测副作用
   */
  _predictSideEffects(command) {
    const effects = [];
    
    if (/\brm\b/.test(command)) {
      effects.push({ type: 'file_deletion', severity: 'high', scope: 'files' });
    }
    
    if (/\bm(v|ove)\b/.test(command)) {
      effects.push({ type: 'file_move', severity: 'medium', scope: 'files' });
    }
    
    if (/\bcp\b/.test(command)) {
      effects.push({ type: 'file_copy', severity: 'low', scope: 'files' });
    }
    
    if (/\b(chmod|chown)\b/.test(command)) {
      effects.push({ type: 'permission_change', severity: 'high', scope: 'permissions' });
    }
    
    if (/\bsudo\b/.test(command)) {
      effects.push({ type: 'privilege_elevation', severity: 'critical', scope: 'system' });
    }
    
    if (/\b(kill|shutdown|reboot)\b/.test(command)) {
      effects.push({ type: 'process_control', severity: 'high', scope: 'system' });
    }
    
    if (/\b(iptables|ufw)\b/.test(command)) {
      effects.push({ type: 'firewall_change', severity: 'high', scope: 'network' });
    }
    
    return effects;
  }

  /**
   * 计算爆炸半径
   */
  _calculateBlastRadius(command, sideEffects) {
    let radius = {
      fileImpact: 0,
      directoryImpact: 0,
      systemImpact: 0,
      networkImpact: 0,
      overall: 0
    };
    
    // 分析文件路径影响
    const filePaths = command.match(/(?:\/[\w\-\.]+)+/g) || [];
    for (const filePath of filePaths) {
      const sensitivity = this._getFileSensitivity(filePath);
      if (filePath.includes('*') || filePath.includes('?')) {
        radius.directoryImpact = Math.max(radius.directoryImpact, sensitivity + 20);
      } else {
        radius.fileImpact = Math.max(radius.fileImpact, sensitivity);
      }
    }
    
    if (command.includes('*')) {
      radius.directoryImpact += 30;
    }
    
    if (command.includes('-r') || command.includes('--recursive')) {
      radius.directoryImpact += 40;
    }
    
    for (const effect of sideEffects) {
      switch (effect.scope) {
        case 'files':
          radius.fileImpact += effect.severity === 'high' ? 50 : 20;
          break;
        case 'permissions':
          radius.systemImpact += 40;
          break;
        case 'system':
          radius.systemImpact += effect.severity === 'critical' ? 80 : 50;
          break;
        case 'network':
          radius.networkImpact += 30;
          break;
      }
    }
    
    radius.overall = Math.max(
      radius.fileImpact,
      radius.directoryImpact,
      radius.systemImpact,
      radius.networkImpact
    );
    
    return radius;
  }

  /**
   * 获取文件敏感度
   */
  _getFileSensitivity(filePath) {
    const basename = path.basename(filePath);
    const extname = path.extname(filePath);
    
    if (this.fileSensitivity[basename]) {
      return this.fileSensitivity[basename];
    }
    
    if (this.fileSensitivity[extname]) {
      return this.fileSensitivity[extname];
    }
    
    if (filePath.includes('/etc/') || filePath.includes('/usr/') || filePath.includes('/var/')) {
      return 75;
    }
    
    if (filePath.includes('/home/') || filePath.includes('/Users/')) {
      return 60;
    }
    
    return 30;
  }

  /**
   * 综合风险评估
   */
  _assessRisk(astAnalysis, sideEffects, blastRadius) {
    let riskScore = 0;
    let category = 'low_risk';
    let reason = '';
    
    riskScore += astAnalysis.complexity * 0.3;
    
    for (const pattern of astAnalysis.riskPatterns) {
      riskScore += pattern.risk * 0.4;
    }
    
    for (const effect of sideEffects) {
      const severityMultiplier = {
        'low': 10,
        'medium': 30,
        'high': 60,
        'critical': 90
      };
      riskScore += severityMultiplier[effect.severity] || 20;
    }
    
    riskScore += Math.min(blastRadius.overall * 0.8, 60);
    
    if (riskScore >= 80) {
      category = 'critical_risk';
      reason = '检测到极高风险操作，可能造成严重系统损害';
    } else if (riskScore >= 60) {
      category = 'high_risk';
      reason = '检测到高风险操作，需要仔细审查';
    } else if (riskScore >= 40) {
      category = 'medium_risk';
      reason = '检测到中等风险操作，建议确认';
    } else {
      category = 'low_risk';
      reason = '风险较低的操作';
    }
    
    return {
      riskScore: Math.min(Math.round(riskScore), 100),
      category: category,
      reason: reason
    };
  }

  /**
   * 获取命令风险报告
   */
  getRiskReport(command) {
    const safety = this.analyzeSafety(command);
    
    return {
      command: command,
      isDangerous: safety.isDangerous,
      riskScore: safety.riskDetails?.score || 0,
      riskCategory: safety.riskDetails?.category || 'safe',
      reason: safety.reason,
      details: safety.riskDetails || null
    };
  }

  /**
   * 批量风险评估
   */
  batchRiskAssessment(commands) {
    const results = [];
    
    for (const cmd of commands) {
      const report = this.getRiskReport(cmd);
      results.push(report);
    }
    
    return {
      success: true,
      data: results,
      summary: this._generateRiskSummary(results)
    };
  }

  /**
   * 生成风险摘要
   */
  _generateRiskSummary(reports) {
    const summary = {
      total: reports.length,
      dangerous: reports.filter(r => r.isDangerous).length,
      safe: reports.filter(r => !r.isDangerous).length,
      averageRisk: 0,
      highestRisk: 0,
      riskDistribution: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    };
    
    let totalScore = 0;
    
    for (const report of reports) {
      totalScore += report.riskScore;
      summary.highestRisk = Math.max(summary.highestRisk, report.riskScore);
      
      switch (report.riskCategory) {
        case 'critical_risk':
          summary.riskDistribution.critical++;
          break;
        case 'high_risk':
          summary.riskDistribution.high++;
          break;
        case 'medium_risk':
          summary.riskDistribution.medium++;
          break;
        case 'low_risk':
          summary.riskDistribution.low++;
          break;
      }
    }
    
    summary.averageRisk = Math.round(totalScore / reports.length);
    
    return summary;
  }

  /**
   * 获取安全建议
   */
  getSafetySuggestions(command) {
    const safety = this.analyzeSafety(command);
    const suggestions = [];
    
    if (!safety.isDangerous) {
      return { suggestions: ['命令看起来是安全的'] };
    }
    
    const details = safety.riskDetails;
    
    if (details?.category === 'system_destruction') {
      suggestions.push('考虑使用更精确的删除命令，避免递归删除');
      suggestions.push('先用 ls 命令查看要删除的文件');
    }
    
    if (details?.category === 'privilege_escalation') {
      suggestions.push('确认是否真的需要 sudo 权限');
      suggestions.push('考虑使用普通用户权限完成操作');
    }
    
    if (details?.blastRadius?.directoryImpact > 50) {
      suggestions.push('该命令影响范围较大，请确认操作路径');
      suggestions.push('建议先备份重要数据');
    }
    
    if (details?.sideEffects?.some(e => e.type === 'file_deletion')) {
      suggestions.push('删除操作不可逆，请三思而后行');
      suggestions.push('考虑使用 trash 命令替代 rm');
    }
    
    return {
      suggestions: suggestions,
      riskLevel: details?.category || 'unknown',
      riskScore: details?.score || 0
    };
  }
}

module.exports = new CommandSafetyAnalyzer();

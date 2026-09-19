// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const safetyAnalyzer = require('./command-safety-analyzer');
const { evaluateCommand } = require('../../command-policy');

/**
 * 命令执行工具
 * 白名单命令：直接执行
 * 危险命令：需要确认
 * 安全分析委托给 CommandSafetyAnalyzer
 */

class CommandTool {
  constructor() {
    this.name = 'command';
  }

  /**
   * 执行命令
   * 支持参数: string 或 { command: string, ...options }
   * 返回增强的安全信息
   * 
   * @param {string|object} command - 命令字符串或包含 command 属性的对象
   * @param {object} options - 选项
   * @param {boolean} options.trusted - 是否为可信命令（跳过安全检查，用于 autoExecute 自动执行）
   */
  async execute(command, options = {}) {
    // 处理对象参数 { command: '...', ... }
    let cmd, opts;
    if (typeof command === 'object' && command !== null) {
      cmd = command.command || command.cmd;
      opts = { ...options, ...command };
    } else {
      cmd = command;
      opts = options;
    }
    
    if (!cmd || typeof cmd !== 'string') {
      return {
        success: false,
        error: 'execute 需要 command 参数',
        needConfirm: false
      };
    }
    
    cmd = cmd.trim();
    
    // 所有来源先经过统一核心策略；trusted 仅跳过旧分析器的未知命令确认。
    const policy = evaluateCommand(cmd, { workspace: opts.cwd });
    const safety = policy.requiresConfirmation
      ? {
          isDangerous: true,
          reason: policy.reason,
          riskDetails: {
            score: policy.analysis.riskScore || 50,
            category: policy.riskLevel || 'medium',
            blastRadius: policy.analysis.blastRadius || null,
            sideEffects: policy.analysis.patterns || [],
            workspaceEscape: policy.workspaceEscape,
          }
        }
      : (opts.trusted ? { isDangerous: false } : safetyAnalyzer.analyzeSafety(cmd));
    
    if (safety.isDangerous) {
      const previewInfo = {
        command: cmd,
        warning: safety.reason,
        riskLevel: safety.riskDetails?.category || 'unknown',
        riskScore: safety.riskDetails?.score || 0,
        blastRadius: safety.riskDetails?.blastRadius || null,
        sideEffects: safety.riskDetails?.sideEffects || [],
        astAnalysis: safety.riskDetails?.astAnalysis || null
      };
      
      return {
        success: false,
        needConfirm: true,
        operation: 'execute',
        reason: safety.reason,
        preview: previewInfo,
        riskDetails: safety.riskDetails
      };
    }
    
    return await this._runCommand(cmd, opts);
  }

  /**
   * 确认后执行危险命令
   */
  async confirmExecute(command, options = {}) {
    return await this._runCommand(command, options);
  }

  /**
   * 批量执行命令（全部安全才执行）
   */
  async executeBatch(commands, options = {}) {
    const results = [];
    
    for (const cmd of commands) {
      const result = await this.execute(cmd, options);
      results.push({
        command: cmd,
        ...result
      });
      
      // 如果需要确认，立即停止
      if (result.needConfirm) {
        return {
          success: false,
          needConfirm: true,
          partialResults: results,
          pendingCommand: cmd
        };
      }
      
      // 如果执行失败且配置了失败停止
      if (!result.success && options.stopOnError) {
        break;
      }
    }
    
    return {
      success: true,
      data: results,
      needConfirm: false
    };
  }

  /**
   * 获取命令风险报告（委托给安全分析器）
   */
  async getRiskReport(command) {
    return safetyAnalyzer.getRiskReport(command);
  }

  /**
   * 批量风险评估（委托给安全分析器）
   */
  async batchRiskAssessment(commands) {
    return safetyAnalyzer.batchRiskAssessment(commands);
  }

  /**
   * 获取安全建议（委托给安全分析器）
   */
  getSafetySuggestions(command) {
    return safetyAnalyzer.getSafetySuggestions(command);
  }

  /**
   * 执行命令的内部方法
   */
  async _runCommand(cmd, opts = {}) {
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: opts.timeout || 30000,
        maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
        cwd: opts.cwd || process.env.HOME
      });
      
      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim()
        },
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stderr: error.stderr,
        stdout: error.stdout,
        needConfirm: false
      };
    }
  }
}

module.exports = new CommandTool();

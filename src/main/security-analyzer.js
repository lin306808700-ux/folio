/**
 * 命令安全准入系统
 * 
 * 核心功能：
 * 1. 解析Shell命令，识别潜在风险
 * 2. 计算命令的"爆炸半径"（Blast Radius）
 * 3. 对高危操作进行风险打分（0-100）
 * 4. 提供安全建议和替代方案
 */

class SecurityAnalyzer {
  constructor() {
    // 危险命令模式库
    this.dangerPatterns = this.initDangerPatterns();
    
    // 风险权重配置
    this.riskWeights = {
      critical: 100,  // 致命风险：数据丢失、系统破坏
      high: 75,       // 高风险：权限修改、网络暴露
      medium: 50,     // 中风险：批量操作、资源消耗
      low: 25         // 低风险：信息查询、只读操作
    };
  }

  /**
   * 初始化危险命令模式库
   */
  initDangerPatterns() {
    return {
      // 文件删除操作
      deletion: {
        patterns: [
          /rm\s+-rf?\s+[\/~]/i,           // rm -rf / 或 rm -rf ~
          /rm\s+-rf?\s+\*/i,              // rm -rf *
          /rm\s+-rf?\s+\.?\*/i,           // rm -rf .* (包括隐藏文件)
          /del\s+\/[sS]/i,                // Windows del /S
        ],
        risk: 'critical',
        message: '将删除大量文件，此操作不可逆！',
        suggestions: ['请确认目标路径', '考虑使用 --dry-run 预览', '使用 trash 命令代替 rm']
      },

      // 权限修改操作
      permission: {
        patterns: [
          /chmod\s+777/i,                 // chmod 777 (过度开放权限)
          /chmod\s+-R\s+777/i,            // 递归 chmod 777
          /chown\s+-R\s+root/i,           // 递归修改所有者为 root
          /chmod\s+a\+rw/i,               // 所有人可读写
        ],
        risk: 'high',
        message: '将开放文件权限，可能造成安全风险',
        suggestions: ['使用最小权限原则', '仅修改必要的文件', '考虑使用 sudo 谨慎操作']
      },

      // 系统关键文件操作
      systemFiles: {
        patterns: [
          /rm\s+.*\/etc\//i,              // 删除 /etc/ 下的文件
          /rm\s+.*\/usr\//i,              // 删除 /usr/ 下的文件
          /rm\s+.*\/bin\//i,              // 删除 /bin/ 下的文件
          /rm\s+.*\/sbin\//i,             // 删除 /sbin/ 下的文件
          /dd\s+if=\/dev\/zero/i,         // dd 破坏性操作
          /dd\s+if=\/dev\/urandom/i,      // dd 随机数据覆盖
          /mkfs\./i,                      // 格式化文件系统
          /fdisk/i,                       // 磁盘分区操作
        ],
        risk: 'critical',
        message: '操作系统关键文件，可能导致系统无法启动！',
        suggestions: ['绝对不要执行此命令', '如必须操作，先备份系统', '考虑使用虚拟环境测试']
      },

      // 网络暴露操作
      networkExposure: {
        patterns: [
          /iptables\s+-F/i,               // 清空防火墙规则
          /ufw\s+disable/i,               // 禁用防火墙
          /nc\s+-l.*-e/i,                 // netcat 反向shell
          /curl.*\|.*sh/i,                // curl | sh (远程执行脚本)
          /wget.*\|.*sh/i,                // wget | sh
        ],
        risk: 'high',
        message: '可能暴露系统或执行未验证的远程代码',
        suggestions: ['先检查脚本内容', '使用 HTTPS 源', '在隔离环境中测试']
      },

      // 数据库危险操作
      database: {
        patterns: [
          /DROP\s+DATABASE/i,             // 删除数据库
          /DROP\s+TABLE/i,                // 删除表
          /DELETE\s+FROM.*WHERE\s+1=1/i,  // 删除所有记录
          /TRUNCATE\s+TABLE/i,            // 清空表
          /mysql.*-e.*DROP/i,             // MySQL 命令行删除操作
        ],
        risk: 'critical',
        message: '将永久删除数据，此操作不可逆！',
        suggestions: ['先备份数据库', '使用 WHERE 子句限制范围', '在测试环境验证']
      },

      // Git 危险操作
      git: {
        patterns: [
          /git\s+reset\s+--hard\s+HEAD~\d+/i,  // 强制回退多个提交
          /git\s+clean\s+-fd/i,                 // 删除未跟踪文件
          /git\s+branch\s+-D/i,                 // 强制删除分支
          /git\s+push.*--force/i,               // 强制推送
        ],
        risk: 'medium',
        message: 'Git 历史将被修改，可能丢失提交',
        suggestions: ['确认分支名称', '考虑使用 --soft 保留更改', '先备份当前状态']
      },

      // 批量操作
      batch: {
        patterns: [
          /find\s+\/.*-exec\s+rm/i,        // 全盘查找并删除
          /find\s+~.*-exec\s+rm/i,         // 用户目录查找并删除
          /grep\s+-r.*\|.*xargs\s+rm/i,    // 查找并批量删除
          /for.*in.*do.*rm/i,              // 循环删除
        ],
        risk: 'high',
        message: '批量操作影响范围大，请仔细确认',
        suggestions: ['先使用 -print 预览', '限制搜索深度 -maxdepth', '添加文件类型过滤']
      },

      // 包管理器危险操作
      packageManager: {
        patterns: [
          /npm\s+uninstall.*-g/i,          // 全局卸载包
          /pip\s+uninstall.*-y/i,          // 强制卸载 Python 包
          /brew\s+uninstall.*--force/i,    // 强制卸载 Homebrew 包
          /rm\s+-rf.*node_modules/i,       // 删除 node_modules
        ],
        risk: 'medium',
        message: '将移除依赖包，可能影响项目运行',
        suggestions: ['确认包名称', '检查依赖关系', '考虑重新安装而非删除']
      },

      // 压缩/解压覆盖操作
      overwrite: {
        patterns: [
          /tar\s+.*--overwrite/i,          // 强制覆盖
          /unzip\s+-o/i,                   // 解压覆盖
          /cp\s+-f.*\//i,                  // 强制复制到根目录
          /mv\s+-f.*\//i,                  // 强制移动到根目录
        ],
        risk: 'medium',
        message: '将覆盖现有文件，数据可能丢失',
        suggestions: ['先备份目标文件', '使用 -n 选项跳过已存在文件', '确认目标路径']
      },

      // 进程管理
      process: {
        patterns: [
          /kill\s+-9\s+-1/i,               // 杀死所有进程
          /killall\s+-9/i,                 // 强制杀死所有同名进程
          /pkill\s+-9/i,                   // 强制杀死进程
          /systemctl\s+stop.*critical/i,   // 停止关键服务
        ],
        risk: 'high',
        message: '将终止进程，可能导致服务中断',
        suggestions: ['确认进程 ID', '先尝试正常停止', '检查依赖服务']
      }
    };
  }

  /**
   * 分析命令安全性（带超时保护）
   *
   * 借鉴 Claude Code 权限系统的"分类器 + 超时回退"模式：
   * - 正常情况下进行完整的安全分析
   * - 如果分析超时（默认 2 秒），回退到保守策略（标记为需要确认）
   * - 支持复合命令拆解（cmd1 && cmd2 | cmd3 逐个检查）
   *
   * @param {string} command - 要分析的命令
   * @param {Object} options - 可选配置
   * @param {number} options.timeout - 超时时间（毫秒），默认 2000
   * @returns {Object} 分析结果
   */
  analyze(command, options = {}) {
    const { timeout = 2000 } = options

    if (!command || typeof command !== 'string' || !command.trim()) {
      return {
        safe: true,
        riskScore: 0,
        riskLevel: 'none',
        message: '空命令',
        patterns: []
      }
    }

    const startTime = Date.now()
    const trimmedCommand = command.trim()

    try {
      // 拆解复合命令（借鉴 Claude Code BashTool 的安全修复案例）
      // "echo hello && rm -rf /" 整体不以 "rm" 开头，前缀匹配会跳过
      // 修复：拆分为 ["echo hello", "rm -rf /"] 逐个检查
      const subCommands = this._splitCompoundCommand(trimmedCommand)

      const matchedPatterns = []
      let maxRisk = 'none'

      for (const subCmd of subCommands) {
        // 超时检查：如果分析耗时超过阈值，回退到保守策略
        if (Date.now() - startTime > timeout) {
          console.warn(`[Security] 安全分析超时 (>${timeout}ms)，回退到保守策略`)
          return {
            safe: false,
            riskScore: 50,
            riskLevel: 'medium',
            message: '安全分析超时，建议人工确认',
            patterns: matchedPatterns,
            blastRadius: 'unknown',
            suggestions: ['安全分析未完成，请人工检查命令内容'],
            timedOut: true
          }
        }

        for (const [category, config] of Object.entries(this.dangerPatterns)) {
          for (const pattern of config.patterns) {
            if (pattern.test(subCmd)) {
              matchedPatterns.push({
                category,
                pattern: pattern.toString(),
                risk: config.risk,
                message: config.message,
                suggestions: config.suggestions,
                matchedCommand: subCmd !== trimmedCommand ? subCmd : undefined
              })

              if (this.compareRisk(config.risk, maxRisk) > 0) {
                maxRisk = config.risk
              }
            }
          }
        }
      }

      const riskScore = this.calculateRiskScore(matchedPatterns, maxRisk)
      const safe = riskScore < 40

      const elapsed = Date.now() - startTime
      if (elapsed > 100) {
        console.log(`[Security] 安全分析耗时 ${elapsed}ms`)
      }

      return {
        safe,
        riskScore,
        riskLevel: maxRisk,
        message: this.getRiskMessage(maxRisk, matchedPatterns),
        patterns: matchedPatterns,
        blastRadius: this.calculateBlastRadius(trimmedCommand, matchedPatterns),
        suggestions: this.getSuggestions(matchedPatterns)
      }
    } catch (error) {
      // Fail-closed：分析异常时回退到保守策略，要求人工确认
      console.error('[Security] 安全分析异常，回退到保守策略:', error.message)
      return {
        safe: false,
        riskScore: 50,
        riskLevel: 'medium',
        message: `安全分析异常: ${error.message}，建议人工确认`,
        patterns: [],
        blastRadius: 'unknown',
        suggestions: ['安全分析出错，请人工检查命令内容'],
        error: error.message
      }
    }
  }

  /**
   * 拆解复合命令为独立子命令。
   *
   * 借鉴 Claude Code BashTool bashPermissions.ts 的安全修复案例：
   * 复合命令中的子命令需逐个检查，否则 "echo hello && rm -rf /"
   * 整体不以 "rm" 开头，前缀匹配会跳过危险子命令。
   *
   * 支持的分隔符：&&、||、;、|（管道）
   * 管道分段后仍用原始命令检查路径约束和危险模式。
   */
  _splitCompoundCommand(command) {
    // 按 &&、||、; 分割（不在引号内的）
    const subCommands = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false

    for (let i = 0; i < command.length; i++) {
      const ch = command[i]

      if (escaped) {
        current += ch
        escaped = false
        continue
      }

      if (ch === '\\') {
        current += ch
        escaped = true
        continue
      }

      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        current += ch
        continue
      }

      if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        current += ch
        continue
      }

      if (!inSingleQuote && !inDoubleQuote) {
        // 检查 &&、||、;
        if (ch === '&' && i + 1 < command.length && command[i + 1] === '&') {
          if (current.trim()) subCommands.push(current.trim())
          current = ''
          i++ // 跳过第二个 &
          continue
        }
        if (ch === '|' && i + 1 < command.length && command[i + 1] === '|') {
          if (current.trim()) subCommands.push(current.trim())
          current = ''
          i++ // 跳过第二个 |
          continue
        }
        if (ch === ';') {
          if (current.trim()) subCommands.push(current.trim())
          current = ''
          continue
        }
        // 管道：也拆分检查（"echo x | xargs rm" 中 xargs rm 需要单独检查）
        if (ch === '|') {
          if (current.trim()) subCommands.push(current.trim())
          current = ''
          continue
        }
      }

      current += ch
    }

    if (current.trim()) subCommands.push(current.trim())

    // 如果只有一个子命令且等于原始命令，直接返回
    if (subCommands.length <= 1) return [command.trim()]

    // 返回子命令列表（同时保留原始完整命令，用于路径约束检查）
    return [command.trim(), ...subCommands]
  }

  /**
   * 分析脚本文件内容的安全性。
   * 读取脚本文件内容，提取其中的命令行并逐个分析。
   *
   * @param {string} scriptContent - 脚本文件内容
   * @param {string} lang - 脚本语言（sh/node/python 等）
   * @returns {Object} 分析结果
   */
  analyzeScriptContent(scriptContent, lang = 'sh') {
    if (!scriptContent || typeof scriptContent !== 'string') {
      return { safe: true, riskScore: 0, riskLevel: 'none', message: '空脚本', patterns: [] }
    }

    // 对于 shell 脚本，逐行提取命令进行分析
    if (lang === 'sh' || lang === 'bash') {
      const lines = scriptContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')) // 跳过注释和空行

      const allPatterns = []
      let maxRisk = 'none'

      for (const line of lines) {
        const lineResult = this.analyze(line, { timeout: 500 })
        if (lineResult.patterns.length > 0) {
          allPatterns.push(...lineResult.patterns)
          if (this.compareRisk(lineResult.riskLevel, maxRisk) > 0) {
            maxRisk = lineResult.riskLevel
          }
        }
      }

      const riskScore = this.calculateRiskScore(allPatterns, maxRisk)
      return {
        safe: riskScore < 40,
        riskScore,
        riskLevel: maxRisk,
        message: this.getRiskMessage(maxRisk, allPatterns),
        patterns: allPatterns,
        blastRadius: this.calculateBlastRadius(scriptContent, allPatterns),
        suggestions: this.getSuggestions(allPatterns)
      }
    }

    // 对于 node/python 脚本，检查是否包含危险的系统调用
    const dangerousNodePatterns = [
      { pattern: /child_process/, risk: 'medium', message: '脚本使用了子进程执行，可能执行任意命令' },
      { pattern: /fs\.rmSync|fs\.rmdirSync|fs\.unlinkSync/, risk: 'high', message: '脚本包含文件删除操作' },
      { pattern: /process\.exit/, risk: 'low', message: '脚本会终止进程' },
      { pattern: /eval\s*\(/, risk: 'high', message: '脚本使用了 eval，可能执行任意代码' },
      { pattern: /require\s*\(\s*['"]child_process['"]/, risk: 'medium', message: '脚本导入了 child_process 模块' },
    ]

    const matchedPatterns = []
    let maxRisk = 'none'

    for (const { pattern, risk, message } of dangerousNodePatterns) {
      if (pattern.test(scriptContent)) {
        matchedPatterns.push({
          category: 'script_content',
          pattern: pattern.toString(),
          risk,
          message,
          suggestions: ['请检查脚本内容是否安全']
        })
        if (this.compareRisk(risk, maxRisk) > 0) {
          maxRisk = risk
        }
      }
    }

    const riskScore = this.calculateRiskScore(matchedPatterns, maxRisk)
    return {
      safe: riskScore < 40,
      riskScore,
      riskLevel: maxRisk,
      message: this.getRiskMessage(maxRisk, matchedPatterns),
      patterns: matchedPatterns,
      suggestions: this.getSuggestions(matchedPatterns)
    }
  }

  /**
   * 计算风险分数
   */
  calculateRiskScore(matchedPatterns, maxRisk) {
    if (matchedPatterns.length === 0) {
      return 0;
    }

    // 基础分数基于最高风险等级
    let score = this.riskWeights[maxRisk] || 0;

    // 匹配的模式越多，分数越高
    score += matchedPatterns.length * 5;

    // 限制在 0-100 范围内
    return Math.min(100, score);
  }

  /**
   * 比较风险等级
   */
  compareRisk(risk1, risk2) {
    const order = ['none', 'low', 'medium', 'high', 'critical'];
    return order.indexOf(risk1) - order.indexOf(risk2);
  }

  /**
   * 获取风险消息
   */
  getRiskMessage(riskLevel, patterns) {
    if (patterns.length === 0) {
      return '命令看起来安全';
    }

    const messages = patterns.map(p => p.message);
    return [...new Set(messages)].join('；');
  }

  /**
   * 计算爆炸半径
   */
  calculateBlastRadius(command, patterns) {
    // 检查是否涉及根目录或用户主目录
    if (/\/\s*$/.test(command) || /~\s*$/.test(command)) {
      return 'system';
    }

    // 检查是否递归操作
    if (/-R|-r|--recursive/.test(command)) {
      return 'directory_recursive';
    }

    // 检查是否批量操作
    if (patterns.some(p => p.category === 'batch')) {
      return 'batch';
    }

    // 检查是否涉及多个文件
    if (/\*/.test(command) || /\?/.test(command)) {
      return 'multiple_files';
    }

    return 'single_file';
  }

  /**
   * 获取安全建议
   */
  getSuggestions(patterns) {
    const allSuggestions = patterns.flatMap(p => p.suggestions);
    return [...new Set(allSuggestions)].slice(0, 5); // 最多返回5条建议
  }

  /**
   * 生成安全报告
   */
  generateReport(command, analysis) {
    return {
      command,
      timestamp: new Date().toISOString(),
      safe: analysis.safe,
      riskScore: analysis.riskScore,
      riskLevel: analysis.riskLevel,
      blastRadius: analysis.blastRadius,
      message: analysis.message,
      matchedPatterns: analysis.patterns.length,
      suggestions: analysis.suggestions,
      requiresConfirmation: analysis.riskScore >= 40
    };
  }

  /**
   * 批量分析多个命令
   */
  analyzeBatch(commands) {
    return commands.map(cmd => this.analyze(cmd));
  }

  /**
   * 添加自定义危险模式
   */
  addDangerPattern(category, pattern, risk, message, suggestions = []) {
    if (!this.dangerPatterns[category]) {
      this.dangerPatterns[category] = {
        patterns: [],
        risk,
        message,
        suggestions
      };
    }
    this.dangerPatterns[category].patterns.push(pattern);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const totalPatterns = Object.values(this.dangerPatterns)
      .reduce((sum, config) => sum + config.patterns.length, 0);

    return {
      totalCategories: Object.keys(this.dangerPatterns).length,
      totalPatterns,
      riskLevels: Object.keys(this.riskWeights)
    };
  }
}

// 导出单例
module.exports = new SecurityAnalyzer();
'use strict';

const scenarios = require('./self-check-scenarios');

class SelfCheckRunner {
  constructor() {
    this.scenarios = scenarios;
  }

  /**
   * 将自检场景列表转换为任务引擎可执行的 taskPlan。
   * 每个场景变成一个 analyze 步骤，由 AI 静默执行并输出结构化结果。
   * 完全复用任务引擎和 UnifiedTaskCard，不产生额外卡片。
   *
   * @param {string|null} groupFilter - 可选的分组过滤
   * @returns {{ id: string, taskName: string, steps: Array, needConfirm: boolean, summary: string }}
   */
  buildTaskPlan(groupFilter) {
    const targetScenarios = groupFilter
      ? this.scenarios.filter(s => s.group === groupFilter)
      : this.scenarios;

    const steps = targetScenarios.map((scenario, index) => ({
      id: String(index + 1),
      description: `[${scenario.group}] ${scenario.description}`,
      type: 'analyze',
      // analyze 步骤不依赖上下文，直接把场景输入作为 prompt 注入
      prompt: this._buildScenarioPrompt(scenario),
      onError: 'skip',
      outputSchema: {
        pass: '是否通过验证（true/false）',
        response: 'AI 执行后的响应摘要（不超过200字）',
        reason: '通过或失败的原因说明'
      },
      // 把原始场景信息挂在步骤上，供最终报告使用
      _scenario: scenario
    }));

    // 最后追加一个汇总步骤
    const scenarioIds = targetScenarios.map((_, i) => String(i + 1));
    steps.push({
      id: String(targetScenarios.length + 1),
      description: '汇总自检结果，生成报告',
      type: 'analyze',
      contextKeys: scenarioIds,
      prompt: '请汇总以上所有自检场景的执行结果，统计通过/失败数量，列出失败项的原因，给出系统健康状态评估。',
      outputSchema: {
        summary: '自检报告摘要',
        totalPass: '通过数量',
        totalFail: '失败数量',
        healthStatus: '系统健康状态：healthy / warning / critical'
      }
    });

    return {
      id: `selfcheck_${Date.now()}`,
      taskName: groupFilter ? `系统自检 · ${groupFilter}` : '系统自检',
      steps,
      needConfirm: false,
      summary: groupFilter
        ? `正在执行系统自检（分组：${groupFilter}），共 ${targetScenarios.length} 个场景`
        : `正在执行系统自检，共 ${targetScenarios.length} 个场景`
    };
  }

  /**
   * 为单个场景构建 analyze 步骤的 prompt
   * AI 会根据 prompt 执行对应操作并返回结构化结果
   */
  _buildScenarioPrompt(scenario) {
    const expectDesc = scenario.expect.contains
      ? `响应中需包含以下关键词之一：${scenario.expect.contains.join('、')}`
      : scenario.expect.notEmpty
        ? '响应不能为空'
        : `响应长度不少于 ${scenario.expect.minLength || 0} 字符`;

    return `你是系统自检 Agent。请执行以下自检场景并返回结构化结果。

【场景ID】${scenario.id}
【场景描述】${scenario.description}
【执行指令】${scenario.input}
【验证规则】${expectDesc}

请实际执行上述指令，然后根据执行结果判断是否通过验证规则，返回结构化结果。`;
  }

  /**
   * 按分组过滤场景（供外部查询用）
   */
  filterScenarios(groupFilter) {
    return groupFilter
      ? this.scenarios.filter(s => s.group === groupFilter)
      : this.scenarios;
  }

  /**
   * 验证响应是否符合预期
   * @param {string} response - AI 响应内容
   * @param {Object} expect - 预期配置
   * @returns {boolean} 是否通过验证
   */
  _validate(response, expect) {
    if (!response) return false;
    const text = String(response);
    if (expect.notEmpty && text.trim().length === 0) return false;
    if (expect.minLength && text.length < expect.minLength) return false;
    if (expect.contains && expect.contains.length > 0) {
      // 至少匹配一个关键词即算通过
      return expect.contains.some(keyword => text.includes(keyword));
    }
    return true;
  }

  /**
   * 生成 Markdown 格式的自检报告
   * @param {Array} results - 测试结果列表
   * @returns {string} Markdown 格式的报告
   */
  formatReport(results) {
    const groups = {};
    for (const r of results) {
      if (!groups[r.group]) groups[r.group] = [];
      groups[r.group].push(r);
    }

    const totalPass = results.filter(r => r.pass).length;
    const totalCount = results.length;
    const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

    let report = `## AI Terminal 自检报告\n\n`;
    report += `> 共 ${totalCount} 个场景，${totalPass} 个通过，${totalCount - totalPass} 个失败 | 总耗时: ${(totalDuration / 1000).toFixed(1)}s\n\n`;

    for (const [groupName, items] of Object.entries(groups)) {
      const groupPass = items.filter(r => r.pass).length;
      const groupStatus = groupPass === items.length ? '✅' : '⚠️';
      report += `### ${groupStatus} ${groupName} (${groupPass}/${items.length} 通过)\n\n`;
      report += `| # | 场景 | 模拟输入 | 结果 | 耗时 |\n`;
      report += `|---|------|---------|------|------|\n`;

      items.forEach((item, idx) => {
        const status = item.pass ? '✅ PASS' : '❌ FAIL';
        const inputSummary = item.input.length > 25 ? item.input.substring(0, 25) + '...' : item.input;
        const duration = item.duration ? `${(item.duration / 1000).toFixed(1)}s` : '-';
        report += `| ${idx + 1} | ${item.description} | ${inputSummary} | ${status} | ${duration} |\n`;
      });

      // 显示失败详情
      const failures = items.filter(r => !r.pass);
      if (failures.length > 0) {
        report += `\n**失败详情:**\n`;
        for (const f of failures) {
          if (f.error) {
            report += `- **${f.description}**: 错误 - ${f.error}\n`;
          } else {
            report += `- **${f.description}**: 响应未包含预期关键词 [${f.expect.contains?.join(', ') || ''}]\n`;
            if (f.response) {
              report += `  > 实际响应: ${f.response.substring(0, 100)}...\n`;
            }
          }
        }
      }
      report += `\n`;
    }

    // 总结
    if (totalPass === totalCount) {
      report += `---\n\n**🎉 全部通过！系统运行正常。**\n`;
    } else {
      report += `---\n\n**⚠️ 发现 ${totalCount - totalPass} 个问题，请检查上述失败项。**\n`;
    }

    return report;
  }

  /**
   * 清理自检产生的测试数据
   * @param {Object} database - { Skills, Memories, History }
   */
  async cleanup(database) {
    console.log('[SelfCheck] 开始清理测试数据...');

    // 清理 __selfcheck_ 前缀的技能
    if (database?.Skills) {
      try {
        const allSkills = database.Skills.getAll();
        const testSkills = allSkills.filter(s =>
          (s.name && s.name.includes('__selfcheck_')) ||
          (s.id && s.id.includes('__selfcheck_'))
        );
        for (const skill of testSkills) {
          database.Skills.delete(skill.id || skill.name);
          console.log('[SelfCheck] 已清理技能:', skill.name);
        }
      } catch (e) {
        console.warn('[SelfCheck] 清理技能失败:', e.message);
      }
    }

    // 清理 __selfcheck_ 前缀的记忆
    if (database?.Memories) {
      try {
        const allMemories = database.Memories.getAll();
        const testMemories = allMemories.filter(m =>
          (m.content && m.content.includes('__selfcheck_')) ||
          (m.query && m.query.includes('__selfcheck_'))
        );
        for (const memory of testMemories) {
          database.Memories.delete(memory.id);
          console.log('[SelfCheck] 已清理记忆:', memory.id);
        }
      } catch (e) {
        console.warn('[SelfCheck] 清理记忆失败:', e.message);
      }
    }

    console.log('[SelfCheck] 测试数据清理完成');
  }

  /**
   * 获取所有可用的分组名称
   * @returns {Array<string>} 分组名称列表
   */
  getGroups() {
    const groups = new Set();
    for (const scenario of this.scenarios) {
      groups.add(scenario.group);
    }
    return Array.from(groups);
  }

  /**
   * 获取场景总数
   * @returns {number} 场景总数
   */
  getScenarioCount() {
    return this.scenarios.length;
  }
}

module.exports = new SelfCheckRunner();

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

/**
 * 网页搜索工具
 * 用于任务引擎中执行网络搜索
 */

const { searchBing, formatSearchResults } = require('../../web-search');

const webSearchTool = {
  /**
   * 执行网络搜索
   * @param {Object} params - 参数
   * @param {string} params.keywords - 搜索关键词
   * @param {number} params.limit - 返回结果数量限制（默认5）
   * @returns {Promise<Object>} 搜索结果
   */
  async search(params = {}) {
    const { keywords, limit = 5 } = params;
    
    if (!keywords || typeof keywords !== 'string') {
      return {
        success: false,
        error: '搜索关键词不能为空'
      };
    }

    try {
      console.log('[WebSearchTool] 执行搜索:', keywords);
      
      const results = await searchBing(keywords, limit);
      
      if (results.length === 0) {
        return {
          success: true,
          results: [],
          formatted: '未找到相关搜索结果。',
          keywords
        };
      }

      const formatted = formatSearchResults(results);
      
      return {
        success: true,
        results,
        formatted,
        keywords,
        count: results.length
      };
    } catch (error) {
      console.error('[WebSearchTool] 搜索失败:', error.message);
      return {
        success: false,
        error: error.message,
        keywords
      };
    }
  },

  /**
   * 搜索并分析
   * 执行搜索后对结果进行简单整理
   * @param {Object} params - 参数
   * @param {string} params.keywords - 搜索关键词
   * @param {number} params.limit - 返回结果数量限制
   * @returns {Promise<Object>} 搜索结果和整理后的内容
   */
  async searchAndAnalyze(params = {}) {
    const searchResult = await this.search(params);
    
    if (!searchResult.success) {
      return searchResult;
    }

    // 提取关键信息用于后续 AI 分析
    const summaries = searchResult.results.map((r, i) => 
      `[${i + 1}] ${r.title}: ${r.snippet || '无摘要'}`
    ).join('\n');

    return {
      ...searchResult,
      summaries,
      analysisReady: true
    };
  }
};

module.exports = webSearchTool;

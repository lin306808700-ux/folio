// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

/**
 * 记忆操作工具
 * 所有记忆操作都是安全的（只新增/查询，不删除）
 */

class MemoryTool {
  constructor() {
    this.name = 'memory';
    this.memoriesDB = null; // 将在初始化时注入
  }

  /**
   * 设置数据库引用
   */
  setDatabase(db) {
    this.memoriesDB = db;
  }

  /**
   * 添加记忆 - 安全操作
   * 支持参数: string 或 { content: string }
   */
  async addMemory(content) {
    if (!this.memoriesDB) {
      return {
        success: false,
        error: '记忆数据库未初始化',
        needConfirm: false
      };
    }

    // 处理对象参数 { content: '...' }
    const actualContent = typeof content === 'object' && content !== null 
      ? content.content 
      : content;

    if (!actualContent || typeof actualContent !== 'string') {
      return {
        success: false,
        error: 'addMemory 需要 content 参数',
        needConfirm: false
      };
    }

    try {
      const result = this.memoriesDB.add({ content: actualContent });
      
      return {
        success: true,
        data: {
          id: result.id,
          content: result.content,
          createdAt: result.created_at
        },
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 批量添加记忆 - 安全操作
   * 支持参数: string[] 或 { contents: string[] }
   */
  async addMemories(contents) {
    // 处理对象参数 { contents: [...] }
    const actualContents = typeof contents === 'object' && contents !== null && !Array.isArray(contents)
      ? contents.contents 
      : contents;

    if (!Array.isArray(actualContents)) {
      return {
        success: false,
        error: 'addMemories 需要数组类型的 contents 参数',
        needConfirm: false
      };
    }
    
    const results = [];
    
    for (const content of actualContents) {
      const result = await this.addMemory(content);
      if (result.success) {
        results.push(result.data);
      }
    }
    
    return {
      success: true,
      data: results,
      needConfirm: false
    };
  }

  /**
   * 获取记忆 - 安全操作（只返回 active 状态）
   * 支持参数: number 或 { limit: number }
   */
  async getMemories(limit = 50) {
    if (!this.memoriesDB) {
      return {
        success: false,
        error: '记忆数据库未初始化',
        needConfirm: false
      };
    }

    // 处理对象参数 { limit: ... }
    const actualLimit = typeof limit === 'object' && limit !== null 
      ? (limit.limit || 50) 
      : (limit || 50);

    try {
      const memories = this.memoriesDB.getActive ? this.memoriesDB.getActive() : this.memoriesDB.getAll();
      const limited = memories.slice(0, actualLimit);
      
      return {
        success: true,
        data: limited.map(m => ({
          id: m.id,
          content: m.content,
          createdAt: m.created_at
        })),
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 搜索记忆 - 使用整合强度加权检索（优先返回高整合强度的匹配）
   */
  async searchMemories(keyword) {
    if (!this.memoriesDB) {
      return {
        success: false,
        error: '记忆数据库未初始化',
        needConfirm: false
      };
    }

    // 处理对象参数 { keyword: '...' }
    const actualKeyword = typeof keyword === 'object' && keyword !== null
      ? keyword.keyword
      : keyword;

    if (!actualKeyword || typeof actualKeyword !== 'string') {
      return { success: false, error: 'searchMemories 需要 keyword 参数', needConfirm: false };
    }

    try {
      let results;

      // 优先使用整合强度加权检索
      if (this.memoriesDB.searchWithIntegration) {
        results = this.memoriesDB.searchWithIntegration(actualKeyword, 20);
        // 对匹配到的记忆自动提升激活强度（被检索 = 被使用）
        for (const memory of results) {
          if (this.memoriesDB.boostIntegration) {
            this.memoriesDB.boostIntegration(memory.id, { activation: 0.1 });
          }
        }
      } else {
        // 降级：纯关键词匹配
        const memories = this.memoriesDB.getActive ? this.memoriesDB.getActive() : this.memoriesDB.getAll();
        results = memories.filter(m =>
          (m.content || '').toLowerCase().includes(actualKeyword.toLowerCase())
        );
      }

      return {
        success: true,
        data: results.map(m => ({
          id: m.id,
          content: m.content,
          createdAt: m.created_at,
          integrationScore: m._score !== undefined ? Math.round(m._score * 100) / 100 : null
        })),
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 归档记忆 - 安全操作
   * 支持参数: string(id) 或 { id: string }
   */
  async archiveMemory(id) {
    if (!this.memoriesDB) {
      return {
        success: false,
        error: '记忆数据库未初始化',
        needConfirm: false
      };
    }

    const actualId = typeof id === 'object' && id !== null ? id.id : id;

    try {
      if (!this.memoriesDB.archive) {
        return { success: false, error: '当前数据库不支持归档操作', needConfirm: false };
      }
      const result = this.memoriesDB.archive(actualId);
      return {
        success: !!result,
        data: { id: actualId, status: 'archived' },
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 提升记忆整合强度 - 当记忆被引用/使用时调用
   * @param {string|object} params - ID 或 { id, activation, integration, intent }
   *   - id: 记忆ID（必须）
   *   - activation: 激活强度增量 (0-1)
   *   - integration: 关联密度增量 (0-1)
   *   - intent: 意图强度绝对值 (0-1)，设为 0 表示任务已完成
   */
  async boostMemory(params) {
    if (!this.memoriesDB) {
      return { success: false, error: '记忆数据库未初始化', needConfirm: false };
    }

    const actualParams = typeof params === 'string'
      ? { id: params, activation: 0.2 }
      : params;

    if (!actualParams || !actualParams.id) {
      return { success: false, error: 'boostMemory 需要 id 参数', needConfirm: false };
    }

    try {
      if (!this.memoriesDB.boostIntegration) {
        return { success: false, error: '当前数据库不支持整合强度操作', needConfirm: false };
      }

      const boost = {};
      if (typeof actualParams.activation === 'number') boost.activation = actualParams.activation;
      if (typeof actualParams.integration === 'number') boost.integration = actualParams.integration;
      if (typeof actualParams.intent === 'number') boost.intent = actualParams.intent;

      const result = this.memoriesDB.boostIntegration(actualParams.id, boost);
      return {
        success: !!result,
        data: { id: actualParams.id, boosted: boost },
        needConfirm: false
      };
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false };
    }
  }

  /**
   * 执行记忆衰减 - 自动归档低整合强度的过期记忆
   */
  async decayMemories() {
    if (!this.memoriesDB) {
      return { success: false, error: '记忆数据库未初始化', needConfirm: false };
    }

    try {
      if (!this.memoriesDB.runDecay) {
        return { success: false, error: '当前数据库不支持衰减操作', needConfirm: false };
      }

      const result = this.memoriesDB.runDecay();
      return {
        success: true,
        data: { archivedCount: result.archived },
        needConfirm: false
      };
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false };
    }
  }

  /**
   * 按整合强度排序检索记忆 - 重要的事记得更清楚
   * @param {number|object} params - 限制数量或 { limit, keyword }
   */
  async getByIntegration(params) {
    if (!this.memoriesDB) {
      return { success: false, error: '记忆数据库未初始化', needConfirm: false };
    }

    const actualParams = typeof params === 'object' && params !== null ? params : { limit: params || 20 };

    try {
      let results;

      if (actualParams.keyword && this.memoriesDB.searchWithIntegration) {
        results = this.memoriesDB.searchWithIntegration(actualParams.keyword, actualParams.limit || 10);
      } else if (this.memoriesDB.getByIntegrationScore) {
        results = this.memoriesDB.getByIntegrationScore(actualParams.limit || 20);
      } else {
        const memories = this.memoriesDB.getActive ? this.memoriesDB.getActive() : this.memoriesDB.getAll();
        results = memories.slice(0, actualParams.limit || 20);
      }

      return {
        success: true,
        data: results.map(m => ({
          id: m.id,
          content: m.content,
          createdAt: m.created_at,
          integrationScore: m._score !== undefined ? Math.round(m._score * 100) / 100 : null,
          activation: m.activation,
          integration: m.integration,
          intent: m.intent
        })),
        needConfirm: false
      };
    } catch (error) {
      return { success: false, error: error.message, needConfirm: false };
    }
  }

  /**
   * 获取记忆统计 - 安全操作
   */
  async getStats() {
    if (!this.memoriesDB) {
      return {
        success: false,
        error: '记忆数据库未初始化',
        needConfirm: false
      };
    }

    try {
      const allMemories = this.memoriesDB.getAll();
      const activeMemories = this.memoriesDB.getActive ? this.memoriesDB.getActive() : allMemories;
      
      return {
        success: true,
        data: {
          totalCount: allMemories.length,
          activeCount: activeMemories.length,
          archivedCount: allMemories.length - activeMemories.length,
          latestMemory: activeMemories.length > 0 ? activeMemories[0] : null
        },
        needConfirm: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }
}

module.exports = new MemoryTool();

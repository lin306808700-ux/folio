const axios = require('axios');

/**
 * 技能管理工具
 * 用于安装、检查技能
 */

class SkillTool {
  constructor() {
    this.name = 'skill';
    this.skillsDB = null; // 将在初始化时注入
  }

  /**
   * 设置数据库引用
   */
  setDatabase(db) {
    this.skillsDB = db;
  }

  /**
   * 从 URL 安装技能
   * 支持参数: { url: string, skillName?: string }
   */
  async install(params) {
    try {
      const { url, skillName } = typeof params === 'object' ? params : { url: params };
      
      if (!url) {
        return {
          success: false,
          error: 'install 需要 url 参数',
          needConfirm: false
        };
      }

      // 转换 GitHub URL 为 raw 地址
      let rawUrl = url.trim();
      
      if (rawUrl.includes('github.com')) {
        rawUrl = rawUrl.replace(/\/$/, '');
        let branch = 'main';
        
        if (rawUrl.includes('/blob/')) {
          const match = rawUrl.match(/\/blob\/([^\/]+)/);
          if (match) branch = match[1];
          rawUrl = rawUrl.replace('/blob/', '/');
        } else if (rawUrl.includes('/tree/')) {
          const match = rawUrl.match(/\/tree\/([^\/]+)/);
          if (match) branch = match[1];
          rawUrl = rawUrl.replace('/tree/', '/');
        } else {
          rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com');
          rawUrl = `${rawUrl}/${branch}`;
        }
        
        if (!rawUrl.includes('raw.githubusercontent.com')) {
          rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com');
        }
      }
      
      if (skillName) {
        if (!rawUrl.endsWith('/')) rawUrl += '/';
        rawUrl = `${rawUrl}${skillName}.json`;
      } else {
        if (!rawUrl.endsWith('.json')) rawUrl += '.json';
      }

      // 下载技能配置
      const response = await axios.get(rawUrl, { 
        timeout: 30000,
        headers: { 'User-Agent': 'AI-Terminal-Skill-Installer' }
      });
      
      const skillConfig = response.data;
      
      if (!skillConfig || typeof skillConfig !== 'object') {
        throw new Error('技能配置不是有效的 JSON 对象');
      }
      
      if (!skillConfig.name) {
        throw new Error('技能配置缺少 name 字段');
      }
      
      if (!skillConfig.prompt) {
        throw new Error('技能配置缺少 prompt 字段');
      }

      // 保存到数据库
      let result;
      if (this.skillsDB) {
        result = this.skillsDB.add({
          name: skillConfig.name,
          description: skillConfig.description || '',
          prompt: skillConfig.prompt,
          icon: skillConfig.icon || 'Zap'
        });
      }

      return {
        success: true,
        data: {
          name: skillConfig.name,
          description: skillConfig.description,
          icon: skillConfig.icon,
          record: result
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
   * 检查技能是否已安装
   * 支持参数: { name: string }
   */
  async isInstalled(params) {
    try {
      const { name } = typeof params === 'object' ? params : { name: params };
      
      if (!name) {
        return {
          success: false,
          error: 'isInstalled 需要 name 参数',
          needConfirm: false
        };
      }

      if (!this.skillsDB) {
        return {
          success: true,
          data: { installed: false },
          needConfirm: false
        };
      }

      const skills = this.skillsDB.getAll();
      const installed = skills.some(s => s.name === name || s.name.toLowerCase() === name.toLowerCase());

      return {
        success: true,
        data: { installed, name },
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
   * 获取已安装技能列表
   */
  async list() {
    try {
      if (!this.skillsDB) {
        return {
          success: true,
          data: [],
          needConfirm: false
        };
      }

      const skills = this.skillsDB.getAll();

      return {
        success: true,
        data: skills.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          icon: s.icon
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
}

module.exports = new SkillTool();

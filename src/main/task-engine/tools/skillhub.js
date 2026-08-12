const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

/**
 * SkillHub CLI 管理工具
 * 用于检查/安装 SkillHub CLI 以及通过 CLI 安装技能
 */

class SkillHubTool {
  constructor() {
    this.name = 'skillhub';
    // AI Terminal 技能目录（使用用户主目录下的 ~/.ai-terminal/skills，与 database.js 保持一致）
    this.aiTerminalSkillsDir = path.join(os.homedir(), '.ai-terminal', 'skills');
  }

  /**
   * 确保 AI Terminal 技能目录存在
   */
  _ensureAITerminalSkillsDir() {
    if (!fsSync.existsSync(this.aiTerminalSkillsDir)) {
      fsSync.mkdirSync(this.aiTerminalSkillsDir, { recursive: true });
    }
    return this.aiTerminalSkillsDir;
  }

  /**
   * 查找 SkillHub 安装的技能目录
   * @param {string} name - 技能名称
   * @returns {string|null} - 技能目录路径，找不到返回 null
   */
  _findInstalledSkillDir(name) {
    // 可能的安装位置（按优先级排序）
    const possiblePaths = [
      // 1. SkillHub CLI 默认安装位置（最高优先级，作为导入来源）
      path.join(os.homedir(), 'skills', name),
      // 2. 统一的用户技能目录（~/.ai-terminal/skills/）
      path.join(os.homedir(), '.ai-terminal', 'skills', name),
      // 3. 当前工作目录下（兼容）
      path.join(process.cwd(), 'skills', name),
    ];

    for (const p of possiblePaths) {
      if (fsSync.existsSync(p)) {
        console.log(`[SkillHub] 找到技能目录: ${p}`);
        return p;
      }
    }
    console.log(`[SkillHub] 未找到技能 ${name} 的安装目录，已检查路径:`, possiblePaths);
    return null;
  }

  /**
   * 解析 SKILL.md 的 frontmatter
   * @param {string} content - SKILL.md 内容
   * @returns {{ name: string, description: string, body: string }}
   */
  _parseSkillMd(content) {
    const result = { name: '', description: '', body: '' };
    
    // 检查是否有 frontmatter
    if (content.startsWith('---')) {
      const endIdx = content.indexOf('---', 3);
      if (endIdx !== -1) {
        const frontmatter = content.substring(3, endIdx).trim();
        const body = content.substring(endIdx + 3).trim();
        
        // 解析 frontmatter
        const lines = frontmatter.split('\n');
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            const key = line.substring(0, colonIdx).trim();
            let value = line.substring(colonIdx + 1).trim();
            // 去除引号
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (key === 'name') result.name = value;
            if (key === 'description') result.description = value;
          }
        }
        result.body = body;
      }
    } else {
      result.body = content;
    }
    
    return result;
  }

  /**
   * 将 SkillHub 技能转换为 AI Terminal 格式并保存
   * @param {string} skillDir - 技能目录路径
   * @param {string} name - 技能名称
   * @returns {{ success: boolean, filePath?: string, error?: string }}
   */
  async _importSkillToAITerminal(skillDir, name) {
    try {
      this._ensureAITerminalSkillsDir();

      // 读取 SKILL.md
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let skillContent = { name: name, description: '', body: '' };
      
      if (fsSync.existsSync(skillMdPath)) {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        skillContent = this._parseSkillMd(content);
        if (!skillContent.name) skillContent.name = name;
      }

      // 读取 _meta.json 获取版本信息
      const metaPath = path.join(skillDir, '_meta.json');
      let meta = {};
      if (fsSync.existsSync(metaPath)) {
        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          meta = JSON.parse(metaContent);
        } catch (e) {
          // 忽略解析错误
        }
      }

      // 读取 README.md 获取使用说明
      const readmePath = path.join(skillDir, 'README.md');
      let usage = '在 AI 终端中点击技能按钮激活，或输入相关问题时自动匹配。';
      if (fsSync.existsSync(readmePath)) {
        try {
          const readmeContent = await fs.readFile(readmePath, 'utf-8');
          // 提取前几行作为使用说明概要
          const lines = readmeContent.split('\n').slice(0, 10);
          const summary = lines.filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ');
          if (summary) {
            usage = summary.substring(0, 200) + (summary.length > 200 ? '...' : '');
          }
        } catch (e) {
          // 忽略读取错误
        }
      }

      // 构建 AI Terminal 格式的 Markdown
      const skillId = name.replace(/[^a-zA-Z0-9-_]/g, '-');
      const now = new Date().toISOString();
      
      let markdown = `# ${skillContent.name}\n\n`;
      markdown += `## 描述\n${skillContent.description || '来自 SkillHub 的技能'}\n\n`;
      markdown += `## 技能指令\n${skillContent.body || ''}\n\n`;
      markdown += `## 使用方法\n${usage}\n\n`;
      markdown += `---\n`;
      markdown += `*创建时间: ${now}*\n`;
      markdown += `*技能ID: ${skillId}*\n`;
      markdown += `*来源: SkillHub*\n`;
      if (meta.version) {
        markdown += `*版本: ${meta.version}*\n`;
      }

      // 写入文件
      const filePath = path.join(this.aiTerminalSkillsDir, `${skillId}.md`);
      await fs.writeFile(filePath, markdown, 'utf-8');
      
      console.log(`[SkillHub] 技能已导入到 AI Terminal: ${filePath}`);
      return { success: true, filePath };
    } catch (error) {
      console.error('[SkillHub] 导入技能失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 检查 SkillHub CLI 是否已安装
   * 返回 { success: true, data: { installed: boolean, path: string? } }
   */
  async cliIsInstalled() {
    try {
      const { stdout } = await execAsync('which skillhub');
      const path = stdout.trim();
      return {
        success: true,
        data: {
          installed: true,
          path: path
        },
        needConfirm: false
      };
    } catch (error) {
      // which 命令找不到时会抛出错误
      return {
        success: true,
        data: {
          installed: false,
          path: null
        },
        needConfirm: false
      };
    }
  }

  /**
   * 安装 SkillHub CLI（仅 CLI）
   * 执行安装脚本并验证安装结果
   * 返回 { success: boolean, data: { stdout, installed: boolean } }
   */
  async installCli() {
    try {
      // CLI 安装地址可配置：优先环境变量
      const installUrl = process.env.MUSE_SKILLHUB_INSTALL_URL || 'https://raw.githubusercontent.com/muse-ai-terminal/skillhub-cli/main/install.sh'
      const installCommand = `curl -fsSL ${installUrl} | bash -s -- --cli-only`;
      
      const { stdout, stderr } = await execAsync(installCommand, {
        timeout: 120000, // 120 秒超时
        shell: '/bin/bash'
      });

      // 安装完成后验证是否成功
      const verifyResult = await this.cliIsInstalled();
      const installed = verifyResult.data?.installed || false;

      return {
        success: true,
        data: {
          stdout: stdout + (stderr ? '\n' + stderr : ''),
          installed: installed
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
   * 使用 SkillHub CLI 安装指定技能
   * 支持参数: { name: string }
   * 返回 { success: boolean, data: { stdout, skillName, importedTo? } }
   */
  async installSkill(params) {
    try {
      const { name } = typeof params === 'object' ? params : { name: params };

      if (!name) {
        return {
          success: false,
          error: 'installSkill 需要 name 参数',
          needConfirm: false
        };
      }

      // 1. 预检查 CLI 可用性
      const cliCheck = await this.cliIsInstalled();
      if (!cliCheck.data.installed) {
        return {
          success: false,
          error: 'SkillHub CLI 未安装，请先安装 CLI',
          needConfirm: false
        };
      }

      // 2. 执行 skillhub install（使用 --force 避免目录已存在的冲突）
      const { stdout, stderr } = await execAsync(`skillhub install ${name} --force`, {
        timeout: 60000, // 60 秒超时
        shell: '/bin/bash'
      });

      const output = stdout + (stderr ? '\n' + stderr : '');

      // 3. 查找安装目录
      const skillDir = this._findInstalledSkillDir(name);
      
      // 4. 导入到 AI Terminal
      let importResult = { success: false };
      if (skillDir) {
        importResult = await this._importSkillToAITerminal(skillDir, name);
      }

      // 5. 返回结果
      const result = {
        success: true,
        data: {
          stdout: output,
          skillName: name
        },
        needConfirm: false
      };

      if (importResult.success) {
        result.data.importedTo = importResult.filePath;
        result.data.message = `技能已安装并导入到 AI Terminal: ${importResult.filePath}`;
      } else if (skillDir) {
        result.data.importError = importResult.error;
        result.data.message = `技能已安装到 ${skillDir}，但导入到 AI Terminal 失败: ${importResult.error}`;
      } else {
        result.data.message = `技能安装命令执行成功，但未找到安装目录，无法导入到 AI Terminal`;
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        needConfirm: false
      };
    }
  }

  /**
   * 使用 SkillHub CLI 搜索技能
   * 支持参数: { keyword: string }
   * 返回 { success: boolean, data: { stdout, results: string } }
   */
  async search(params) {
    try {
      const { keyword } = typeof params === 'object' ? params : { keyword: params };

      if (!keyword) {
        return {
          success: false,
          error: 'search 需要 keyword 参数',
          needConfirm: false
        };
      }

      const { stdout, stderr } = await execAsync(`skillhub search ${keyword}`, {
        timeout: 30000, // 30 秒超时
        shell: '/bin/bash'
      });

      const results = stdout.trim();

      return {
        success: true,
        data: {
          stdout: stdout + (stderr ? '\n' + stderr : ''),
          results: results
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

module.exports = new SkillHubTool();

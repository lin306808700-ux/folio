const fs = require('fs').promises;
const path = require('path');

/**
 * 文件操作工具
 * 安全操作（只读/查询）：直接执行
 * 危险操作（修改/删除）：标记需要确认
 */

class FileTool {
  constructor() {
    this.name = 'file';
  }

  /**
   * 列出目录内容 - 安全操作
   * 支持参数: string 或 { path: string }
   */
  async listDir(dirPath) {
    try {
      // 处理对象参数 { path: '...' }
      const actualPath = typeof dirPath === 'object' && dirPath !== null 
        ? dirPath.path || dirPath.dirPath 
        : dirPath;
      
      // 展开 ~ 为家目录
      const resolvedPath = this._resolvePath(actualPath);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      
      const result = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: path.join(resolvedPath, entry.name)
      }));

      return {
        success: true,
        data: result,
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
   * 读取文件内容 - 安全操作
   * 支持参数: string 或 { path: string }
   */
  async readFile(filePath) {
    try {
      // 处理对象参数 { path: '...' }
      const actualPath = typeof filePath === 'object' && filePath !== null 
        ? filePath.path || filePath.filePath 
        : filePath;
      
      const resolvedPath = this._resolvePath(actualPath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      
      return {
        success: true,
        data: content,
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
   * 批量读取多个文件 - 安全操作
   * 支持参数: string[] 或 { paths: string[] }
   */
  async readFiles(filePaths) {
    // 处理对象参数 { paths: [...] }
    const actualPaths = typeof filePaths === 'object' && filePaths !== null && !Array.isArray(filePaths)
      ? filePaths.paths || filePaths.filePaths 
      : filePaths;
    
    if (!Array.isArray(actualPaths)) {
      return {
        success: false,
        error: 'readFiles 需要数组类型的 paths 参数',
        needConfirm: false
      };
    }
    
    const results = [];
    for (const filePath of actualPaths) {
      const result = await this.readFile(filePath);
      if (result.success) {
        results.push({
          path: filePath,
          content: result.data
        });
      }
    }
    
    return {
      success: true,
      data: results,
      needConfirm: false
    };
  }

  /**
   * 检查文件是否存在 - 安全操作
   */
  async exists(filePath) {
    try {
      const resolvedPath = this._resolvePath(filePath);
      await fs.access(resolvedPath);
      return {
        success: true,
        data: true,
        needConfirm: false
      };
    } catch {
      return {
        success: true,
        data: false,
        needConfirm: false
      };
    }
  }

  /**
   * 获取文件状态 - 安全操作
   */
  async stat(filePath) {
    try {
      const resolvedPath = this._resolvePath(filePath);
      const stats = await fs.stat(resolvedPath);
      
      return {
        success: true,
        data: {
          size: stats.size,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          created: stats.birthtime,
          modified: stats.mtime
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
   * 写入文件 - 危险操作，需要确认
   */
  async writeFile(filePath, content) {
    const resolvedPath = this._resolvePath(filePath);
    
    return {
      success: false,
      needConfirm: true,
      operation: 'writeFile',
      preview: {
        path: resolvedPath,
        content: content.length > 500 ? content.substring(0, 500) + '...' : content,
        contentLength: content.length
      }
    };
  }

  /**
   * 确认后执行写入
   */
  async confirmWriteFile(filePath, content) {
    try {
      const resolvedPath = this._resolvePath(filePath);
      
      // 确保目录存在
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(resolvedPath, content, 'utf-8');
      
      return {
        success: true,
        data: { path: resolvedPath },
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
   * 删除文件 - 危险操作，需要确认
   */
  async deleteFile(filePath) {
    const resolvedPath = this._resolvePath(filePath);
    
    return {
      success: false,
      needConfirm: true,
      operation: 'deleteFile',
      preview: {
        path: resolvedPath,
        warning: '此操作将永久删除文件'
      }
    };
  }

  /**
   * 确认后执行删除
   */
  async confirmDeleteFile(filePath) {
    try {
      const resolvedPath = this._resolvePath(filePath);
      await fs.unlink(resolvedPath);
      
      return {
        success: true,
        data: { path: resolvedPath },
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
   * 查找文件 - 安全操作
   * 支持参数: (string, regex) 或 { path: string, pattern: regex }
   */
  async findFiles(dirPath, pattern) {
    try {
      // 处理对象参数 { path: '...', pattern: ... }
      let actualPath, actualPattern;
      if (typeof dirPath === 'object' && dirPath !== null) {
        actualPath = dirPath.path || dirPath.dirPath;
        actualPattern = dirPath.pattern || pattern;
      } else {
        actualPath = dirPath;
        actualPattern = pattern;
      }
      
      const resolvedPath = this._resolvePath(actualPath);
      const results = [];
      
      async function search(currentPath) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            // 跳过 node_modules 等目录
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
              continue;
            }
            await search(fullPath);
          } else if (entry.name.match(actualPattern)) {
            results.push(fullPath);
          }
        }
      }
      
      await search(resolvedPath);
      
      return {
        success: true,
        data: results,
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
   * 解析路径，处理 ~ 和环境变量
   */
  _resolvePath(inputPath) {
    if (inputPath.startsWith('~')) {
      return path.join(process.env.HOME, inputPath.slice(1));
    }
    return path.resolve(inputPath);
  }
}

module.exports = new FileTool();

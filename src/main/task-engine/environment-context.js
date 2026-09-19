// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 环境上下文感知器
 * 收集项目特征、分析环境状态、增强语义记忆
 */

class EnvironmentContext {
  constructor() {
    this.contextCache = new Map();
    this.projectFeatures = {};
    this.environmentState = {};
  }

  /**
   * 分析项目环境特征
   */
  async analyzeProjectContext(projectPath = process.cwd()) {
    const cacheKey = `project_${projectPath}`;
    
    // 检查缓存
    if (this.contextCache.has(cacheKey)) {
      const cached = this.contextCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 300000) { // 5分钟缓存
        return cached.data;
      }
    }
    
    const context = {
      projectPath: projectPath,
      timestamp: Date.now(),
      features: await this._extractProjectFeatures(projectPath),
      environment: await this._analyzeEnvironment(),
      dependencies: await this._analyzeDependencies(projectPath),
      fileStructure: await this._analyzeFileStructure(projectPath),
      codingPatterns: await this._analyzeCodingPatterns(projectPath)
    };
    
    // 缓存结果
    this.contextCache.set(cacheKey, {
      data: context,
      timestamp: context.timestamp
    });
    
    return context;
  }

  /**
   * 提取项目特征
   */
  async _extractProjectFeatures(projectPath) {
    const features = {
      languages: [],
      frameworks: [],
      tools: [],
      projectType: 'unknown',
      size: 'small',
      complexity: 'low'
    };
    
    try {
      // 检查配置文件
      const configFiles = await this._findConfigFiles(projectPath);
      
      // 分析 package.json
      if (configFiles.packageJson) {
        const pkg = JSON.parse(fs.readFileSync(configFiles.packageJson, 'utf8'));
        features.projectType = this._determineProjectType(pkg);
        features.languages.push('javascript');
        
        // 检查框架
        const frameworks = this._detectFrameworks(pkg);
        features.frameworks.push(...frameworks);
      }
      
      // 检查其他语言标识
      if (await this._fileExists(path.join(projectPath, 'requirements.txt'))) {
        features.languages.push('python');
        features.projectType = 'python-app';
      }
      
      if (await this._fileExists(path.join(projectPath, 'Cargo.toml'))) {
        features.languages.push('rust');
        features.projectType = 'rust-app';
      }
      
      if (await this._fileExists(path.join(projectPath, 'go.mod'))) {
        features.languages.push('go');
        features.projectType = 'go-app';
      }
      
      // 检查构建工具
      const buildTools = await this._detectBuildTools(projectPath, configFiles);
      features.tools.push(...buildTools);
      
      // 评估项目规模
      features.size = await this._assessProjectSize(projectPath);
      features.complexity = this._assessComplexity(features);
      
    } catch (error) {
      console.warn('项目特征提取失败:', error.message);
    }
    
    return features;
  }

  /**
   * 分析环境状态
   */
  async _analyzeEnvironment() {
    const env = {
      os: process.platform,
      nodeVersion: process.version,
      shell: process.env.SHELL || 'unknown',
      homeDir: process.env.HOME || process.env.USERPROFILE,
      workingDir: process.cwd(),
      envVars: this._getRelevantEnvVars(),
      systemInfo: await this._getSystemInfo()
    };
    
    return env;
  }

  /**
   * 分析依赖关系
   */
  async _analyzeDependencies(projectPath) {
    const deps = {
      direct: [],
      dev: [],
      outdated: [],
      vulnerabilities: []
    };
    
    try {
      // 检查 Node.js 项目
      const pkgPath = path.join(projectPath, 'package.json');
      if (await this._fileExists(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        
        deps.direct = Object.keys(pkg.dependencies || {});
        deps.dev = Object.keys(pkg.devDependencies || {});
        
        // 检查过时依赖（简化版本）
        deps.outdated = await this._checkOutdatedDependencies(projectPath);
      }
      
      // TODO: 添加其他语言的依赖分析
      
    } catch (error) {
      console.warn('依赖分析失败:', error.message);
    }
    
    return deps;
  }

  /**
   * 分析文件结构
   */
  async _analyzeFileStructure(projectPath) {
    const structure = {
      totalFiles: 0,
      totalDirs: 0,
      fileTypes: {},
      keyDirectories: [],
      recentChanges: []
    };
    
    try {
      // 递归遍历目录
      await this._walkDirectory(projectPath, structure, 3); // 限制深度
      
      // 识别关键目录
      structure.keyDirectories = await this._identifyKeyDirectories(projectPath);
      
      // 获取最近修改的文件
      structure.recentChanges = await this._getRecentChanges(projectPath);
      
    } catch (error) {
      console.warn('文件结构分析失败:', error.message);
    }
    
    return structure;
  }

  /**
   * 分析编码模式
   */
  async _analyzeCodingPatterns(projectPath) {
    const patterns = {
      namingConventions: [],
      codeStyles: [],
      testingPractices: [],
      documentation: []
    };
    
    try {
      // 分析命名约定
      patterns.namingConventions = await this._analyzeNamingConventions(projectPath);
      
      // 检查测试实践
      patterns.testingPractices = await this._analyzeTestingPractices(projectPath);
      
      // 检查文档情况
      patterns.documentation = await this._analyzeDocumentation(projectPath);
      
    } catch (error) {
      console.warn('编码模式分析失败:', error.message);
    }
    
    return patterns;
  }

  /**
   * 查找配置文件
   */
  async _findConfigFiles(projectPath) {
    const configs = {};
    const commonConfigs = [
      'package.json',
      '.git/config',
      '.eslintrc.js',
      '.prettierrc',
      'tsconfig.json',
      'webpack.config.js',
      'babel.config.js'
    ];
    
    for (const configFile of commonConfigs) {
      const fullPath = path.join(projectPath, configFile);
      if (await this._fileExists(fullPath)) {
        configs[path.basename(configFile)] = fullPath;
      }
    }
    
    return configs;
  }

  /**
   * 确定项目类型
   */
  _determineProjectType(pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (deps['react']) return 'react-app';
    if (deps['vue']) return 'vue-app';
    if (deps['@angular/core']) return 'angular-app';
    if (deps['express']) return 'node-api';
    if (deps['next']) return 'nextjs-app';
    if (pkg.bin) return 'cli-tool';
    
    return 'node-app';
  }

  /**
   * 检测框架
   */
  _detectFrameworks(pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const frameworks = [];
    
    // 前端框架
    if (deps['react']) frameworks.push('react');
    if (deps['vue']) frameworks.push('vue');
    if (deps['@angular/core']) frameworks.push('angular');
    
    // 后端框架
    if (deps['express']) frameworks.push('express');
    if (deps['koa']) frameworks.push('koa');
    if (deps['fastify']) frameworks.push('fastify');
    
    // 构建工具
    if (deps['webpack']) frameworks.push('webpack');
    if (deps['vite']) frameworks.push('vite');
    
    return frameworks;
  }

  /**
   * 检测构建工具
   */
  async _detectBuildTools(projectPath, configFiles) {
    const tools = [];
    
    if (configFiles['webpack.config.js']) tools.push('webpack');
    if (await this._fileExists(path.join(projectPath, 'vite.config.js'))) tools.push('vite');
    if (await this._fileExists(path.join(projectPath, 'rollup.config.js'))) tools.push('rollup');
    if (await this._fileExists(path.join(projectPath, 'gulpfile.js'))) tools.push('gulp');
    
    return tools;
  }

  /**
   * 评估项目规模
   */
  async _assessProjectSize(projectPath) {
    try {
      const result = execSync(`find "${projectPath}" -type f | wc -l`, { 
        encoding: 'utf8',
        timeout: 5000
      });
      const fileCount = parseInt(result.trim());
      
      if (fileCount > 1000) return 'large';
      if (fileCount > 100) return 'medium';
      return 'small';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 评估复杂度
   */
  _assessComplexity(features) {
    let score = 0;
    
    score += features.languages.length * 10;
    score += features.frameworks.length * 15;
    score += features.tools.length * 5;
    
    if (features.size === 'large') score += 30;
    else if (features.size === 'medium') score += 15;
    
    if (score > 50) return 'high';
    if (score > 25) return 'medium';
    return 'low';
  }

  /**
   * 检查过时依赖
   */
  async _checkOutdatedDependencies(projectPath) {
    try {
      const result = execSync('npm outdated --json', {
        cwd: projectPath,
        encoding: 'utf8',
        timeout: 10000
      });
      return Object.keys(JSON.parse(result));
    } catch {
      return [];
    }
  }

  /**
   * 递归遍历目录
   */
  async _walkDirectory(dirPath, structure, maxDepth, currentDepth = 0) {
    if (currentDepth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          structure.totalDirs++;
          await this._walkDirectory(fullPath, structure, maxDepth, currentDepth + 1);
        } else {
          structure.totalFiles++;
          const ext = path.extname(entry.name).toLowerCase();
          structure.fileTypes[ext] = (structure.fileTypes[ext] || 0) + 1;
        }
      }
    } catch (error) {
      // 忽略无法访问的目录
    }
  }

  /**
   * 识别关键目录
   */
  async _identifyKeyDirectories(projectPath) {
    const keyDirs = [];
    const commonDirs = ['src', 'lib', 'test', 'tests', 'spec', 'docs', 'public', 'dist', 'build'];
    
    for (const dir of commonDirs) {
      const fullPath = path.join(projectPath, dir);
      if (await this._fileExists(fullPath) && fs.statSync(fullPath).isDirectory()) {
        keyDirs.push(dir);
      }
    }
    
    return keyDirs;
  }

  /**
   * 获取最近更改
   */
  async _getRecentChanges(projectPath) {
    try {
      const result = execSync('git log --pretty=format:"%h|%an|%ad|%s" --date=short -10', {
        cwd: projectPath,
        encoding: 'utf8',
        timeout: 5000
      });
      
      return result.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [hash, author, date, message] = line.split('|');
          return { hash, author, date, message };
        });
    } catch {
      return [];
    }
  }

  /**
   * 分析命名约定
   */
  async _analyzeNamingConventions(projectPath) {
    // 简化实现 - 实际项目中需要更复杂的分析
    return ['camelCase', 'kebab-case'];
  }

  /**
   * 分析测试实践
   */
  async _analyzeTestingPractices(projectPath) {
    const practices = [];
    
    if (await this._fileExists(path.join(projectPath, 'jest.config.js'))) {
      practices.push('jest');
    }
    
    if (await this._fileExists(path.join(projectPath, '.mocharc.js'))) {
      practices.push('mocha');
    }
    
    return practices;
  }

  /**
   * 分析文档情况
   */
  async _analyzeDocumentation(projectPath) {
    const docs = [];
    
    if (await this._fileExists(path.join(projectPath, 'README.md'))) {
      docs.push('readme');
    }
    
    if (await this._fileExists(path.join(projectPath, 'docs'))) {
      docs.push('documentation-directory');
    }
    
    return docs;
  }

  /**
   * 获取相关环境变量
   */
  _getRelevantEnvVars() {
    const relevantVars = [
      'NODE_ENV',
      'PATH',
      'HOME',
      'USER',
      'SHELL',
      'EDITOR',
      'LANG'
    ];
    
    const vars = {};
    for (const varName of relevantVars) {
      if (process.env[varName]) {
        vars[varName] = process.env[varName];
      }
    }
    
    return vars;
  }

  /**
   * 获取系统信息
   */
  async _getSystemInfo() {
    try {
      const info = {
        arch: process.arch,
        cpus: require('os').cpus().length,
        totalmem: Math.round(require('os').totalmem() / (1024 * 1024 * 1024)) + 'GB'
      };
      
      if (process.platform === 'darwin') {
        info.distribution = 'macOS';
      } else if (process.platform === 'linux') {
        info.distribution = 'Linux';
      } else if (process.platform === 'win32') {
        info.distribution = 'Windows';
      }
      
      return info;
    } catch {
      return {};
    }
  }

  /**
   * 检查文件是否存在
   */
  async _fileExists(filePath) {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取上下文摘要用于AI对话
   */
  getContextSummary(context) {
    return {
      projectType: context.features.projectType,
      languages: context.features.languages,
      frameworks: context.features.frameworks,
      size: context.features.size,
      complexity: context.features.complexity,
      keyDirectories: context.fileStructure.keyDirectories,
      recentActivity: context.fileStructure.recentChanges.slice(0, 3)
    };
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.contextCache.clear();
  }
}

module.exports = new EnvironmentContext();
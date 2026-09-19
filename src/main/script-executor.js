// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { evaluateCommand } = require('./command-policy')

/**
 * 脚本子进程执行器
 *
 * 职责：
 * 1. 在独立子进程中执行 AI 生成的脚本（不影响主终端工作目录）
 * 2. 捕获 stdout/stderr 日志，供 AI 错误重试使用
 * 3. 双层安全判断：硬规则（security-analyzer）+ AI 标记（isDangerous）
 * 4. 危险脚本暂停等待用户授权，安全脚本自动执行
 */

const DEFAULT_TIMEOUT = 60000  // 60 秒超时
const MAX_LOG_LENGTH = 8000    // 日志最大长度（传给 AI 重试时截断）

// ========== 用户 Shell 环境变量缓存 ==========
// Electron 主进程的 process.env 是启动时的快照，不包含用户后来通过
// `source ~/.zshrc` 添加的变量（如 CODE_PRIVATE_TOKEN）。
// 通过 `zsh -ilc env` 获取用户完整的 shell 环境，缓存 10 分钟。
let _userEnvCache = null
let _userEnvCacheTime = 0
const ENV_CACHE_TTL = 10 * 60 * 1000  // 10 分钟

/**
 * 获取用户 shell 的环境变量
 * 直接解析 ~/.zshrc / ~/.zprofile / ~/.bashrc / ~/.bash_profile 中的 export 语句
 * 不启动 shell 进程，避免超时问题
 * @returns {object} 环境变量键值对（合并 process.env）
 */
function getUserShellEnv() {
  const now = Date.now()
  if (_userEnvCache && (now - _userEnvCacheTime) < ENV_CACHE_TTL) {
    return _userEnvCache
  }

  const home = os.homedir()
  const rcFiles = [
    path.join(home, '.zprofile'),
    path.join(home, '.zshrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.bashrc'),
  ]

  const envMap = {}
  let totalParsed = 0

  for (const rcFile of rcFiles) {
    try {
      if (!fs.existsSync(rcFile)) continue
      const content = fs.readFileSync(rcFile, 'utf8')

      // 匹配 export KEY=VALUE 或 export KEY='VALUE' 或 export KEY="VALUE"
      const exportRegex = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm
      let match
      while ((match = exportRegex.exec(content)) !== null) {
        const key = match[1]
        let value = match[2].trim()

        // 去除引号包裹
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
          value = value.slice(1, -1)
        }

        // 简单变量替换：$HOME → 实际值，$KEY → 已解析的值
        value = value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName) => {
          return envMap[varName] || process.env[varName] || ''
        })

        envMap[key] = value
        totalParsed++
      }
    } catch (err) {
      console.warn(`[ScriptExecutor] 解析 ${rcFile} 失败:`, err.message)
    }
  }

  if (totalParsed > 0) {
    _userEnvCache = envMap
    _userEnvCacheTime = now
    console.log(`[ScriptExecutor] 从 rc 文件解析到 ${totalParsed} 个 export 变量`)
  }

  return envMap
}

/**
 * 分析脚本安全性（双层判断）
 *
 * 第一层：security-analyzer 硬规则扫描脚本内容
 * 第二层：AI 在 SCRIPT_BLOCK JSON 中标记的 isDangerous 字段
 *
 * 任一层判定为危险 → 需要用户授权
 *
 * @param {string} scriptContent - 脚本内容
 * @param {string} lang - 脚本语言
 * @param {boolean} aiDangerFlag - AI 标记的 isDangerous
 * @param {string} aiDangerReason - AI 标记的危险原因
 * @returns {{ needsAuth: boolean, riskLevel: string, reason: string, details: object }}
 */
function analyzeScriptSafety(scriptContent, lang, aiDangerFlag = false, aiDangerReason = '') {
  // 第一层：硬规则扫描
  const policy = evaluateCommand(scriptContent, { lang, aiDangerFlag, aiDangerReason })
  const hardAnalysis = policy.analysis

  return {
    needsAuth: policy.requiresConfirmation,
    riskLevel: policy.riskLevel,
    reason: policy.reason,
    details: {
      hardAnalysis: {
        safe: hardAnalysis.safe,
        riskScore: hardAnalysis.riskScore,
        riskLevel: hardAnalysis.riskLevel,
        patterns: hardAnalysis.patterns,
        suggestions: hardAnalysis.suggestions
      },
      aiFlag: {
        isDangerous: policy.aiFlag.isDangerous,
        reason: aiDangerReason
      }
    }
  }
}

/**
 * 在子进程中执行脚本
 *
 * @param {object} options
 * @param {string} options.scriptContent - 脚本内容
 * @param {string} options.scriptFile - 脚本文件路径（已写入磁盘）
 * @param {string} options.lang - 脚本语言（python/sh/node/bash）
 * @param {string} options.cwd - 工作目录（默认为脚本所在目录）
 * @param {number} options.timeout - 超时时间（毫秒）
 * @param {function} options.onOutput - 实时输出回调 (type: 'stdout'|'stderr', data: string)
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, exitCode: number, error?: string }>}
 */
/**
 * 从 stderr 中提取缺失的 npm 模块名
 * 支持 Node.js 的 MODULE_NOT_FOUND 错误格式
 */
function extractMissingModules(stderr) {
  const modules = new Set()
  // Cannot find module 'xxx'
  const pattern = /Cannot find module '([^'./][^']*)'/g
  let match
  while ((match = pattern.exec(stderr)) !== null) {
    const moduleName = match[1]
    // 过滤掉相对路径和内置模块
    if (!moduleName.startsWith('.') && !moduleName.startsWith('/')) {
      // 处理 scoped package：@scope/pkg → @scope/pkg，普通包取第一段
      const pkgName = moduleName.startsWith('@')
        ? moduleName.split('/').slice(0, 2).join('/')
        : moduleName.split('/')[0]
      modules.add(pkgName)
    }
  }
  return [...modules]
}

/**
 * 在指定目录安装 npm 模块（临时沙箱安装）
 */
function npmInstallModules(modules, installDir, env) {
  return new Promise((resolve) => {
    if (modules.length === 0) return resolve(false)
    console.log(`[ScriptExecutor] 自动安装缺失模块: ${modules.join(', ')} (dir: ${installDir})`)
    const child = spawn('npm', ['install', '--prefer-offline', '--no-save', ...modules], {
      cwd: installDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[ScriptExecutor] 模块安装成功: ${modules.join(', ')}`)
        resolve(true)
      } else {
        console.warn(`[ScriptExecutor] 模块安装失败 (code ${code}):`, stderr.slice(-500))
        resolve(false)
      }
    })
    child.on('error', (err) => {
      console.warn(`[ScriptExecutor] npm install 启动失败:`, err.message)
      resolve(false)
    })
  })
}

function executeScript({ scriptFile, lang, cwd, timeout = DEFAULT_TIMEOUT, onOutput }) {
  return new Promise((resolve) => {
    const runnerMap = { py: 'python3', python: 'python3', js: 'node', node: 'node', rb: 'ruby', sh: 'bash', bash: 'bash' }
    const runner = runnerMap[lang] || 'bash'

    // 工作目录：优先使用指定的 cwd，否则用脚本所在目录
    const workingDir = cwd || path.dirname(scriptFile)

    // 获取用户 shell 的完整环境变量（含 ~/.zshrc 中的 export）
    const userEnv = getUserShellEnv()
    // 合并：用户 shell 环境 > Electron 主进程环境（用户 shell 优先）
    const mergedEnv = { ...process.env, ...userEnv }

    // 脚本目录（用于 npm install）
    const scriptDir = path.dirname(scriptFile)

    function runOnce(onClose) {
      console.log(`[ScriptExecutor] 启动子进程: ${runner} "${scriptFile}" (cwd: ${workingDir})`)

      const child = spawn(runner, [scriptFile], {
        cwd: workingDir,
        timeout,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let killed = false

      child.stdout.on('data', (data) => {
        const text = data.toString()
        stdout += text
        if (onOutput) onOutput('stdout', text)
      })

      child.stderr.on('data', (data) => {
        const text = data.toString()
        stderr += text
        if (onOutput) onOutput('stderr', text)
      })

      const timer = setTimeout(() => {
        killed = true
        child.kill('SIGTERM')
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 3000)
      }, timeout)

      child.on('close', (code) => {
        clearTimeout(timer)
        onClose({ code, stdout, stderr, killed })
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          success: false,
          stdout: truncateLog(stdout),
          stderr: truncateLog(stderr),
          exitCode: -1,
          error: `子进程启动失败: ${err.message}`
        })
      })
    }

    // 第一次执行
    runOnce(async ({ code, stdout, stderr, killed }) => {
      if (killed) {
        return resolve({
          success: false,
          stdout: truncateLog(stdout),
          stderr: truncateLog(stderr),
          exitCode: code ?? -1,
          error: `脚本执行超时 (>${timeout / 1000}s)，已终止`
        })
      }

      const success = code === 0
      if (success) {
        return resolve({
          success: true,
          stdout: truncateLog(stdout),
          stderr: truncateLog(stderr),
          exitCode: code ?? 0
        })
      }

      // 检测是否是 MODULE_NOT_FOUND，尝试自动安装后重试（仅 node 脚本）
      const isNodeScript = lang === 'node' || lang === 'js'
      const missingModules = isNodeScript ? extractMissingModules(stderr) : []

      if (missingModules.length > 0) {
        if (onOutput) onOutput('stdout', `\n[自动安装] 检测到缺失模块: ${missingModules.join(', ')}，正在安装...\n`)
        const installed = await npmInstallModules(missingModules, scriptDir, mergedEnv)

        if (installed) {
          if (onOutput) onOutput('stdout', `[自动安装] 安装完成，重新执行脚本...\n`)
          // 重试一次
          runOnce(({ code: code2, stdout: stdout2, stderr: stderr2, killed: killed2 }) => {
            if (killed2) {
              return resolve({
                success: false,
                stdout: truncateLog(stdout + stdout2),
                stderr: truncateLog(stderr + stderr2),
                exitCode: code2 ?? -1,
                error: `脚本执行超时 (>${timeout / 1000}s)，已终止`
              })
            }
            const success2 = code2 === 0
            resolve({
              success: success2,
              stdout: truncateLog(stdout + stdout2),
              stderr: truncateLog(stderr + stderr2),
              exitCode: code2 ?? -1,
              error: success2 ? undefined : `脚本退出码: ${code2}\n${truncateLog(stderr2)}`
            })
          })
          return
        }
      }

      // 无法自动修复，返回原始错误
      resolve({
        success: false,
        stdout: truncateLog(stdout),
        stderr: truncateLog(stderr),
        exitCode: code ?? -1,
        error: `脚本退出码: ${code}\n${truncateLog(stderr)}`
      })
    })
  })
}

/**
 * 截断日志到最大长度，保留尾部（错误信息通常在末尾）
 */
function truncateLog(log) {
  if (!log || log.length <= MAX_LOG_LENGTH) return log
  return '...(已截断前部)...\n' + log.slice(-MAX_LOG_LENGTH)
}

/**
 * 构建错误重试的上下文信息
 * 将子进程的 stdout/stderr 格式化为 AI 可理解的错误报告
 *
 * @param {object} execResult - executeScript 的返回值
 * @param {string} scriptContent - 原始脚本内容
 * @param {string} lang - 脚本语言
 * @returns {string} 格式化的错误报告
 */
function buildErrorReport(execResult, scriptContent, lang) {
  const lines = [
    '## 脚本执行失败 — 自主诊断与修复',
    '',
    `**退出码**: ${execResult.exitCode}`,
    `**错误信息**: ${execResult.error || '未知错误'}`,
  ]

  if (execResult.stderr) {
    lines.push('', '**stderr 输出**:', '```', execResult.stderr.slice(-2000), '```')
  }

  if (execResult.stdout) {
    lines.push('', '**stdout 输出（执行到失败前的输出）**:', '```', execResult.stdout.slice(-2000), '```')
  }

  lines.push(
    '',
    '**原始脚本**:',
    `\`\`\`${lang}`,
    scriptContent,
    '```',
    '',
    '请按以下步骤自主修复：',
    '1. **分析错误根因**：仔细阅读 stderr/stdout，定位具体的错误行和原因',
    '2. **检查常见问题**：依赖缺失？路径错误？权限不足？语法错误？变量未定义？',
    '3. **生成修复方案**：使用 SCRIPT_BLOCK 格式返回修复后的完整脚本',
    '4. **如果不确定原因**：可以先生成一个诊断脚本（如检查文件是否存在、依赖是否安装），收集更多信息后再修复',
    '',
  )

  return lines.join('\n')
}

module.exports = {
  analyzeScriptSafety,
  executeScript,
  buildErrorReport,
  MAX_LOG_LENGTH,
  DEFAULT_TIMEOUT
}

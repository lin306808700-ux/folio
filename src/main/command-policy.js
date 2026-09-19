// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const securityAnalyzer = require('./security-analyzer')

const INVARIANT_PATTERNS = [
  { pattern: /(^|[;&|]\s*)sudo\b/i, riskLevel: 'high', reason: '命令请求提升系统权限' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, riskLevel: 'critical', reason: '命令可能关闭或重启系统' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, riskLevel: 'critical', reason: '命令包含 fork bomb' },
]

function resolveWithinWorkspace(workspace, targetPath) {
  const workspacePath = path.resolve(workspace)
  const expanded = targetPath.startsWith('~')
    ? targetPath.replace(/^~(?=$|\/)/, os.homedir())
    : targetPath
  const resolved = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspacePath, expanded)

  if (resolved !== workspacePath && !resolved.startsWith(workspacePath + path.sep)) {
    throw new Error(`路径超出工作区范围: ${resolved}`)
  }

  let existingPath = resolved
  while (!fs.existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) break
    existingPath = parent
  }

  const realWorkspace = fs.realpathSync(workspacePath)
  const realExisting = fs.realpathSync(existingPath)
  if (realExisting !== realWorkspace && !realExisting.startsWith(realWorkspace + path.sep)) {
    throw new Error(`路径通过符号链接超出工作区范围: ${resolved}`)
  }
  return resolved
}

function findWorkspaceEscape(command, workspace) {
  if (!workspace) return null
  const allowedDevices = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr'])
  const pathPattern = /(?<![A-Za-z0-9:._-])((?:~\/|\.\.\/|\/)[^\s"'|;&<>)]*)/g
  let match

  while ((match = pathPattern.exec(command || '')) !== null) {
    const candidate = match[1].replace(/[,:]+$/, '')
    if (allowedDevices.has(candidate)) continue
    try {
      resolveWithinWorkspace(workspace, candidate)
    } catch (error) {
      return { path: candidate, reason: error.message }
    }
  }
  return null
}

function evaluateCommand(command, options = {}) {
  const analysis = securityAnalyzer.analyzeScriptContent(command || '', options.lang || 'bash')
  const workspaceEscape = findWorkspaceEscape(command, options.workspace)
  const aiMarkedDangerous = !!options.aiDangerFlag
  const invariantRisk = INVARIANT_PATTERNS.find(item => item.pattern.test(command || '')) || null
  const requiresConfirmation = !analysis.safe || !!workspaceEscape || aiMarkedDangerous || !!invariantRisk
  const reasons = []

  if (!analysis.safe) reasons.push(`安全规则检测: ${analysis.message}`)
  if (invariantRisk) reasons.push(`底线安全规则: ${invariantRisk.reason}`)
  if (workspaceEscape) reasons.push(`命令引用工作区外路径 ${workspaceEscape.path}: ${workspaceEscape.reason}`)
  if (aiMarkedDangerous) reasons.push(`AI 判断: ${options.aiDangerReason || '命令包含潜在危险操作'}`)

  let riskLevel = analysis.riskLevel || 'none'
  if (invariantRisk) riskLevel = invariantRisk.riskLevel
  if ((workspaceEscape || aiMarkedDangerous) && ['none', 'low'].includes(riskLevel)) riskLevel = 'medium'

  return {
    safe: !requiresConfirmation,
    requiresConfirmation,
    riskLevel,
    reason: reasons.join('; ') || '安全',
    analysis,
    workspaceEscape,
    invariantRisk,
    aiFlag: { isDangerous: aiMarkedDangerous, reason: options.aiDangerReason || '' },
  }
}

module.exports = { evaluateCommand, findWorkspaceEscape, resolveWithinWorkspace }

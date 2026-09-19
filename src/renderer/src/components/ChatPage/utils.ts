// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

// AI 调用逻辑
export async function callAI(
  userInput: string,
  sessionId: string,
  scriptTemplate?: any
): Promise<{ content: string; webSearched: boolean; isTask?: boolean; isScript?: boolean; isSearchReplace?: boolean }> {
  if (!window.electronAPI) throw new Error('Electron API 不可用')

  const result = await window.electronAPI.ai.call({
    userInput,
    sessionId,
    scriptTemplate
  })

  if (!result.success) throw new Error(result.error || 'AI 服务调用失败')

  return {
    content: result.content || '',
    webSearched: result.webSearched || false,
    isTask: result.isTask,
    isScript: result.isScript,
    isSearchReplace: result.isSearchReplace
  }
}

// 流式 AI 调用 — 发起请求，数据通过 IPC 事件推送
export function callAIStream(
  userInput: string,
  sessionId: string,
  scriptTemplate?: any,
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  images?: Array<{ dataUrl: string; mimeType: string; name?: string }>
): void {
  if (!window.electronAPI) throw new Error('Electron API 不可用')

  window.electronAPI.ai.stream({
    userInput,
    sessionId,
    scriptTemplate,
    messages,
    images
  })
}

// 检测是否为命令
export function detectCommand(text: string): boolean {
  const trimmed = text.trim()

  // 空文本或多行文本 → 不是命令（命令通常单行）
  if (!trimmed || trimmed.includes('\n')) return false

  // 包含中文字符的文本不太可能是纯命令
  const hasChinese = /[\u4e00-\u9fff]/.test(trimmed)
  if (hasChinese) return false

  // 以标点/表情开头的内容 → 不是命令
  if (/^[❌✅💾🤔📂🎯📜⚠️!！?？]/.test(trimmed)) return false

  // 常见非命令英文短语排除（AI 可能返回的简短回复）
  const nonCommandPhrases = /^(ok|okay|done|yes|no|sure|thanks|thank you|hello|hi|hey|good|fine|great|got it|understood|right|correct|exactly|indeed|absolutely|sorry|nope|yep|alright)\b/i
  if (nonCommandPhrases.test(trimmed)) return false

  // 已知命令开头 → 命令
  const knownCommands = /^(ls|cd|pwd|cat|grep|find|ps|kill|npm|yarn|pnpm|tnpm|git|docker|curl|wget|echo|mkdir|rm|cp|mv|chmod|chown|tail|head|less|more|touch|vim|nano|which|whereis|man|top|htop|free|df|du|netstat|ss|ping|traceroute|nslookup|ssh|scp|rsync|tar|zip|unzip|brew|apt|yum|systemctl|service|node|python|python3|ruby|java|make|cmake|open|mdfind|lsof|pkill|killall|sudo|source|export|alias|xargs|sed|awk|sort|uniq|wc|tee|nohup|crontab|chsh)\b/i
  if (knownCommands.test(trimmed)) return true

  // 命令连接符 → 命令
  if (/&&|\|\||;\s*\w/.test(trimmed)) return true

  // $ 前缀 → 命令
  if (/^\$\s+/.test(trimmed)) return true

  // 管道操作 → 命令
  if (/\w\s*\|\s*\w/.test(trimmed)) return true

  // 以路径开头且看起来像命令调用（如 ./script.sh、~/bin/tool）
  if (/^[.~\/][\w\-\/]+\.(sh|py|js|rb|pl)\b/.test(trimmed)) return true

  return false
}

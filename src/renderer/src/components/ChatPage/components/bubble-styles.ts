import type { Message } from '../types'

/** 根据消息类型和角色返回气泡容器的 className（深色意识体风格） */
export function getBubbleClassName(msg: Message): string {
  const content = typeof msg.content === 'string' ? msg.content : ''

  if (msg.role === 'user') {
    // 明亮：indigo-50 实底 + 深色字；暗黑：半透明玻璃底 + 亮白字（意识体风格）
    return 'px-6 py-4 bg-bubble-user backdrop-blur-sm text-bubble-user-text border border-border-subtle/60 rounded-tr-none dark:bg-white/[0.08] dark:text-white/90 dark:border-white/10'
  }

  // assistant 消息按 type 映射（语义色保持彩色不随主题变，仅文字/底透明度适配）
  const styleMap: Record<string, string> = {
    command: 'px-6 py-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-200 border border-emerald-400/20 font-mono text-sm rounded-tl-none',
    command_options: 'px-6 py-4 bg-violet-500/10 text-text-secondary border border-violet-400/20 rounded-tl-none',
    script: 'px-6 py-4 bg-violet-500/10 text-violet-600 dark:text-violet-200 border border-violet-400/20 rounded-tl-none',
    error: 'px-6 py-4 bg-red-500/10 text-red-500 dark:text-red-300 border border-red-400/20 rounded-tl-none',
  }

  if (msg.type && styleMap[msg.type]) {
    return styleMap[msg.type]
  }

  // 特殊内容匹配
  if (content.startsWith('💾 已记入记忆中心')) {
    return 'px-6 py-4 bg-purple-500/10 text-purple-600 dark:text-purple-200 rounded-tl-none border border-purple-400/20 text-sm'
  }

  if (msg.webSearched) {
    return 'px-6 py-4 bg-cyan-500/10 text-text-secondary rounded-tl-none border border-cyan-400/20'
  }

  // 默认 assistant 样式 — 无底色，文字直接浮现（意识体独白风格）
  return 'px-6 py-4 text-text-secondary rounded-tl-none'
}

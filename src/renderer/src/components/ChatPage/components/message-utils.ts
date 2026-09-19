/**
 * 预处理 SCRIPT_BLOCK 内容：将裸露的 JSON 文本包裹为 Markdown 代码块，
 * 使流式输出过程中和解析失败时都能被 MarkdownRenderer 格式化渲染。
 *
 * 流式输出时 JSON 可能还没闭合（没有 `}`），此时也要展示已有内容，
 * 让用户能看到脚本正在生成的过程，而不是只显示一行裸文本。
 */
export function preprocessScriptBlock(text: string): string {
  // 先尝试匹配完整的 {...}
  let match = text.match(/SCRIPT_BLOCK:\s*\n?\s*(\{[\s\S]*\})/i)

  // 如果没匹配到完整 JSON，尝试匹配流式过程中不完整的 JSON（有 { 但还没有 }）
  if (!match || match.index === undefined) {
    match = text.match(/SCRIPT_BLOCK:\s*\n?\s*(\{[\s\S]*)/i)
  }

  if (!match || match.index === undefined) return text

  const beforeBlock = text.slice(0, match.index).trim()
  const jsonPart = match[1]

  // 尝试从 JSON 中提取 content 字段的值，直接展示脚本内容
  let displayContent: string | null = null
  let lang = 'sh'

  // 提取 lang 字段
  const langMatch = jsonPart.match(/"lang"\s*:\s*"([^"]*)"/)
  if (langMatch) lang = langMatch[1]

  // 提取 description 字段
  const descMatch = jsonPart.match(/"description"\s*:\s*"([^"]*)"/)
  const description = descMatch ? descMatch[1] : ''

  // 提取 content 字段的值（可能不完整，流式过程中还在拼接）
  const contentMatch = jsonPart.match(/"content"\s*:\s*"([\s\S]*)/)
  if (contentMatch) {
    let rawContent = contentMatch[1]
    // 去掉尾部可能的闭合引号和 JSON 结构
    rawContent = rawContent.replace(/"\s*\}\s*$/, '')
    // 将转义的换行符还原为真实换行
    displayContent = rawContent.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  }

  const parts: string[] = []
  if (beforeBlock) parts.push(beforeBlock)

  if (displayContent !== null) {
    // 有 content 字段时，直接展示脚本内容（更直观）
    const title = description ? `📜 **脚本生成中...** _${description}_` : '📜 **脚本生成中...**'
    parts.push(title)
    parts.push(`\`\`\`${lang}\n${displayContent}\n\`\`\``)
  } else {
    // 还没到 content 字段，展示原始 JSON
    let formatted: string
    try {
      formatted = JSON.stringify(JSON.parse(jsonPart), null, 2)
    } catch {
      formatted = jsonPart
    }
    parts.push('📜 **脚本生成中...**')
    parts.push(`\`\`\`json\n${formatted}\n\`\`\``)
  }

  return parts.join('\n\n')
}

/**
 * 预处理 AI 返回的非标准代码块：
 * AI 有时会返回裸的语言标记（如 javascript）后直接跟代码，没有反引号包裹。
 * 此函数将其转换为标准 Markdown 代码块格式。
 */
export function preprocessBareCodeBlocks(text: string): string {
  // 匹配模式：行首是语言名称，后面跟着多行代码
  const commonLangs = [
    'javascript', 'js', 'typescript', 'ts', 'python', 'py', 'bash', 'sh', 'shell',
    'zsh', 'java', 'c', 'cpp', 'csharp', 'cs', 'go', 'rust', 'ruby', 'php',
    'swift', 'kotlin', 'scala', 'sql', 'html', 'css', 'scss', 'less', 'jsx', 'tsx',
    'json', 'yaml', 'yml', 'xml', 'markdown', 'md', 'dockerfile', 'makefile',
    'powershell', 'ps1', 'lua', 'r', 'matlab', 'perl', 'dart', 'groovy'
  ]
  
  const langPattern = commonLangs.join('|')
  // 匹配：独占一行的语言标记 + 后续所有非空行（直到连续两个换行或文件结束）
  const regex = new RegExp(
    `^(${langPattern})\\s*\\n([\\s\\S]*?)(?=\\n\\n|\\n---|\\n\\*\\*\\*|$)`,
    'gm'
  )
  
  return text.replace(regex, (match, lang, code) => {
    // 去掉代码首尾空白
    const trimmedCode = code.trim()
    // 如果代码太短（< 10 字符），可能不是真正的代码块，跳过
    if (trimmedCode.length < 10) return match
    // 如果代码中包含大量中文（> 40%），可能是自然语言，跳过
    const chineseChars = (trimmedCode.match(/[\u4e00-\u9fff]/g) || []).length
    if (chineseChars > trimmedCode.length * 0.4) return match
    
    return `\`\`\`${lang}\n${trimmedCode}\n\`\`\``
  })
}

/** 判断文本是否看起来像一条可执行的终端命令 */
export function looksLikeCommand(text: string): boolean {
  const trimmed = text.trim()
  // 多行或过长的文本不是单条命令
  if (trimmed.includes('\n') || trimmed.length > 300) return false
  // 空文本
  if (!trimmed) return false
  // 以 emoji / 状态前缀开头的是状态消息，不是命令
  if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2700-\u27BF]/u.test(trimmed)) return false
  // 看起来像自然语言句子（以句号/问号/感叹号结尾）
  if (/[。？！?!]$/.test(trimmed)) return false
  // 中文字符占比超过 30%，大概率是自然语言而非命令
  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseChars > trimmed.length * 0.3) return false
  // 以路径开头（./ ../ / ~/）直接算命令
  if (/^[.~]?\//.test(trimmed)) return true
  // 第一个 token 是合法的命令名（字母/数字/连字符/下划线/点 组成）
  const firstToken = trimmed.split(/\s+/)[0]
  if (/^[a-zA-Z_][a-zA-Z0-9_.\-]*$/.test(firstToken)) return true
  return false
}

/** 从文本中提取所有命令行 */
export function extractCommandsFromText(text: string): Array<{ command: string; line: number }> {
  const commands: Array<{ command: string; line: number }> = []
  const lines = text.split('\n')

  // 常见命令模式
  const commandPatterns = [
    // 以路径开头的命令（如 /Users/xxx, ./xxx, ~/xxx）
    /^([.~]?\/[^\s]+(?:\s+[^\s]+)*)$/,
    // 以常见命令名开头的命令（如 git, npm, cd, qoder, codeWiz 等）
    /^(git|npm|cd|ls|pwd|cat|echo|rm|cp|mv|mkdir|grep|find|curl|wget|python|node|java|mvn|gradle|docker|kubectl|terraform|ansible|brew|apt|yum|dnf|pacman|qoder|codeWiz|code|vim|nano|emacs|ssh|scp|rsync|tar|zip|unzip|chmod|chown|ln|df|du|free|top|htop|ps|kill|nohup|screen|tmux|jq|yq|awk|sed|sort|uniq|head|tail|xargs|watch|bc|expr|date|cal|uname|whoami|id|env|export|source|alias|history|clear|exit|man|help)(?:\s+[^\s]+)*$/,
    // 以字母开头的通用命令（如 my-script, build.sh 等）
    /^([a-zA-Z_][a-zA-Z0-9_.\-]*(?:\.[a-zA-Z0-9_\-]+)?(?:\s+[^\s]+)*)$/
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // 跳过看起来像自然语言的行
    if (line.startsWith('第一步') || line.startsWith('第二步') || line.startsWith('第三步') ||
        line.startsWith('Step') || line.startsWith('步骤') ||
        line.startsWith('说明') || line.startsWith('注意') ||
        line.startsWith('已执行') || line.startsWith('继续')) {
      continue
    }

    // 跳过以 emoji 开头的行
    if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2700-\u27BF]/u.test(line)) {
      continue
    }

    // 跳过看起来像标题的行（以 # 开头）
    if (line.startsWith('#')) {
      continue
    }

    // 检查是否匹配命令模式
    for (const pattern of commandPatterns) {
      if (pattern.test(line)) {
        // 进一步检查：中文字符占比不应过高
        const chineseChars = (line.match(/[\u4e00-\u9fff]/g) || []).length
        if (chineseChars <= line.length * 0.3) {
          commands.push({ command: line, line: i + 1 })
          break
        }
      }
    }
  }

  return commands
}

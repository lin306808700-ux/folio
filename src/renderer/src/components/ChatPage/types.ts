export interface CommandOption {
  label: string
  cmd: string
}

export interface TaskStep {
  id: number
  description: string
  type?: string
  tool?: string
  method?: string
  status: 'pending' | 'running' | 'completed' | 'error' | 'failed'
  params?: {
    command?: string
    path?: string
    url?: string
    [key: string]: any
  }
  dependsOn?: Array<number | { stepId: number; type?: string }>
  maxRetries?: number
  output?: string
  result?: {
    success?: boolean
    data?: any
    error?: string
    skipped?: boolean
    reason?: string
  }
}

export interface TaskState {
  taskId?: string
  steps: TaskStep[]
  currentStep: number
  totalSteps: number
  status: 'idle' | 'planning' | 'running' | 'paused' | 'completed' | 'error'
  pendingConfirm?: {
    step: TaskStep
    preview: any
  }
  pauseReason?: 'manual' | 'error' | 'confirm' | 'max_retries'
  pauseError?: string
  canRetry?: boolean
  retryCount?: number
  maxRetries?: number
  retryStrategy?: string
}

export interface TaskProgressData {
  taskId: string
  steps: TaskStep[]
  currentStep: number
  totalSteps: number
  status: 'pending' | 'running' | 'completed' | 'error' | 'paused'
  pauseReason?: 'manual' | 'error' | 'confirm'
  pauseError?: string
  canRetry?: boolean
  retryCount?: number
  maxRetries?: number
  retryStrategy?: string
}

// 统一任务数据接口 - 合并规划和执行阶段
export interface UnifiedTaskData {
  taskId: string
  steps: TaskStep[]
  currentStep: number
  totalSteps: number
  status: 'planning' | 'executing' | 'paused' | 'completed' | 'error'
  pauseReason?: 'manual' | 'error' | 'confirm'
  pauseError?: string
  canRetry?: boolean
}

export interface SearchReplaceChangeDetail {
  search: string
  replace: string
  status: 'applied' | 'failed'
}

export interface SearchReplaceChange {
  file: string
  filename: string
  changesApplied: number
  changesTotal: number
  changes?: SearchReplaceChangeDetail[]
}

export interface SearchReplaceData {
  fileChanges: SearchReplaceChange[]
  errors: string[]
  allSuccess: boolean
  summary: string
  runCommand?: string
}

export interface ImageAttachment {
  dataUrl: string
  mimeType: string
  name?: string
}

export interface QuoteContext {
  messageId: string
  role: 'user' | 'assistant'
  selectedText: string
}

export interface ChatRequestEnvelope {
  text: string
  quote?: QuoteContext
  images?: ImageAttachment[]
  skillId?: string
  skillPrompt?: string
}

export type RichFormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'image_upload'
  | 'date'
  | 'date_range'

export interface RichFormField {
  id: string
  label: string
  type: RichFormFieldType
  required?: boolean
  placeholder?: string
  /** select / multi_select / radio 的选项列表 */
  options?: Array<{ label: string; value: string }>
  /** date_range 子字段标签 */
  startLabel?: string
  endLabel?: string
}

export interface RichFormData {
  title: string
  description?: string
  fields: RichFormField[]
  /** 提交后回传给 AI 的 prompt 前缀，默认 "用户填写了表单：" */
  submitPrompt?: string
}

/**
 * 统一产物类型。AI 通过 ARTIFACT: 指令吐出，前端 <ArtifactRenderer> 按 type 分发渲染。
 * M1 直接渲染：html / svg / image / code；chart / form 复用已有组件。
 */
export type ArtifactType =
  | 'html'
  | 'svg'
  | 'image'
  | 'code'
  | 'chart'
  | 'form'
  | 'markdown'

export type ArtifactAction = 'open' | 'download' | 'copy' | 'fullscreen'

export interface Artifact {
  id: string
  type: ArtifactType
  /** 卡片标题 */
  title?: string
  /** html / svg / markdown / code 的源码内容 */
  content?: string
  /** image 的图片 URL / dataURL / 本地路径 */
  src?: string
  /** chart 的表格数据 / form 的 RichFormData / 其他结构化数据 */
  data?: any
  /** code 的语言标识 */
  language?: string
  /** 沙箱渲染高度（px），默认按类型给合理值 */
  height?: number
  /** html 是否走 iframe sandbox 渲染，默认 true（安全） */
  sandbox?: boolean
  /** 默认是否折叠 */
  collapsed?: boolean
  /** 落盘路径，用于"在文件夹中打开" */
  filePath?: string
  /** 卡片操作按钮 */
  actions?: ArtifactAction[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  images?: ImageAttachment[]
  type?: 'text' | 'command' | 'command_options' | 'skill_install' | 'script' | 'search_replace' | 'task_planning' | 'task_plan_confirm' | 'task_progress' | 'task_confirm' | 'task_step_error' | 'browser_screenshot' | 'error' | 'unified_task' | 'muse_transfer' | 'muse_letter' | 'rich_form' | 'artifact'
  skillData?: { url: string; skillName?: string }
  commandOptions?: CommandOption[]
  scriptData?: {
    scriptFile: string
    filename: string
    lang: string
    description: string
    scriptContent: string
    runCommand: string
    isDangerous?: boolean
    dangerReason?: string
    execStatus?: 'pending' | 'executing' | 'completed' | 'failed' | 'needAuth' | 'retrying'
    execResult?: {
      stdout?: string
      stderr?: string
      exitCode?: number
      error?: string
    }
    retryCount?: number
    maxRetries?: number
    snapshot?: {
      snapshotId: string
      timestamp: number
      totalChanges: number
      changes: { modified: string[]; created: string[]; deleted: string[] }
    } | null
  }
  searchReplaceData?: SearchReplaceData
  webSearched?: boolean
  taskState?: TaskState
  taskProgressData?: TaskProgressData
  unifiedTaskData?: UnifiedTaskData
  taskConfirmData?: {
    taskId: string
    message: string
    preview: any
  }
  taskStepErrorData?: {
    taskId: string
    message: string
    error: string
    failedStep: TaskStep
    stepIndex: number
  }
  selfCheckData?: SelfCheckProgressData
  screenshotPath?: string
  timestamp?: number
  retryUserInput?: string
  retryRequest?: ChatRequestEnvelope
  quotedMessage?: {
    messageId: string
    role: 'user' | 'assistant'
    summary: string
  }
  onDelete?: () => void
  isComplex?: boolean
  userInput?: string
  isThinking?: boolean
  letterData?: { letterId: string; title: string; preview: string; priority: string; source: string }
  richFormData?: RichFormData
  artifactData?: Artifact
  // 流式中识别到协议指令时的折叠态：展示「正在生成 XX…」状态条，原文收起可展开
  protocolStreaming?: {
    kind: 'artifact' | 'rich_form' | 'script' | 'command_options' | 'muse_task' | 'search_replace'
    label: string
    draft: string
  }
  /** 上下文标签（当前注入的技能/模板/craft规则） */
  contextChips?: Array<{
    id: string
    type: 'skill' | 'template' | 'craft' | 'pipeline'
    label: string
    detail?: string
  }>
  /** Craft 质量评审结果 */
  craftReview?: {
    available: boolean
    ruleCount: number
    ruleNames: string[]
  }
}

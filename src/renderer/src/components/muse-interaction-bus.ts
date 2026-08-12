/**
 * Muse 交互事件总线 — 轻量发布订阅，连接「用户交互」与「Muse 头像反应」。
 *
 * 避免在组件树里层层传递 prop：输入框聚焦、发送消息等交互发生时，
 * 在交互处 emit 事件；MuseAvatar 内部订阅并做出拟人化反应（转头看输入框 / 点头）。
 */

/** Muse 意识状态 — 与 MuseState 对齐，用于驱动全局氛围海洋场 */
export type MuseAmbientState = 'idle' | 'working' | 'outputting' | 'error' | 'waiting'

export type MuseInteractionEvent =
  /** 用户聚焦输入框，附带输入框元素位置，让 Muse 转头看向它 */
  | { type: 'input_focus'; rect: { x: number; y: number } }
  /** 用户离开输入框，Muse 视线回到默认（跟随鼠标） */
  | { type: 'input_blur' }
  /** 用户发送了消息，Muse 微点头表示"收到了" */
  | { type: 'message_sent' }
  /** 用户正在输入（敲键盘），Muse 意识场泛起细微涟漪 */
  | { type: 'user_typing' }
  /** Muse 意识状态变化，驱动全局海洋场配色与呼吸 */
  | { type: 'state_change'; state: MuseAmbientState }
  /** 用户悬停某触点，附近粒子向此坐标汇聚 */
  | { type: 'touch_hover'; rect: { x: number; y: number } }
  /** 用户按压某触点，从此坐标发射涟漪 */
  | { type: 'touch_press'; rect: { x: number; y: number } }
  /** 用户释放触点，Muse 给出语义回应（低语） */
  | { type: 'touch_release'; whisper?: string }

type Listener = (event: MuseInteractionEvent) => void

const listeners = new Set<Listener>()

export function emitMuseInteraction(event: MuseInteractionEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch {
      // 单个监听器异常不影响其他监听器
    }
  })
}

export function onMuseInteraction(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

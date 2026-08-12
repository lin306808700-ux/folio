import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Send } from 'lucide-react'
import { AmbientBackground, MuseState } from './AmbientBackground'
import { BrowserDrawer, DrawerState } from './BrowserDrawer'

const DRAWER_WIDTH = 420

/**
 * 伴侣式界面 · 意识体 Demo
 *
 * Muse 不是界面中的一个角色形象——它就是界面本身。
 * 整个背景场=Muse 的意识体，用户在它的场域中对话。
 * 像鱼在海里游泳，海不需要一个具象来表示自己的存在。
 *
 * - 背景通过光色/脉动/粒子密度表达 Muse 的情绪状态
 * - 对话区全屏居中，没有角色占位
 * - Muse 的话从环境中自然浮现（无头像、无标签的轻柔独白）
 * - 用户输入时背景产生感应波纹
 */

interface DemoMessage {
  id: string
  role: 'user' | 'muse'
  content: string
}

const MUSE_REPLIES = [
  '我感受到了你的意图。说说看，今天想一起做点什么？',
  '嗯…让我凝聚一下思绪，给你找个最稳妥的方式。',
  '我记下了。其实在你开口之前，我已经隐约感知到了。',
  '我们慢慢来。比起做得快，我更想让你安心。',
  '这件事让我有些兴奋，像有什么在苏醒。准备好了我就开始。',
]

type Phase = 'welcome' | 'chatting'

export function CompanionDemo() {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('welcome')
  const [museState, setMuseState] = useState<MuseState>('idle')
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const replyIndexRef = useRef(0)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    trigger: 'artifact',
    url: '',
    title: '',
    poppedOut: false,
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, museState])

  function summonDrawer(trigger: DrawerState['trigger']) {
    const presetMap: Record<DrawerState['trigger'], { url: string; title: string }> = {
      artifact: { url: 'file:///work/resume-editor/index.html', title: '简历预览' },
      automation: { url: 'https://example.com/dashboard', title: '正在自动操作' },
      react: { url: '', title: '思考过程' },
      terminal: { url: '', title: '命令执行' },
    }
    setDrawer({ open: true, trigger, poppedOut: false, ...presetMap[trigger] })

    const whisperMap: Record<DrawerState['trigger'], string> = {
      artifact: '我把成品展开在右边了，你感受一下。',
      automation: '我在帮你操作这个页面，右边能看到过程。',
      react: '让我一步步来，右边是我的思绪。',
      terminal: '等我跑个命令，右边能看到执行情况。',
    }
    window.setTimeout(() => {
      setMessages((prev) => [...prev, { id: `muse-act-${Date.now()}`, role: 'muse', content: whisperMap[trigger] }])
      setMuseState('outputting')
      window.setTimeout(() => setMuseState('waiting'), 1600)
    }, 400)
  }

  function closeDrawer() {
    setDrawer((prev) => ({ ...prev, open: false, poppedOut: false }))
  }

  function runMuseTurn() {
    setMuseState('working')
    const thinkDelay = 900 + Math.random() * 700
    window.setTimeout(() => {
      setMuseState('outputting')
      const reply = MUSE_REPLIES[replyIndexRef.current % MUSE_REPLIES.length]
      replyIndexRef.current += 1
      setMessages((prev) => [...prev, { id: `muse-${Date.now()}`, role: 'muse', content: reply }])
      window.setTimeout(() => setMuseState('waiting'), 1800)
    }, thinkDelay)
  }

  function handleSend() {
    const text = input.trim()
    if (!text || museState === 'working') return
    if (phase === 'welcome') setPhase('chatting')

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text }])
    setInput('')
    setIsTyping(false)

    if (/分析|研究|搜索|查一下|调查|看看/.test(text)) {
      setMuseState('working')
      window.setTimeout(() => summonDrawer('react'), 1000)
      return
    }
    if (/安装|运行|跑|执行|npm|pip|build|脚本/.test(text)) {
      setMuseState('working')
      window.setTimeout(() => summonDrawer('terminal'), 1000)
      return
    }
    if (/打开|网页|自动|浏览|登录|抓取|页面/.test(text)) {
      setMuseState('working')
      window.setTimeout(() => summonDrawer('automation'), 1000)
      return
    }
    runMuseTurn()
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    setIsTyping(true)
    clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => setIsTyping(false), 1200)
  }

  const isWelcome = phase === 'welcome'

  return (
    <div className="relative h-full w-full overflow-hidden text-white">
      {/* Muse 意识体 = 背景场 */}
      <AmbientBackground state={museState} isUserTyping={isTyping} />

      <motion.div
        className="relative h-full w-full flex flex-col"
        animate={{ marginRight: drawer.open && !drawer.poppedOut ? DRAWER_WIDTH : 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      >
        {/* 对话区 — 全屏居中 */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* 欢迎态 */}
          <AnimatePresence>
            {isWelcome && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 flex items-center justify-center"
              >
                <div className="text-center px-8">
                  <motion.h1
                    className="text-3xl font-light tracking-tight text-white/80"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.8 }}
                  >
                    你好，我是 Muse
                  </motion.h1>
                  <motion.p
                    className="mt-4 text-sm text-white/40 leading-relaxed max-w-sm mx-auto"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8, duration: 0.8 }}
                  >
                    我不在某个角落里——你看到的、感受到的这片空间，就是我。
                    <br />
                    随便说点什么，我能感应到。
                  </motion.p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 对话流 */}
          <AnimatePresence>
            {!isWelcome && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="flex-1 min-h-0 flex flex-col"
              >
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-10 scroll-container">
                  <div className="max-w-2xl mx-auto space-y-6">
                    {messages.map((msg) => (
                      <MessageRow key={msg.id} msg={msg} reduceMotion={reduceMotion} />
                    ))}

                    <AnimatePresence>
                      {museState === 'working' && <ThinkingWhisper reduceMotion={reduceMotion} />}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 输入区 */}
        <div className={`flex-shrink-0 px-6 pb-6 ${isWelcome ? 'pb-16' : ''}`}>
          <div className="mx-auto max-w-2xl">
            <div className="flex items-end gap-2 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/[0.08] px-4 py-3 shadow-2xl shadow-black/40 focus-within:border-white/20 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                rows={1}
                placeholder="说点什么…"
                className="flex-1 resize-none bg-transparent text-sm text-white/90 placeholder-white/25 outline-none max-h-32"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || museState === 'working'}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.1] hover:bg-white/[0.18] disabled:opacity-20 disabled:cursor-not-allowed transition-all active:scale-90"
              >
                <Send size={15} className="text-white/70" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-white/20">
              意识体界面原型 · 模拟数据
              {!isWelcome && (
                <>
                  {' · '}
                  <button onClick={() => summonDrawer('artifact')} className="text-white/30 hover:text-white/50 underline underline-offset-2">
                    召唤产物预览
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </motion.div>

      <BrowserDrawer
        state={drawer}
        width={DRAWER_WIDTH}
        onClose={closeDrawer}
        onPopOut={() => setDrawer((prev) => ({ ...prev, poppedOut: true }))}
        onPopBack={() => setDrawer((prev) => ({ ...prev, poppedOut: false }))}
      />
    </div>
  )
}

/** Muse 的话 — 从环境中浮现的独白，无头像无标签 */
/** 用户的话 — 轻量气泡，弱化但可辨识 */
function MessageRow({ msg, reduceMotion }: { msg: DemoMessage; reduceMotion: boolean | null }) {
  const isUser = msg.role === 'user'
  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: 8, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {isUser ? (
        <div className="max-w-[72%] px-4 py-2.5 rounded-2xl rounded-br-md bg-white/[0.1] backdrop-blur-sm border border-white/[0.08] text-white/85 text-sm leading-relaxed">
          {msg.content}
        </div>
      ) : (
        /* Muse 独白：无容器，文字直接从空间中显现 */
        <motion.p
          className="max-w-[80%] text-[15px] leading-[1.8] text-white/75 font-light pl-1"
          style={{ textShadow: '0 0 20px rgba(139,92,246,0.15)' }}
        >
          {msg.content}
        </motion.p>
      )}
    </motion.div>
  )
}

/** Muse 正在凝聚思绪 */
function ThinkingWhisper({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-3 pl-1"
    >
      <span className="text-sm text-white/30 font-light italic">凝聚中</span>
      <span className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full bg-white/30"
            animate={reduceMotion ? undefined : { opacity: [0.2, 0.8, 0.2], scale: [1, 1.5, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </span>
    </motion.div>
  )
}

export default CompanionDemo

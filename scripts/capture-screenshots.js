#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 通过 Chromium DevTools Protocol 驱动 Electron 渲染进程，采集 README 所需的界面截图。
// 相比系统级截屏：不受窗口遮挡/焦点影响，输出尺寸确定，不掺入桌面内容。
//
// 前置：
//   1. npm run build:renderer
//   2. env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9222
//
// 用法：
//   node scripts/capture-screenshots.js [输出目录，默认 docs/screenshots]
//
// 采集动作：
//   hero-mindmap     知识结构：收起到主干 + 缩放到可读比例，避免 80+ 节点被适配成 18%
//   progress-board   切到进度看板
//   book-reader      打开节点详情（居中窗口），滚动到「技术要点 / 表格 / 代码实例」同屏
//   selection-ask    在正文中构造真实选区，触发浮动工具条并展开提问面板

const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.CDP_PORT || 9222)
const OUT_DIR = path.resolve(process.argv[2] || 'docs/screenshots')
const VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 2 }

// 思维导图的取景比例：全图适配会把 80+ 节点压到 18%，正文小到不可读。
// 收起到主干（保留根 + 一级分支）后放大到 70% 左右，结构完整且分支名可读。
const MINDMAP_TARGET_SCALE = 70

fs.mkdirSync(OUT_DIR, { recursive: true })

// ---------------- CDP 最小客户端 ----------------

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} 超时`))
        }
      }, 30000)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(function(){ ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error('页面脚本异常: ' + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails))
    }
    return result.result?.value
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    const file = path.join(OUT_DIR, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    const size = fs.statSync(file).size
    console.log(`  ✓ ${name}.png  (${(size / 1024).toFixed(0)} KB)`)
    return file
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`)
      const targets = await res.json()
      const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools://'))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 尚未启动，继续等待 */ }
    await sleep(500)
  }
  throw new Error(`未找到可调试页面（端口 ${PORT}）`)
}

async function connect() {
  const target = await findPageTarget()
  console.log(`已连接到渲染进程: ${target.url}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, mobile: false })
  return { cdp, ws }
}

// 轮询直到页面表达式返回真值
async function waitFor(cdp, expression, { timeout = 30000, label = '条件' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await cdp.evaluate(`return !!(${expression})`)) return true
    await sleep(300)
  }
  throw new Error(`等待超时：${label}`)
}

// ---------------- 界面操作 ----------------

// 按文本点击元素（优先精确匹配，退化为包含匹配）
const CLICK_BY_TEXT = (selector, text) => `
  const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  const target = nodes.find(el => el.textContent.trim() === ${JSON.stringify(text)})
             || nodes.find(el => el.textContent.includes(${JSON.stringify(text)}));
  if (!target) return false;
  target.click();
  return true;
`

// 思维导图工具条是纯图标按钮，没有文本，只能按 title 定位
const CLICK_BY_TITLE = title => `
  const btn = document.querySelector('button[title=' + JSON.stringify(${JSON.stringify(title)}) + ']');
  if (!btn) return false;
  btn.click();
  return true;
`

const READ_SCALE = `
  const el = Array.from(document.querySelectorAll('span')).find(x => /^\\d+%$/.test(x.textContent.trim()));
  return el ? parseInt(el.textContent.trim(), 10) : null;
`

async function goto(cdp, hash) {
  await cdp.evaluate(`window.location.hash = ${JSON.stringify(hash)}; return true`)
  await sleep(1200)
}

// 把知识结构调到「可读的结构总览」取景：收起到主干 + 缩放到目标比例。
// 全图适配在小图谱上是好取景，但本示例有 80+ 节点，适配结果只有 18%。
async function frameMindmap(cdp) {
  const collapsed = await cdp.evaluate(CLICK_BY_TITLE('收起到主干'))
  if (!collapsed) console.warn('  ⚠️ 未找到「收起到主干」按钮')
  await sleep(1800)

  for (let step = 0; step < 30; step++) {
    const current = await cdp.evaluate(READ_SCALE)
    if (!Number.isFinite(current)) break
    if (Math.abs(current - MINDMAP_TARGET_SCALE) <= 3) break
    await cdp.evaluate(CLICK_BY_TITLE(current < MINDMAP_TARGET_SCALE ? '放大' : '缩小'))
    await sleep(400)
  }
  const finalScale = await cdp.evaluate(READ_SCALE)
  console.log(`  取景比例: ${finalScale}%`)
  await sleep(1200)
}

async function main() {
  const { cdp, ws } = await connect()

  // 重载页面，保证每次采集都从干净状态开始（详情窗口关闭、视图默认）
  await cdp.send('Page.reload', { ignoreCache: false })
  await sleep(2500)

  // 重载可能停留在任意路由，先切回学习图谱页
  await cdp.evaluate(`window.location.hash = '#/learning'; return true`)
  await sleep(1500)

  // 应用就绪：等学习图谱数据加载完，左栏出现知识树
  await waitFor(cdp, `document.querySelector('.learning-tree')`, {
    label: '应用加载完成', timeout: 45000,
  })

  // ---- 1. 知识结构（思维导图）----
  console.log('\n[1/4] hero-mindmap —— 知识结构')
  await goto(cdp, '#/learning')
  await waitFor(cdp, `document.querySelector('.learning-tree')`, { label: '知识树渲染' })
  await sleep(2000)          // 等思维导图布局稳定
  await frameMindmap(cdp)
  await cdp.shot('hero-mindmap')

  // ---- 2. 进度看板 ----
  console.log('\n[2/4] progress-board —— 进度看板')
  const switched = await cdp.evaluate(CLICK_BY_TEXT('.ant-segmented-item', '进度看板'))
  if (!switched) console.warn('  ⚠️ 未找到「进度看板」切换项')
  await sleep(2000)
  await cdp.shot('progress-board')

  // 切回知识结构，并恢复同样的取景，让后续截图里的背景保持一致
  await cdp.evaluate(CLICK_BY_TEXT('.ant-segmented-item', '知识结构'))
  await sleep(1500)
  await frameMindmap(cdp)

  // ---- 3. 章节正文 ----
  // 节点详情已从右侧抽屉改为居中窗口，正文列限宽 780px 居中
  console.log('\n[3/4] book-reader —— 章节正文')
  const opened = await cdp.evaluate(CLICK_BY_TEXT('.learning-tree .ant-tree-node-content-wrapper', 'Agent 的本质'))
  if (!opened) throw new Error('无法打开目标节点')
  await waitFor(cdp, `document.querySelector('.ant-modal .learning-book')`, { label: '章节正文渲染' })
  await sleep(1500)

  // 取景：把「技术要点」压到正文区顶部，让固定结构的四段（要点 / 讲解 / 表格 / 代码实例）
  // 尽量同屏——这是「按固定结构撰写、拒绝笼统介绍」的直接证据
  const scrolled = await cdp.evaluate(`
    const body = document.querySelector('.ant-modal-body');
    const heading = Array.from(document.querySelectorAll('.learning-book h3'))
      .find(el => el.textContent.includes('技术要点'));
    if (!body || !heading) return 'no-target';
    body.scrollTop += heading.getBoundingClientRect().top - 106;
    return body.scrollTop;
  `)
  if (scrolled === 'no-target') console.warn('  ⚠️ 未找到「技术要点」标题，保持顶部取景')
  await sleep(1000)
  await cdp.shot('book-reader')

  // ---- 4. 圈选提问 ----
  console.log('\n[4/4] selection-ask —— 圈选提问')
  // 在正文中构造真实选区，并派发 mouseup 触发浮动工具条
  const selected = await cdp.evaluate(`
    const root = document.querySelector('.ant-modal .learning-book');
    if (!root) return 'no-content';

    // 找一个包含足够文字、且不在代码块里的段落
    const para = Array.from(root.querySelectorAll('p'))
      .find(p => p.textContent.trim().length > 20 && !p.closest('pre'));
    if (!para) return 'no-paragraph';

    const range = document.createRange();
    range.selectNodeContents(para);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // 浮动工具条由容器的 mouseup 触发
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return para.textContent.trim().slice(0, 30);
  `)
  if (selected === 'no-content' || selected === 'no-paragraph') throw new Error('圈选失败: ' + selected)
  console.log(`  圈选内容: 「${selected}…」`)
  await sleep(800)

  await waitFor(cdp, `document.body.innerText.includes('圈选提问')`, {
    label: '浮动工具条出现', timeout: 8000,
  })
  // 点「圈选提问」，展开下方问答面板
  await cdp.evaluate(`
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('圈选提问'));
    if (btn) btn.click();
    return true;
  `)
  await sleep(1500)

  // 面板打开后工具条会收起，这里再造一次选区让浮动工具条重新浮出，
  // 使截图同时呈现「浮动工具条 + 圈选内容 + 提问面板」。
  // 详情窗口改为居中后，正文滚动容器是 .ant-modal-body，不再靠 window 滚动，
  // 因此改用它来把目标段落滚到可视区中部。
  const again = await cdp.evaluate(`
    const root = document.querySelector('.ant-modal .learning-book');
    const body = document.querySelector('.ant-modal-body');
    if (!root) return 'no-content';

    // 选一个正文中段、且不在代码块里的段落，先滚到容器中央再框选，
    // 这样浮动工具条会落在段落上方的空白处，而不是压住 <pre>
    const paras = Array.from(root.querySelectorAll('p'))
      .filter(p => p.textContent.trim().length > 20 && !p.closest('pre'));
    if (paras.length === 0) return 'no-paragraph';

    const target = paras[Math.floor(paras.length / 2)];
    target.scrollIntoView({ block: 'center' });
    if (body) body.scrollTop = body.scrollTop;   // 触发一次重排，确保 rect 是最新值
    return target.textContent.trim().slice(0, 30);
  `)
  if (again === 'no-paragraph' || again === 'no-content') throw new Error('未找到适合演示圈选的段落')
  await sleep(1000)   // 等滚动稳定

  const picked = await cdp.evaluate(`
    const root = document.querySelector('.ant-modal .learning-book');
    // 重新按当前视口挑：优先完全可见、离中心最近的段落
    const center = window.innerHeight / 2;
    const paras = Array.from(root.querySelectorAll('p'))
      .filter(p => p.textContent.trim().length > 20 && !p.closest('pre'))
      .filter(p => {
        const r = p.getBoundingClientRect();
        return r.top > 90 && r.bottom < window.innerHeight - 120;
      })
      .sort((a, b) => Math.abs(a.getBoundingClientRect().top - center) - Math.abs(b.getBoundingClientRect().top - center));
    if (paras.length === 0) return 'no-paragraph';

    const el = paras[0];
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return el.textContent.trim().slice(0, 30);
  `)
  if (picked === 'no-paragraph') throw new Error('滚动后未找到可见段落')
  console.log(`  工具条复现选区: 「${picked}…」`)
  await sleep(900)
  await cdp.shot('selection-ask')

  ws.close()
  console.log(`\n全部完成，输出目录: ${OUT_DIR}`)
}

main().catch(error => {
  console.error('\n截图失败:', error.message)
  process.exit(1)
})

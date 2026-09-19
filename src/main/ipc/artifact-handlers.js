// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const { ipcMain, BrowserWindow } = require('electron')

/**
 * Artifact 独立预览窗口
 *
 * 把内嵌渲染区域（HTML / SVG / 图片）放大到一个独立、可自由拖动与缩放的原生窗口中承载，
 * 摆脱主应用窗口尺寸的限制。每个 artifactId 复用同一个窗口（再次打开则聚焦并刷新内容）。
 */

// artifactId -> BrowserWindow
const openWindows = new Map()

/** 转义 HTML 文本，防止注入到承载页面 */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 移除 SVG 中的脚本与事件属性，防止注入 */
function sanitizeSvg(raw) {
  return String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

/** 根据 artifact 类型构建承载页面的完整 HTML 文档 */
function buildDocument(artifact) {
  const title = escapeHtml(artifact.title || '预览')

  if (artifact.type === 'html') {
    // HTML 类型直接作为整页文档加载
    return artifact.content || '<!DOCTYPE html><html><body></body></html>'
  }

  if (artifact.type === 'svg') {
    const svg = sanitizeSvg(artifact.content || '')
    // SVG 多用黑色描边/文字且无背景填充，深色底会导致内容看不见（表现为全黑）。
    // 这里统一用浅色棋盘格背景承载，与内嵌卡片观感一致，确保内容可见。
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        html,body{margin:0;height:100%;overflow:auto}
        body{
          display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;
          background-color:#ffffff;
          background-image:
            linear-gradient(45deg,#eef1f5 25%,transparent 25%),
            linear-gradient(-45deg,#eef1f5 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,#eef1f5 75%),
            linear-gradient(-45deg,transparent 75%,#eef1f5 75%);
          background-size:20px 20px;
          background-position:0 0,0 10px,10px -10px,-10px 0;
        }
        svg{max-width:100%;max-height:100%;height:auto}
      </style></head>
      <body>${svg}</body></html>`
  }

  if (artifact.type === 'image') {
    const src = escapeHtml(artifact.src || '')
    // 浅色棋盘格背景，透明图片也能看清边界
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center}
        body{
          background-color:#ffffff;
          background-image:
            linear-gradient(45deg,#eef1f5 25%,transparent 25%),
            linear-gradient(-45deg,#eef1f5 25%,transparent 25%),
            linear-gradient(45deg,transparent 75%,#eef1f5 75%),
            linear-gradient(-45deg,transparent 75%,#eef1f5 75%);
          background-size:20px 20px;
          background-position:0 0,0 10px,10px -10px,-10px 0;
        }
        img{max-width:100%;max-height:100%;object-fit:contain}
      </style></head>
      <body><img src="${src}" alt="${title}" /></body></html>`
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
    <body style="font-family:sans-serif;padding:24px;color:#888">不支持在独立窗口中预览该类型：${escapeHtml(artifact.type)}</body></html>`
}

function register(ipc = ipcMain) {
  ipc.handle('artifact:openWindow', async (_event, artifact) => {
    try {
      if (!artifact || typeof artifact !== 'object') {
        return { success: false, error: '无效的 artifact 数据' }
      }

      const artifactId = artifact.id || `artifact-${Date.now()}`

      // 已存在则聚焦并刷新内容
      const existing = openWindows.get(artifactId)
      if (existing && !existing.isDestroyed()) {
        existing.focus()
        loadArtifact(existing, artifact)
        return { success: true, reused: true }
      }

      const win = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 360,
        minHeight: 240,
        title: artifact.title || '产物预览',
        // SVG/图片承载页为浅色背景，初始用浅色避免加载初期黑屏闪烁
        backgroundColor: artifact.type === 'html' ? '#0f1117' : '#ffffff',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // HTML artifact 内含脚本，允许其在隔离窗口内运行
          sandbox: false
        }
      })

      openWindows.set(artifactId, win)

      win.on('closed', () => {
        openWindows.delete(artifactId)
      })

      loadArtifact(win, artifact)
      return { success: true }
    } catch (err) {
      console.error('[ArtifactWindow] 打开独立窗口失败:', err.message)
      return { success: false, error: err.message }
    }
  })
}

/** 把 artifact 内容以 data URL 形式加载到窗口 */
function loadArtifact(win, artifact) {
  const html = buildDocument(artifact)
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
  win.loadURL(dataUrl)
  if (artifact.title) win.setTitle(artifact.title)
}

module.exports = { register }

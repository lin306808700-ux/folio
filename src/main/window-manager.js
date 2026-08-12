'use strict'

const { app, BrowserWindow, nativeImage } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--inspect')

// macOS dev 模式下设置 Dock 图标（app 可能已 ready，兼容两种时序）
if (process.platform === 'darwin') {
  const setDockIcon = () => {
    const iconPath = path.join(__dirname, '../../build/icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) app.dock.setIcon(icon)
  }
  if (app.isReady()) setDockIcon()
  else app.whenReady().then(setDockIcon)
}

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    backgroundColor: '#0f1219',
    show: false
  })

  // 窗口准备好后再显示，避免闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 开发模式加载 webpack dev server，生产模式加载构建产物
  if (isDev) {
    mainWindow.loadURL('http://localhost:3009')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
  }

  // 禁用 Electron 默认的捏合缩放，让 renderer 自行处理缩放手势
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  // 监听加载失败
  mainWindow.webContents.on('did-fail-load', () => {
    console.error('[Main] 页面加载失败')
    if (isDev) {
      console.log('[Main] 请确保 webpack dev server 已启动在 http://localhost:3009')
    }
  })

  return mainWindow
}

function getMainWindow() {
  return mainWindow
}

module.exports = { createWindow, getMainWindow }

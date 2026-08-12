'use strict'

const pty = require('node-pty')
const path = require('path')
const fs = require('fs')

const HOME = process.env.HOME || process.env.USERPROFILE || ''
const AI_TERMINAL_DIR = path.join(HOME, '.folio')
const WORKSPACE_CONFIG_PATH = path.join(AI_TERMINAL_DIR, 'workspace.json')
// shell precmd hook 将 $PWD 实时写入此文件，供 listCwdFiles 读取
const CWD_FILE = path.join(AI_TERMINAL_DIR, 'terminal-cwd')

let mainWindow = null
let ptyProcess = null

// 终端输出环形缓冲 — 用于"分析执行结果"功能
let terminalOutputBuffer = []
const TERMINAL_BUFFER_MAX_SIZE = 50000

function init(win) {
  mainWindow = win
}

/**
 * 读取当前 cwd：优先读 shell hook 写入的文件，回退到 workspace 配置
 */
function readCurrentCwd() {
  try {
    if (fs.existsSync(CWD_FILE)) {
      const cwd = fs.readFileSync(CWD_FILE, 'utf-8').trim()
      if (cwd && fs.existsSync(cwd)) return cwd
    }
  } catch (e) { /* ignore */ }

  // 回退：workspace 配置
  try {
    if (fs.existsSync(WORKSPACE_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf-8'))
      if (config.currentWorkspace && fs.existsSync(config.currentWorkspace)) {
        return config.currentWorkspace
      }
    }
  } catch (e) { /* ignore */ }

  return HOME
}

/**
 * 注册所有 terminal:* IPC handlers
 */
function registerHandlers(ipcMain) {
  // 创建终端进程
  ipcMain.handle('terminal:create', (event, { cols, rows }) => {
    let shell
    if (process.platform === 'win32') {
      shell = process.env.COMSPEC || 'cmd.exe'
    } else {
      shell = process.env.SHELL || '/bin/bash'
    }

    console.log('[Main] 使用 shell:', shell)

    try {
      // 确保 .folio 目录存在
      if (!fs.existsSync(AI_TERMINAL_DIR)) fs.mkdirSync(AI_TERMINAL_DIR, { recursive: true })

      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: cols || 80,
        rows: rows || 30,
        cwd: HOME || process.cwd(),
        env: process.env
      })

      ptyProcess.onData((data) => {
        // 缓冲终端输出
        terminalOutputBuffer.push(data)
        let totalSize = terminalOutputBuffer.reduce((sum, d) => sum + d.length, 0)
        while (totalSize > TERMINAL_BUFFER_MAX_SIZE && terminalOutputBuffer.length > 0) {
          totalSize -= terminalOutputBuffer.shift().length
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:data', data)
        }
      })

      ptyProcess.onExit((exitCode) => {
        console.log('[Main] 终端进程已退出，退出码:', exitCode.exitCode)
      })

      console.log('[Main] 终端进程已创建成功')

      // 注入 precmd hook：每次显示提示符时将 $PWD 写入 CWD_FILE
      // 支持 zsh (precmd_functions) 和 bash (PROMPT_COMMAND)
      setTimeout(() => {
        if (!ptyProcess) return
        const cwdFile = CWD_FILE.replace(/'/g, "'\\''")  // 转义单引号
        const hook = [
          `if [ -n "$ZSH_VERSION" ]; then`,
          `  _ait_track_cwd() { echo "$PWD" > '${cwdFile}' }`,
          `  precmd_functions=(_ait_track_cwd $precmd_functions)`,
          `elif [ -n "$BASH_VERSION" ]; then`,
          `  _ait_track_cwd() { echo "$PWD" > '${cwdFile}'; }`,
          `  PROMPT_COMMAND="_ait_track_cwd\${PROMPT_COMMAND:+; \$PROMPT_COMMAND}"`,
          `fi`,
          `echo "$PWD" > '${cwdFile}'`,  // 立即写一次当前目录
          ``
        ].join('\n')
        ptyProcess.write(hook + '\r')
      }, 500)

      // 启动后自动 cd 到默认工作区（如果有配置）
      setTimeout(() => {
        if (!ptyProcess) return
        try {
          if (fs.existsSync(WORKSPACE_CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf-8'))
            if (config.currentWorkspace && fs.existsSync(config.currentWorkspace)) {
              console.log('[Main] 自动 cd 到默认工作区:', config.currentWorkspace)
              ptyProcess.write(`cd "${config.currentWorkspace}"\r`)
            }
          }
        } catch (e) {
          console.error('[Main] 读取默认工作区配置失败:', e.message)
        }
      }, 800)

      return { success: true }
    } catch (error) {
      console.error('[Main] 终端进程创建失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 写入终端命令
  ipcMain.on('terminal:write', (event, data) => {
    if (ptyProcess) {
      ptyProcess.write(data)
    }
  })

  // 调整终端大小
  ipcMain.on('terminal:resize', (event, { cols, rows }) => {
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows)
      } catch (e) {
        console.error('[Main] 终端大小调整失败:', e)
      }
    }
  })

  // 获取终端当前 cwd 下的文件列表（供 @ 触发器使用）
  ipcMain.handle('terminal:listCwdFiles', () => {
    try {
      const cwd = readCurrentCwd()
      if (!cwd || !fs.existsSync(cwd)) {
        return { success: false, error: 'cwd 不可用', cwd: null, files: [] }
      }

      const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.cache', '.next', '.DS_Store'])
      const files = []

      for (const entry of fs.readdirSync(cwd)) {
        if (entry.startsWith('.') || IGNORED.has(entry)) continue
        const fullPath = path.join(cwd, entry)
        let stat
        try { stat = fs.statSync(fullPath) } catch { continue }

        files.push({
          name: entry,
          path: fullPath,
          relativePath: entry,
          isDirectory: stat.isDirectory(),
          size: stat.isDirectory() ? 0 : stat.size,
          modified: stat.mtime,
          ext: stat.isDirectory() ? '' : path.extname(entry).toLowerCase(),
        })
      }

      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return { success: true, cwd, files }
    } catch (e) {
      console.error('[TerminalManager] listCwdFiles 失败:', e.message)
      return { success: false, error: e.message, cwd: null, files: [] }
    }
  })

  // 获取终端最近输出 — 用于 AI 分析执行结果
  ipcMain.handle('terminal:getRecentOutput', (event, { limit = 5000 } = {}) => {
    const fullOutput = terminalOutputBuffer.join('')
    const recentOutput = fullOutput.slice(-limit)
    const cleanOutput = recentOutput
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b[#][0-9]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    return { output: cleanOutput }
  })
}

function cleanup() {
  if (ptyProcess) {
    console.log('[Main] 清理终端进程')
    ptyProcess.kill()
    ptyProcess = null
  }
}

module.exports = { init, registerHandlers, cleanup }

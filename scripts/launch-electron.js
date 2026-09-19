#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 以 development 模式启动 Electron。
//
// 为什么需要这个脚本：主进程 window-manager 依据 NODE_ENV 判断加载 webpack dev server
// 还是构建产物。若直接在 npm script 里写 `NODE_ENV=development electron .`，在 Windows
// 的 cmd.exe 下不生效。用 Node 脚本显式注入环境变量，三平台行为一致，且无需引入 cross-env。

const path = require('path')
const { spawn } = require('child_process')

// electron 包在非 Electron 环境下被 require 时，导出的是可执行文件绝对路径
const electronBinary = require('electron')
const projectRoot = path.resolve(__dirname, '..')

console.log('[dev] 以 development 模式启动 Electron（加载 http://localhost:3009）')

const child = spawn(electronBinary, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
})

child.on('error', error => {
  console.error('[dev] 启动 Electron 失败:', error.message)
  process.exit(1)
})

child.on('close', code => {
  process.exit(code ?? 0)
})

// 透传中断信号，确保 Ctrl+C 能正常结束 Electron
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

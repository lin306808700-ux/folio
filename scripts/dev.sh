#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 lin306808700-ux
#
# 一键启动 Folio 开发环境：渲染器 webpack dev server + Electron 主进程。
#
# 用法：
#   ./scripts/dev.sh              # 自动判断环境并启动
#   FOLIO_ENABLE_GPU=1 ./scripts/dev.sh
#   FOLIO_RENDERER_PORT=3010 ./scripts/dev.sh
#   FOLIO_ELECTRON_FLAGS="--no-sandbox" ./scripts/dev.sh   # 完全自定义 Electron 参数
#
# 为什么不直接用 `npm run dev`：
#
#   1. 受限运行环境（WorkBuddy / CI 沙箱等）会注入 ELECTRON_RUN_AS_NODE=1。该变量
#      会让 Electron 退化成普通 Node 进程，主进程里 require('electron') 拿不到 app
#      与 BrowserWindow，启动即崩：
#          TypeError: Cannot read properties of undefined (reading 'isReady')
#   2. 同样的环境里 Chromium sandbox 初始化会失败，GPU / network 进程反复以
#      exit_code=6 退出，最终整个应用退出。需要关闭 sandbox、退回软件渲染才稳定。
#
# 本脚本会自己判断是否处于受限环境，只在需要时才追加这些开关，正常机器上保持
# 默认行为不变。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${FOLIO_RENDERER_PORT:-3009}"
ELECTRON_BIN="./node_modules/.bin/electron"
WAIT_ON_BIN="./node_modules/.bin/wait-on"

# ---------------------------------------------------------------- 前置检查 ---

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "✖ 未找到 $ELECTRON_BIN" >&2
  echo "  请先安装依赖：npm run install:all" >&2
  exit 1
fi

if [[ ! -x "$WAIT_ON_BIN" ]]; then
  echo "✖ 未找到 $WAIT_ON_BIN" >&2
  echo "  请先安装依赖：npm install" >&2
  exit 1
fi

# ------------------------------------------------------------ 环境判定 ------

# ELECTRON_RUN_AS_NODE 若已存在，说明当前在受限环境里运行。
RESTRICTED="${FOLIO_RESTRICTED:-0}"
if [[ -n "${ELECTRON_RUN_AS_NODE:-}" ]]; then
  RESTRICTED=1
fi

# 无论如何都要清掉，否则 Electron 起不来。
unset ELECTRON_RUN_AS_NODE
unset NODE_OPTIONS

ELECTRON_FLAGS=()
if [[ "$RESTRICTED" == "1" ]]; then
  ELECTRON_FLAGS+=(--no-sandbox --disable-gpu-sandbox)
  if [[ "${FOLIO_ENABLE_GPU:-0}" == "1" ]]; then
    echo "ℹ️  受限环境：已关闭 Electron sandbox（GPU 加速保留，画面异常可去掉 FOLIO_ENABLE_GPU）"
  else
    ELECTRON_FLAGS+=(--disable-gpu)
    echo "ℹ️  受限环境：已关闭 Electron sandbox 与 GPU 加速"
  fi
fi

# 外部可完全覆盖，便于排查问题。
if [[ -n "${FOLIO_ELECTRON_FLAGS:-}" ]]; then
  # shellcheck disable=SC2206
  ELECTRON_FLAGS=(${FOLIO_ELECTRON_FLAGS})
  echo "ℹ️  使用自定义 Electron 参数：${FOLIO_ELECTRON_FLAGS}"
fi

# ------------------------------------------------------------ 进程管理 ------

RENDERER_PID=""

cleanup() {
  if [[ -n "$RENDERER_PID" ]] && kill -0 "$RENDERER_PID" 2>/dev/null; then
    echo ""
    echo "… 停止渲染器 dev server (pid $RENDERER_PID)"
    kill "$RENDERER_PID" 2>/dev/null || true
    wait "$RENDERER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

port_in_use() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

# -------------------------------------------------- 步骤 1：渲染器 dev server -

if port_in_use; then
  echo "ℹ️  端口 $PORT 已有人在监听，直接复用现有 dev server"
else
  echo "▶ 启动渲染器 dev server：http://localhost:$PORT"
  npm --prefix src/renderer run dev &
  RENDERER_PID=$!

  echo "… 等待 webpack 首次编译完成（通常 20-40 秒）"
  if ! "$WAIT_ON_BIN" "http://localhost:$PORT" --timeout 180000; then
    echo "✖ 等待 dev server 超时（180s）。请检查上面的 webpack 输出。" >&2
    exit 1
  fi
  echo "✔ 渲染器已就绪"
fi

# ------------------------------------------------------- 步骤 2：Electron ---

# 注意：bash 3.2（macOS 自带）在 set -u 下展开空数组 "arr[@]" 会报错，
# 所以这里用 ${arr[@]+"${arr[@]}"} 的写法。
echo "▶ 启动 Electron（NODE_ENV=development）"
if [[ "${#ELECTRON_FLAGS[@]}" -gt 0 ]]; then
  echo "  参数：${ELECTRON_FLAGS[*]}"
fi
echo ""

NODE_ENV=development "$ELECTRON_BIN" . ${ELECTRON_FLAGS[@]+"${ELECTRON_FLAGS[@]}"}

echo "Electron 已退出。"

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { analyzeRepository } = require('./architecture-analyzer')

try {
  parentPort.postMessage({ success: true, data: analyzeRepository(workerData.repoPath) })
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message })
}

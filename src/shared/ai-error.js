// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

/**
 * 识别「看起来像正文，其实是上游报错」的文本。
 *
 * 为什么需要这个判据：qodercli 在额度耗尽 / 鉴权失败时，会把错误写进 **stdout**，
 * 形如：
 *
 *   Qoder API error: FORBIDDEN - {"code":"112","message":"{\"pricingUrl\":\"…\"}"}
 *
 * 流式读取时它与正常的模型输出无从区分，于是被当成正文一路传下去。落到学习图谱里
 * 就是一个 115 字的「章节」——既不可读，又因为 content 非空而被判定为「已写好」，
 * 反过来永久挡住种子回填。所以这个判据必须在**写入之前**生效。
 *
 * 判据刻意收得很紧：宁可漏判，也不能误伤正常正文。
 * 两个条件同时成立才算报错——文本足够短（真章节按提示词契约 ≥ 800 字），
 * 且命中明确的上游错误特征。
 */

// 真章节正文远长于这个量级；超过就不可能是单条错误信息
const PROVIDER_ERROR_LIMIT = 400

// 明确的报错特征。注意不要放宽松的词（例如单独一个 "forbidden"）：
// 讲 HTTP 状态码的技术章节里完全可能出现 403 / FORBIDDEN 这类字样。
const PROVIDER_ERROR_PATTERNS = [
  /\bAPI error\b\s*[:\-]/i, // "Qoder API error: FORBIDDEN - …"
  /^\{\s*"?(code|error)"?\s*:/i, // 裸 JSON 错误体 {"code":"112","message":…}
  /pricingUrl/i, // 额度类错误的固定字段
  /insufficient[_ ]quota/i,
  /exceeded your current quota/i,
]

/**
 * @param {unknown} text 待判定的文本
 * @returns {boolean} 是否应视为上游报错而非正文
 */
function isProviderErrorText(text) {
  if (typeof text !== 'string') return false
  const value = text.trim()
  if (!value || value.length > PROVIDER_ERROR_LIMIT) return false
  return PROVIDER_ERROR_PATTERNS.some(pattern => pattern.test(value))
}

module.exports = { isProviderErrorText, PROVIDER_ERROR_LIMIT }

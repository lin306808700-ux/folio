// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

'use strict'

// 上游报错判据：必须认出「其实是一次失败的调用」，也**必须不误伤正常正文**。
// 后者比前者更重要 —— 判错一次就会把好好生成的章节丢掉，或把用户手写的笔记覆盖掉。

const assert = require('assert')
const { isProviderErrorText, PROVIDER_ERROR_LIMIT } = require('./ai-error')

// 真实踩到的报错：qodercli 在额度耗尽时把它写进 stdout
const REAL_QUOTA_ERROR = 'Qoder API error: FORBIDDEN - {"code":"112","message":"{\\"pricingUrl\\":\\"https://qoder.com/pricing?client=qoder\\"}"}'

function run() {
  // —— 应识别为上游报错 ——
  assert.ok(isProviderErrorText(REAL_QUOTA_ERROR), '真实的额度报错必须被认出')
  assert.ok(isProviderErrorText('{"code":"112","message":"quota"}'), '裸 JSON 错误体应被认出')
  assert.ok(isProviderErrorText('openai API error: 429 - rate limited'), 'API error 前缀应被认出')
  assert.ok(isProviderErrorText('You exceeded your current quota, please check your plan'))

  // —— 不得误伤正常正文 ——
  assert.ok(!isProviderErrorText('### 技术要点\n\n- Agent = **LLM + 循环 + 工具**，三者缺一不可'))
  // 讲状态码的技术章节里完全可能出现 FORBIDDEN，不能靠单词命中
  assert.ok(!isProviderErrorText('讲一下 403 FORBIDDEN 的语义：它表示服务端拒绝执行，与 401 的区别在于凭证本身是否有效。'))
  assert.ok(!isProviderErrorText('FORBIDDEN'))
  assert.ok(!isProviderErrorText(''))
  assert.ok(!isProviderErrorText(null))
  assert.ok(!isProviderErrorText(undefined))
  assert.ok(!isProviderErrorText(12345), '非字符串不应崩')

  // 长文本一律不算报错：真章节按提示词契约 ≥ 800 字
  const long = `Qoder API error: FORBIDDEN ${'x'.repeat(PROVIDER_ERROR_LIMIT)}`
  assert.ok(!isProviderErrorText(long), '超过长度上限的文本不应被当成报错')

  console.log('ai error predicate checks passed')
}

run()

'use strict'

/**
 * AI Client — 对外接口层
 *
 * 核心模型调用（callAI / callAIStream）已委托给 model-provider.js，
 * 默认复用本机 Qoder CLI，也支持任意 OpenAI 兼容 API。
 *
 * 本文件保留：
 * - collectStream：流式收集工具
 * - analyzeImages：图片识别（根据 provider 自动选择实现）
 */

const axios = require('axios')
const { callAI, callAIStream, stripThinkingTags, getConfig, isAiBusy, abortCallsByLabel } = require('./model-provider')

// ========== 流式收集 ==========

/**
 * 收集流式输出的完整内容
 * @param {AsyncGenerator} streamGen - callAIStream 返回的 async generator
 * @returns {Promise<string>} 完整的累积文本
 */
async function collectStream(streamGen) {
  let fullContent = ''
  for await (const { content, streamEnd } of streamGen) {
    fullContent = content
  }
  return fullContent
}

// ========== 图片识别 ==========

/**
 * 调用图片识别 API，返回图片内容描述文本
 * 根据 provider 自动选择实现：
 *   - openai: OpenAI Vision API（gpt-4o 等多模态模型）
 *   - qoder:  暂不支持，报错提示
 *
 * @param {Array<string|{ dataUrl: string; mimeType: string; name?: string }>} images
 * @param {string} userQuestion
 * @returns {Promise<string>}
 */
async function analyzeImages(images, userQuestion) {
  if (!images || images.length === 0) return ''
  const config = getConfig()

  if (config.provider === 'qoder') {
    throw new Error('本机 Qoder 模式暂不支持图片识别，请改用文字描述或切换 provider')
  }
  return analyzeImagesOpenAI(images, userQuestion, config)
}

// --- OpenAI Vision ---

async function analyzeImagesOpenAI(images, userQuestion, config) {
  const question = userQuestion || '请详细描述图片中的内容'
  const descriptions = []

  for (let i = 0; i < images.length; i++) {
    try {
      const rawImage = images[i]
      const imageUrl = typeof rawImage === 'string' ? rawImage : rawImage?.dataUrl
      if (!imageUrl) {
        console.warn(`[AI][Vision] 图片${i + 1} 数据为空，跳过`)
        continue
      }

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ]

      const response = await axios.post(
        `${config.baseUrl}/chat/completions`,
        { model: config.model, messages, stream: false },
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      )

      const description = stripThinkingTags(response.data?.choices?.[0]?.message?.content || '')
      console.log(`[AI][Vision] 图片${i + 1}识别完成，描述长度:`, description.length)
      if (description) {
        descriptions.push(images.length > 1 ? `[图片${i + 1}]: ${description}` : description)
      }
    } catch (error) {
      console.error(`[AI][Vision] 图片${i + 1}识别失败:`, error.message)
    }
  }
  return descriptions.join('\n\n')
}

module.exports = { callAI, callAIStream, collectStream, analyzeImages, isAiBusy, abortCallsByLabel }

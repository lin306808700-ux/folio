// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const express = require('express');
const router = express.Router();
const { callAI } = require('../../../../shared/ai-client');

/**
 * @swagger
 * /api/copilot/suggest:
 *   post:
 *     summary: 获取 AI 智能建议问题
 *     tags: [Copilot]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               context:
 *                 type: string
 *               pageType:
 *                 type: string
 *     responses:
 *       200:
 *         description: 返回建议问题列表
 */
router.post('/suggest', async (req, res) => {
  const { context, pageType } = req.body;
  const userId = req.auth?.workid || 'anonymous';

  try {
    const SYSTEM_PROMPT = `你是一个智能助手 Copilot。请根据当前用户所处的页面上下文（${pageType}）和内容（${context}），生成3-4个用户可能想问的后续问题。要求简洁、自然、具有启发性。仅返回 JSON 数组格式，例如：["问题1", "问题2", "问题3"]。`;
    
    const content = await callAI(SYSTEM_PROMPT, {
      empId: userId,
      sessionId: `copilot_suggest_${Date.now()}`
    });

    let suggestions = ["接下来聊点什么？", "你能帮我总结一下吗？", "有什么新鲜事？"];
    
    if (content) {
      try {
        const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) suggestions = parsed;
      } catch (e) {
        console.warn('[Copilot Suggest] 解析建议失败，使用默认值');
      }
    }

    res.json({ success: true, data: suggestions });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取建议失败' });
  }
});

/**
 * @swagger
 * /api/copilot/action:
 *   post:
 *     summary: 执行 AI 快捷指令
 *     tags: [Copilot]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *               context:
 *                 type: string
 *     responses:
 *       200:
 *         description: 返回指令执行结果
 */
router.post('/action', async (req, res) => {
  const { action, context } = req.body;
  const userId = req.auth?.workid || 'anonymous';

  try {
    let prompt = '';
    if (action === 'summarize') prompt = `请简要总结以下内容的核要点：\n${context}`;
    else if (action === 'extract') prompt = `请从以下内容中提取出所有的关键行动项或待办：\n${context}`;
    else prompt = `请分析以下内容：\n${context}`;

    const result = await callAI(prompt, {
      empId: userId,
      sessionId: `copilot_action_${Date.now()}`
    }) || '执行失败。';

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: '快捷指令执行异常' });
  }
});

module.exports = router;

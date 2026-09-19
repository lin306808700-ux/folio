// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const express = require('express');
const router = express.Router();
const { getPostgrestClient } = require('../config/database');
const { callAI } = require('../../../../shared/ai-client');

/**
 * @swagger
 * /api/ideas:
 *   get:
 *     summary: 获取所有灵感
 *     tags: [Ideas]
 *     responses:
 *       200:
 *         description: 成功返回灵感列表
 */
router.get('/', async (req, res) => {
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  try {
    const { data, error } = await client
      .from('ideas')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('[Ideas] 获取失败:', error.message);
    res.status(500).json({ success: false, message: '获取灵感失败' });
  }
});

/**
 * @swagger
 * /api/ideas/extract:
 *   post:
 *     summary: 从对话提取灵感
 *     tags: [Ideas]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: 成功提取并存入灵感池
 */
router.post('/extract', async (req, res) => {
  const { query, content } = req.body;
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  try {
    let ideaTitle = query.slice(0, 20) + (query.length > 20 ? '...' : '');
    let ideaContent = content;
    
    // 尝试调用 AI 提取灵感标题和核心内容
    try {
      const SYSTEM_PROMPT = `你是一个灵感捕获专家。请从给定的对话中提炼出一个简洁的标题和灵感核心内容。返回 JSON 格式：{"title": "...", "content": "..."}。若无有效灵感则返回 NO_INFO。`;
      const result = await callAI(
        `${SYSTEM_PROMPT}\n\nQ: ${query}\nA: ${content}`,
        { empId: userId, sessionId: `idea_${Date.now()}` }
      );

      if (result && result !== 'NO_INFO') {
        const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
        if (parsed.title) ideaTitle = parsed.title;
        if (parsed.content) ideaContent = parsed.content;
      }
    } catch (e) {
      console.warn('[Ideas Extract] AI 提取服务暂不可用，使用原始数据');
    }

    const { data, error } = await client.from('ideas').insert({
      user_id: userId,
      title: ideaTitle,
      content: ideaContent,
      tags: ['灵感捕获']
    }).select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Ideas Extract] 提取失败:', error.message);
    res.status(500).json({ success: false, message: '灵感提取异常' });
  }
});

// 删除灵感
router.delete('/:id', async (req, res) => {
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);
  try {
    const { error } = await client.from('ideas').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[Ideas Delete] 删除失败:', error.message);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

module.exports = router;

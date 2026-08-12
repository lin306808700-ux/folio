const express = require('express');
const router = express.Router();
const { getPostgrestClient } = require('../config/database');
const { callAI } = require('../../../../shared/ai-client');

/**
 * @swagger
 * /api/memories:
 *   get:
 *     summary: 获取所有记忆
 *     tags: [Memories]
 *     responses:
 *       200:
 *         description: 成功返回记忆列表
 */
router.get('/', async (req, res) => {
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  try {
    const { data, error } = await client
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('[Memories] 获取失败:', error.message);
    res.status(500).json({ success: false, message: '获取记忆中心数据失败' });
  }
});

/**
 * @swagger
 * /api/memories/extract:
 *   post:
 *     summary: 从对话中提取记忆
 *     tags: [Memories]
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
 *         description: 成功提取并存入记忆
 */
router.post('/extract', async (req, res) => {
  const { query, content } = req.body;
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  try {
    let memoryContent = `智脑记录：关于"${query}"的深度洞察。`;
    
    // 尝试调用 AI 提取服务
    try {
      const SYSTEM_PROMPT = `你是一个数据提取专家。从对话中提取关于用户的事实或偏好。用中文回答。若无则返回 NO_INFO。`;
      const fact = await callAI(
        `${SYSTEM_PROMPT}\n\nQ: ${query}\nA: ${content}`,
        { empId: userId, sessionId: `ex_${Date.now()}` }
      );
      if (fact && fact !== 'NO_INFO') memoryContent = fact.trim();
    } catch (e) {
      console.warn('[Extract] AI 提取服务暂不可用，已切换至基础记录模式');
    }

    const { data, error } = await client.from('memories').insert({
      user_id: userId,
      content: memoryContent,
      category: '深度学习'
    }).select();

    if (error) throw error;
    res.json({ success: true, data: data[0] });
  } catch (error) {
    console.error('[Extract] 提取失败:', error.message);
    res.status(500).json({ success: false, message: '记忆提取过程发生异常' });
  }
});

// 删除记忆
router.delete('/:id', async (req, res) => {
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);
  try {
    const { error } = await client.from('memories').delete().eq('id', req.params.id).eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('[Delete] 遗忘失败:', error.message);
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

module.exports = router;

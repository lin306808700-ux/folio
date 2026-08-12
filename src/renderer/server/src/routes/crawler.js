const express = require('express');
const router = express.Router();
const { getPostgrestClient } = require('../config/database');
const { callAI } = require('../../../../shared/ai-client');

/**
 * @swagger
 * /api/crawler/run:
 *   post:
 *     summary: 执行网页爬取任务
 *     tags: [Crawler]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               query:
 *                 type: string
 *     responses:
 *       200:
 *         description: 成功返回爬取并解析后的数据
 */
router.post('/run', async (req, res) => {
  const { url, query } = req.body;
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  if (!url) {
    return res.status(400).json({ success: false, message: 'URL 不能为空' });
  }

  try {
    console.log(`[Crawler] Starting task for ${url} by ${userId}`);
    
    // 调用 AI 爬虫服务进行网页内容抓取和解析
    const SYSTEM_PROMPT = `你是一个专业的网页信息提取专家。请抓取并总结该网页的核心内容。如果用户提供了 query，请重点提取相关信息。`;
    
    const crawlResult = await callAI(
      `${SYSTEM_PROMPT}\n目标URL: ${url}\n用户关注点: ${query || '整体内容总结'}`,
      { empId: userId, sessionId: `crawl_${Date.now()}` }
    ) || '未能获取到有效内容。';

    // 保存到爬取历史
    const { data, error } = await client.from('crawl_history').insert({
      user_id: userId,
      url: url,
      query: query || '内容摘要',
      result: { content: crawlResult }
    }).select();

    if (error) {
      console.error('[Crawler] Save history error:', error);
    }

    res.json({ success: true, data: crawlResult });
  } catch (error) {
    console.error('[Crawler] Task failed:', error.message);
    res.status(500).json({ success: false, message: '网页爬取服务暂时不可用: ' + error.message });
  }
});

/**
 * @swagger
 * /api/crawler/history:
 *   get:
 *     summary: 获取爬取历史记录
 *     tags: [Crawler]
 *     responses:
 *       200:
 *         description: 成功返回爬取历史列表
 */
router.get('/history', async (req, res) => {
  const userId = req.auth?.workid || 'anonymous';
  const client = getPostgrestClient(req);

  try {
    const { data, error } = await client
      .from('crawl_history')
      .select('*')
      .neq('url', 'chat://core-matrix') // 过滤掉普通对话产生的历史
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('[Crawler] History fetch failed:', error.message);
    res.status(500).json({ success: false, message: '获取爬取历史失败' });
  }
});

module.exports = router;

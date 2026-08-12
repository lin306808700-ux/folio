const express = require('express');
const router = express.Router();
const { getPostgrestClient } = require('../config/database');
const { callAI } = require('../../../../shared/ai-client');

/**
 * @swagger
 * /api/chat/test:
 *   get:
 *     summary: 连通性测试接口
 */
router.get('/test', (req, res) => {
  res.json({ success: true, message: '后端 Chat 路由已激活' });
});

/**
 * @swagger
 * /api/chat:
 *   post:
 *     summary: 发送聊天消息
 */
router.post('/', async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.auth?.workid || 'anonymous';
    const client = getPostgrestClient(req);

    if (!message) {
      return res.status(400).json({ success: false, message: '指令集为空' });
    }

    // 默认兜底回复
    let aiResponse = `缪斯(降级模式)已接收指令："${message}"。由于连接波动，目前仅提供基础反馈。`;

    // 获取近期对话历史和记忆以提供上下文
    let historyContext = '';
    try {
      const [{ data: history }, { data: memories }] = await Promise.all([
        client.from('crawl_history')
          .select('query, result')
          .eq('user_id', userId)
          .eq('url', 'chat://core-matrix')
          .order('created_at', { ascending: false })
          .limit(5),
        client.from('memories')
          .select('content')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(3)
      ]);

      if (memories && memories.length > 0) {
        historyContext += `[用户背景记忆]\n${memories.map(m => m.content).join('\n')}\n\n`;
      }
      if (history && history.length > 0) {
        // 反转历史使其按时间顺序排列
        historyContext += `[近期对话历史]\n${history.reverse().map(h => `问：${h.query}\n答：${h.result?.content || ''}`).join('\n')}\n\n`;
      }
    } catch (dbErr) {
      console.warn('[Context Fetch Error]:', dbErr.message);
    }

    // 尝试调用 AI 服务
    try {
      const content = await callAI(
        `${historyContext}你是缪斯（Muse），主人身边的贴心智能伴侣。请结合上述背景记忆和对话历史，回答主人当前的问题：${message}`,
        { empId: userId === 'anonymous' ? 'anonymous' : userId, sessionId: `matrix_${userId}` }
      );
      if (content) aiResponse = content;
    } catch (e) {
      console.warn('[Chat AI] 调用失败:', e.message);
    }

    // 尝试保存历史，失败不阻塞返回
    try {
      await client.from('crawl_history').insert({
        user_id: userId,
        query: message,
        url: 'chat://core-matrix',
        result: { content: aiResponse }
      });
    } catch (dbErr) {
      console.error('[Chat DB Error]:', dbErr.message);
    }

    res.json({ success: true, data: aiResponse });
  } catch (error) {
    console.error('[Chat Route Fatal]:', error);
    res.status(500).json({ success: false, message: '指令解析异常: ' + error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const userId = req.auth?.workid || 'anonymous';
    const client = getPostgrestClient(req);
    const { data, error } = await client
      .from('crawl_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取历史记录失败' });
  }
});

module.exports = router;

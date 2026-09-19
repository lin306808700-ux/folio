// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

const express = require('express');
const router = express.Router();
const { getPostgrestClient } = require('../config/database');

/**
 * @swagger
 * /api/skills:
 *   get:
 *     summary: 获取所有技能
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.auth?.workid || 'anonymous';
    const client = getPostgrestClient(req);
    const { data, error } = await client
      .from('skills')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取技能失败: ' + error.message });
  }
});

/**
 * @swagger
 * /api/skills:
 *   post:
 *     summary: 创建新技能
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.auth?.workid || 'anonymous';
    const { name, description, prompt, icon } = req.body;
    const client = getPostgrestClient(req);

    const { data, error } = await client
      .from('skills')
      .insert({
        user_id: userId,
        name,
        description,
        prompt,
        icon: icon || 'Zap'
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: '创建技能失败: ' + error.message });
  }
});

/**
 * @swagger
 * /api/skills/{id}:
 *   delete:
 *     summary: 删除技能
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.auth?.workid || 'anonymous';
    const { id } = req.params;
    const client = getPostgrestClient(req);

    const { error } = await client
      .from('skills')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    res.json({ success: true, message: '技能已移除' });
  } catch (error) {
    res.status(500).json({ success: false, message: '删除技能失败: ' + error.message });
  }
});

/**
 * @swagger
 * /api/skills/{id}:
 *   put:
 *     summary: 更新技能
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = req.auth?.workid || 'anonymous';
    const { id } = req.params;
    const { name, description, prompt, icon } = req.body;
    const client = getPostgrestClient(req);

    const { data, error } = await client
      .from('skills')
      .update({
        name,
        description,
        prompt,
        icon
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: '更新技能失败: ' + error.message });
  }
});

module.exports = router;

'use strict'

/**
 * Skill 市场模块
 * 提供技能浏览、发现、推荐功能
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const MARKET_CACHE_FILE = path.join(os.homedir(), '.ai-terminal', 'skill-market-cache.json')
// 市场地址可配置：优先环境变量，其次默认 GitHub 仓库
const MARKET_API_URL = process.env.MUSE_SKILL_MARKET_URL || 'https://raw.githubusercontent.com/muse-ai-terminal/skill-market/main/index.json'

// ========== 本地技能分析 ==========

/**
 * 分析已安装技能的元数据，用于市场展示
 */
function analyzeLocalSkills() {
  const { Skills } = require('../database')
  const { getSkillStats, getTopSkills } = require('./skill-creator')

  const skills = Skills.getAll()
  const stats = getSkillStats()
  const topSkills = getTopSkills(10)

  return skills.map(skill => {
    const skillStats = stats[skill.id] || { activations: 0, successes: 0, failures: 0, lastUsed: null }
    const successRate = skillStats.activations > 0
      ? Math.round((skillStats.successes / skillStats.activations) * 100)
      : null

    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      triggers: skill.triggers,
      inputs: skill.inputs,
      sideEffects: skill.sideEffects,
      dangerous: skill.dangerous,
      onError: skill.onError,
      // 统计数据
      activations: skillStats.activations,
      successRate,
      lastUsed: skillStats.lastUsed,
      // 排名
      rank: topSkills.findIndex(t => t.id === skill.id) + 1 || null
    }
  })
}

// ========== 远程市场（带缓存）==========

function loadMarketCache() {
  try {
    if (fs.existsSync(MARKET_CACHE_FILE)) {
      const raw = fs.readFileSync(MARKET_CACHE_FILE, 'utf-8')
      const cache = JSON.parse(raw)
      // 缓存有效期 1 小时
      if (Date.now() - cache.fetchedAt < 60 * 60 * 1000) {
        return cache.data
      }
    }
  } catch {}
  return null
}

function saveMarketCache(data) {
  try {
    fs.writeFileSync(MARKET_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), data }, null, 2), 'utf-8')
  } catch {}
}

/**
 * 获取远程市场技能列表（带本地缓存）
 */
async function fetchMarketSkills() {
  const cached = loadMarketCache()
  if (cached) return cached

  try {
    const axios = require('axios')
    const resp = await axios.get(MARKET_API_URL, { timeout: 10000 })
    const data = resp.data
    if (Array.isArray(data)) {
      saveMarketCache(data)
      return data
    }
  } catch (err) {
    console.warn('[SkillMarket] 获取远程市场失败:', err.message)
  }

  return []
}

/**
 * 获取已安装技能的 ID 集合，用于标记"已安装"状态
 */
function getInstalledSkillIds() {
  const { Skills } = require('../database')
  return new Set(Skills.getAll().map(s => s.id))
}

/**
 * 搜索市场技能（本地 + 远程）
 * @param {string} keyword
 */
async function searchMarket(keyword) {
  const remoteSkills = await fetchMarketSkills()
  const installedIds = getInstalledSkillIds()

  const results = remoteSkills
    .filter(s => {
      if (!keyword) return true
      const kw = keyword.toLowerCase()
      return (
        s.name?.toLowerCase().includes(kw) ||
        s.description?.toLowerCase().includes(kw) ||
        (s.tags || []).some(t => t.toLowerCase().includes(kw))
      )
    })
    .map(s => ({
      ...s,
      installed: installedIds.has(s.id)
    }))

  return results
}

/**
 * 获取推荐技能（基于使用频率 + 技能缺口分析）
 * @param {number} limit
 */
async function getRecommendedSkills(limit = 6) {
  const remoteSkills = await fetchMarketSkills()
  const installedIds = getInstalledSkillIds()

  // 推荐未安装的、热门的技能
  const uninstalled = remoteSkills
    .filter(s => !installedIds.has(s.id))
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    .slice(0, limit)

  return uninstalled.map(s => ({ ...s, installed: false }))
}

module.exports = {
  analyzeLocalSkills,
  fetchMarketSkills,
  searchMarket,
  getRecommendedSkills
}

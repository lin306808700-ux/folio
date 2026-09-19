/**
 * 语义缓存系统（简化版）
 * 
 * 纯内存 Map 方案，替代之前的 ChromaDB + EmbeddingModel 架构。
 * 核心特性：
 * 1. 分级 TTL：命令类缓存 5 分钟，知识类缓存 24 小时
 * 2. LRU 淘汰：超过 maxSize 时移除最久未命中的条目
 * 3. 关键词提取 + 同义词扩展 + Jaccard 相似度匹配
 */

// 同义词组 — 同一组内的词视为等价
const SYNONYM_GROUPS = [
  ['查看', '显示', '看', '展示', '列出', '打印'],
  ['查找', '搜索', '找', '搜', '检索'],
  ['删除', '移除', '清除', '去掉', '干掉'],
  ['创建', '新建', '生成', '添加'],
  ['修改', '编辑', '更改', '改', '变更'],
  ['安装', '装', '部署'],
  ['运行', '执行', '跑', '启动'],
  ['停止', '关闭', '终止', '杀死', '结束'],
  ['复制', '拷贝', '克隆'],
  ['移动', '转移', '迁移'],
  ['更新', '升级', '刷新'],
  ['下载', '拉取', '获取'],
  ['文件', '文档'],
  ['目录', '文件夹', '路径'],
  ['进程', '程序', '服务'],
  ['依赖', '包', 'package', '模块'],
  ['show', 'display', 'list', 'print'],
  ['find', 'search', 'grep', 'locate'],
  ['delete', 'remove', 'rm'],
  ['create', 'make', 'new', 'add'],
  ['run', 'exec', 'execute', 'start'],
  ['stop', 'kill', 'terminate', 'close'],
  ['install', 'setup'],
  ['update', 'upgrade'],
];

class SemanticCache {
  constructor() {
    // key → { content, timestamp, type, hits, lastHit }
    this.data = new Map();
    this.stats = { totalQueries: 0, cacheHits: 0, cacheMisses: 0 };
    this.maxSize = 100;
    this.similarityThreshold = 0.65;
    // 分级 TTL（毫秒）
    this.TTL = {
      command: 5 * 60 * 1000,       // 命令类 5 分钟
      knowledge: 24 * 60 * 60 * 1000 // 知识类 24 小时
    };
    this.isInitialized = false;
    // cacheManager 指向自身，保持对外接口兼容
    this.cacheManager = this;
  }

  async initialize() {
    this.isInitialized = true;
    console.log('[SemanticCache] 简化版缓存系统已初始化（分级TTL + LRU）');
    return true;
  }

  /**
   * 查询缓存
   * @param {string} query - 用户查询文本
   * @returns {{ hit: boolean, content?: string, similarity?: number }}
   */
  async query(query) {
    this.stats.totalQueries++;

    const now = Date.now();
    let bestMatch = null;
    let bestSimilarity = 0;
    let bestKey = null;

    for (const [cachedKey, entry] of this.data.entries()) {
      // 过期检测
      const ttl = this.TTL[entry.type] || this.TTL.knowledge;
      if (now - entry.timestamp > ttl) {
        this.data.delete(cachedKey);
        continue;
      }

      const similarity = this._similarity(query, cachedKey);
      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = entry;
        bestKey = cachedKey;
      }
    }

    if (bestMatch) {
      // 更新 LRU 信息
      bestMatch.hits++;
      bestMatch.lastHit = now;
      this.stats.cacheHits++;
      console.log(`[SemanticCache] 命中 (${bestSimilarity.toFixed(2)}): "${bestKey?.substring(0, 30)}..."`);
      return { hit: true, content: bestMatch.content, similarity: bestSimilarity };
    }

    this.stats.cacheMisses++;
    return { hit: false };
  }

  /**
   * 缓存新条目
   * @param {string} key - 缓存键（用户原始输入）
   * @param {string} content - AI 响应内容
   * @param {{ type?: string }} metadata - type: 'command' | 'knowledge'
   */
  async cache(key, content, metadata = {}) {
    // LRU 淘汰：超过上限时移除最久未命中的
    if (this.data.size >= this.maxSize) {
      this._evictLRU();
    }

    this.data.set(key, {
      content,
      timestamp: Date.now(),
      type: metadata.type || 'knowledge',
      hits: 0,
      lastHit: 0
    });

    console.log(`[SemanticCache] 已缓存 (${metadata.type || 'knowledge'}): "${key.substring(0, 40)}..."`);
    return `cache-${Date.now()}`;
  }

  async getStats() {
    const hitRate = this.stats.totalQueries > 0
      ? (this.stats.cacheHits / this.stats.totalQueries) * 100
      : 0;

    return {
      totalQueries: this.stats.totalQueries,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRate,
      hitRateFormatted: `${hitRate.toFixed(1)}%`,
      count: this.data.size,
      initialized: this.isInitialized
    };
  }

  async cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.data.entries()) {
      const ttl = this.TTL[entry.type] || this.TTL.knowledge;
      if (now - entry.timestamp > ttl) {
        this.data.delete(key);
        cleaned++;
      }
    }
    console.log(`[SemanticCache] 清理了 ${cleaned} 条过期缓存`);
    return cleaned;
  }

  async reset() {
    this.data.clear();
    this.stats = { totalQueries: 0, cacheHits: 0, cacheMisses: 0 };
    console.log('[SemanticCache] 缓存已重置');
  }

  // ========== cacheManager 兼容方法 ==========

  async updateStats(isHit) {
    // stats 已在 query() 中更新，此方法保持兼容
  }

  async getReport() {
    const stats = await this.getStats();
    return {
      summary: {
        总查询次数: stats.totalQueries,
        缓存命中: stats.cacheHits,
        缓存未命中: stats.cacheMisses,
        命中率: stats.hitRateFormatted,
        缓存条目数: stats.count
      },
      performance: {
        预估节省Token数: Math.floor(stats.cacheHits * 100),
        预估节省成本: (stats.cacheHits * 0.002).toFixed(4) + ' USD'
      },
      recommendations: this._getRecommendations(stats)
    };
  }

  // ========== 内部方法 ==========

  /** LRU 淘汰：移除 lastHit 最小的条目 */
  _evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.data.entries()) {
      const t = entry.lastHit || entry.timestamp;
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.data.delete(oldestKey);
      console.log(`[SemanticCache] LRU淘汰: "${oldestKey.substring(0, 30)}..."`);
    }
  }

  /** 混合相似度：关键词 Jaccard(0.4) + 同义词扩展 Jaccard(0.4) + 编辑距离(0.2) */
  _similarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1.0;

    const tokens1 = this._tokenize(s1);
    const tokens2 = this._tokenize(s2);

    const jaccardSim = this._jaccard(tokens1, tokens2);
    const synonymSim = this._jaccard(this._expandSynonyms(tokens1), this._expandSynonyms(tokens2));

    const maxLen = Math.max(s1.length, s2.length);
    const editSim = 1 - (this._editDistance(s1, s2) / maxLen);

    return jaccardSim * 0.4 + synonymSim * 0.4 + editSim * 0.2;
  }

  _tokenize(text) {
    const tokens = new Set();
    // 英文单词
    (text.match(/[a-z]+/g) || []).forEach(w => tokens.add(w));
    // 中文 bigram + unigram
    const chinese = text.replace(/[a-z0-9\s]/g, '');
    for (let i = 0; i < chinese.length; i++) {
      tokens.add(chinese[i]);
      if (i < chinese.length - 1) tokens.add(chinese.substring(i, i + 2));
    }
    return tokens;
  }

  _expandSynonyms(tokens) {
    const expanded = new Set(tokens);
    for (const token of tokens) {
      for (const group of SYNONYM_GROUPS) {
        if (group.includes(token)) {
          group.forEach(s => expanded.add(s));
        }
      }
    }
    return expanded;
  }

  _jaccard(set1, set2) {
    if (set1.size === 0 && set2.size === 0) return 1;
    if (set1.size === 0 || set2.size === 0) return 0;
    let intersection = 0;
    for (const item of set1) {
      if (set2.has(item)) intersection++;
    }
    return intersection / (set1.size + set2.size - intersection);
  }

  _editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]) + 1;
      }
    }
    return dp[m][n];
  }

  _getRecommendations(stats) {
    if (stats.hitRate < 30) return ['命中率较低，可降低相似度阈值或积累更多缓存'];
    if (stats.hitRate > 80) return ['命中率很高，缓存系统运行良好！'];
    return ['缓存系统运行正常'];
  }
}

module.exports = new SemanticCache();

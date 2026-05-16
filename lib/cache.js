/**
 * 内存级读写穿透缓存（增强版）
 * 热启动时优先从内存读取，检测到 Redis 更新时才同步
 * 新增：LRU 淘汰策略、缓存预热、统计信息
 */

class MemoryCache {
  constructor() {
    // 实例级内存缓存（Serverless 热启动时保留）
    this.cache = new Map();
    this.timestamps = new Map(); // 记录每个 key 的最后更新时间
    this.accessCount = new Map(); // 访问计数（用于统计）
    this.enabled = process.env.MEMORY_CACHE_ENABLED !== 'false';
    this.defaultTTL = parseInt(process.env.CACHE_TTL || '300', 10); // 默认 5 分钟
    this.maxSize = parseInt(process.env.CACHE_MAX_SIZE || '100', 10); // 最大缓存条目数
    
    // 统计信息
    this.stats_hits = 0;
    this.stats_misses = 0;
    this.stats_evictions = 0;
  }

  /**
   * 从内存获取数据
   */
  get(key) {
    if (!this.enabled) return null;

    const cached = this.cache.get(key);
    if (!cached) {
      this.stats_misses++;
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl * 1000) {
      // 过期，删除
      this.cache.delete(key);
      this.timestamps.delete(key);
      this.accessCount.delete(key);
      this.stats_misses++;
      return null;
    }

    // 更新访问计数和时间（LRU）
    this.accessCount.set(key, (this.accessCount.get(key) || 0) + 1);
    cached.lastAccess = now;
    this.stats_hits++;

    return cached.value;
  }

  /**
   * 写入内存缓存（带 LRU 淘汰）
   */
  set(key, value, ttl = null) {
    if (!this.enabled) return;

    const now = Date.now();

    // 检查是否需要淘汰
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: now,
      lastAccess: now,
      ttl: ttl || this.defaultTTL,
    });
    this.timestamps.set(key, now);
    this.accessCount.set(key, 0);
  }

  /**
   * LRU 淘汰策略：删除最久未访问的条目
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, cached] of this.cache.entries()) {
      if (cached.lastAccess < oldestTime) {
        oldestTime = cached.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.timestamps.delete(oldestKey);
      this.accessCount.delete(oldestKey);
      this.stats_evictions++;
      console.log(`[LRU Eviction] Removed key: ${oldestKey}`);
    }
  }

  /**
   * 删除缓存
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
    this.accessCount.delete(key);
  }

  /**
   * 批量删除（支持通配符）
   */
  deletePattern(pattern) {
    const regex = new RegExp(pattern.replace('*', '.*'));
    let deleted = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
    this.accessCount.clear();
    this.stats_hits = 0;
    this.stats_misses = 0;
    this.stats_evictions = 0;
  }

  /**
   * 获取缓存统计
   */
  stats() {
    const hitRate = this.stats_hits + this.stats_misses > 0
      ? (this.stats_hits / (this.stats_hits + this.stats_misses) * 100).toFixed(2)
      : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      enabled: this.enabled,
      hits: this.stats_hits,
      misses: this.stats_misses,
      evictions: this.stats_evictions,
      hitRate: `${hitRate}%`,
      keys: Array.from(this.cache.keys()),
      topAccessed: this.getTopAccessed(5),
    };
  }

  /**
   * 获取访问次数最多的 key
   */
  getTopAccessed(limit = 5) {
    const sorted = Array.from(this.accessCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return sorted.map(([key, count]) => ({ key, count }));
  }

  /**
   * 检查 Redis 是否有更新（通过 TTL 或时间戳判断）
   */
  async shouldRefresh(key, redis) {
    if (!this.enabled) return true;

    const localTimestamp = this.timestamps.get(key);
    if (!localTimestamp) return true;

    try {
      // 检查 Redis 中的时间戳字段
      const remoteTimestamp = await redis.hget(`${key}:meta`, 'updated_at');
      if (!remoteTimestamp) return true;

      return parseInt(remoteTimestamp, 10) > localTimestamp;
    } catch (error) {
      // Redis 出错时，使用本地缓存
      console.error('Redis timestamp check failed:', error.message);
      return false;
    }
  }

  /**
   * 缓存预热：批量加载热点数据
   */
  async warmup(redis, keys) {
    if (!this.enabled) return;

    console.log(`[Cache Warmup] Loading ${keys.length} keys...`);
    let loaded = 0;

    for (const key of keys) {
      try {
        const value = await redis.get(key);
        if (value) {
          this.set(key, value);
          loaded++;
        }
      } catch (error) {
        console.error(`[Cache Warmup] Failed to load ${key}:`, error.message);
      }
    }

    console.log(`[Cache Warmup] Loaded ${loaded}/${keys.length} keys`);
    return loaded;
  }

  /**
   * 获取缓存健康度
   */
  health() {
    const hitRate = this.stats_hits + this.stats_misses > 0
      ? this.stats_hits / (this.stats_hits + this.stats_misses)
      : 0;

    const usage = this.cache.size / this.maxSize;

    let status = 'healthy';
    if (hitRate < 0.5) status = 'degraded'; // 命中率低于 50%
    if (usage > 0.9) status = 'warning'; // 使用率超过 90%

    return {
      status,
      hitRate: `${(hitRate * 100).toFixed(2)}%`,
      usage: `${(usage * 100).toFixed(2)}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

// 全局单例（跨请求共享，热启动时保留）
let globalCache = null;

function getCache() {
  if (!globalCache) {
    globalCache = new MemoryCache();
  }
  return globalCache;
}

module.exports = { MemoryCache, getCache };

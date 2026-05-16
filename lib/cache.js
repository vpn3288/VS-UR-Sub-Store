/**
 * 内存级读写穿透缓存
 * 热启动时优先从内存读取，检测到 Redis 更新时才同步
 */

class MemoryCache {
  constructor() {
    // 实例级内存缓存（Serverless 热启动时保留）
    this.cache = new Map();
    this.timestamps = new Map(); // 记录每个 key 的最后更新时间
    this.enabled = process.env.MEMORY_CACHE_ENABLED !== 'false';
    this.defaultTTL = parseInt(process.env.CACHE_TTL || '300', 10); // 默认 5 分钟
  }

  /**
   * 从内存获取数据
   */
  get(key) {
    if (!this.enabled) return null;

    const cached = this.cache.get(key);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > cached.ttl * 1000) {
      // 过期，删除
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }

    return cached.value;
  }

  /**
   * 写入内存缓存
   */
  set(key, value, ttl = null) {
    if (!this.enabled) return;

    const now = Date.now();
    this.cache.set(key, {
      value,
      timestamp: now,
      ttl: ttl || this.defaultTTL,
    });
    this.timestamps.set(key, now);
  }

  /**
   * 删除缓存
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  /**
   * 获取缓存统计
   */
  stats() {
    return {
      size: this.cache.size,
      enabled: this.enabled,
      keys: Array.from(this.cache.keys()),
    };
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

/**
 * 订阅下载 API
 * 路由: /api/download/[id]
 * 
 * 这是最核心的 API，负责：
 * 1. 从 Redis 读取订阅配置
 * 2. 拉取上游订阅内容
 * 3. 返回给客户端（Clash/Surge）
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { handleCORS, errorResponse, sanitizeHeaders } = require('../lib/utils');

module.exports = async (req, res) => {
  // 处理 CORS
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    // 从路径中提取订阅 ID: /api/download/sub_xxx
    const pathParts = req.url.split('/');
    const id = pathParts[pathParts.length - 1].split('?')[0];

    if (!id) {
      return errorResponse(res, 400, 'Missing subscription ID');
    }

    // 缓存键
    const cacheKey = `download:${id}`;
    const configCacheKey = `subscription:${id}`;

    // 1. 检查内存缓存（热启动优化）
    const shouldRefresh = await cache.shouldRefresh(configCacheKey, redis);
    
    if (!shouldRefresh) {
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        console.log(`[Cache Hit] ${id} - Memory cache, latency <10ms`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Cache-Status', 'HIT-MEMORY');
        res.setHeader('X-Cache-Latency', '<10ms');
        return res.status(200).send(cachedContent);
      }
    }

    // 2. 从 Redis 读取订阅配置
    let subscription;
    try {
      const data = await redis.hgetall(`subscription:${id}`);
      
      if (!data || Object.keys(data).length === 0) {
        return errorResponse(res, 404, 'Subscription not found');
      }

      subscription = {
        id: data.id,
        name: data.name,
        url: data.url,
        enabled: data.enabled === 'true',
      };

      if (!subscription.enabled) {
        return errorResponse(res, 403, 'Subscription is disabled');
      }
    } catch (error) {
      console.error('Redis config read failed:', error.message);
      
      // 降级：尝试从内存缓存读取旧内容
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        console.log(`[Fallback] ${id} - Using stale cache due to Redis error`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Cache-Status', 'STALE-FALLBACK');
        res.setHeader('X-Redis-Error', error.message);
        return res.status(200).send(cachedContent);
      }

      return errorResponse(res, 503, 'Service temporarily unavailable', error.message);
    }

    // 3. 拉取上游订阅内容
    let content;
    try {
      console.log(`[Fetch] ${id} - Fetching from upstream: ${subscription.url}`);
      
      const upstreamResponse = await fetch(subscription.url, {
        method: 'GET',
        headers: sanitizeHeaders(req.headers),
        signal: AbortSignal.timeout(10000), // 10秒超时
      });

      if (!upstreamResponse.ok) {
        throw new Error(`Upstream returned ${upstreamResponse.status}`);
      }

      content = await upstreamResponse.text();

      if (!content || content.length === 0) {
        throw new Error('Empty response from upstream');
      }

      // 4. 写入内存缓存（5分钟）
      cache.set(cacheKey, content, 300);

      // 5. 更新 Redis 时间戳
      const now = Date.now();
      await redis.hset(`subscription:${id}:meta`, 'updated_at', now.toString()).catch(err => {
        console.error('Failed to update timestamp:', err.message);
      });

      console.log(`[Success] ${id} - Content cached, size: ${content.length} bytes`);

    } catch (error) {
      console.error('Upstream fetch failed:', error.message);

      // 降级：返回缓存内容（即使过期）
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        console.log(`[Fallback] ${id} - Using stale cache due to upstream error`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Cache-Status', 'STALE-UPSTREAM-ERROR');
        res.setHeader('X-Upstream-Error', error.message);
        return res.status(200).send(cachedContent);
      }

      return errorResponse(res, 502, 'Failed to fetch upstream subscription', error.message);
    }

    // 6. 返回内容
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('Content-Length', Buffer.byteLength(content, 'utf-8'));
    res.setHeader('Cache-Control', 'public, max-age=300'); // 客户端缓存5分钟
    res.status(200).send(content);

  } catch (error) {
    console.error('Download API error:', error);
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

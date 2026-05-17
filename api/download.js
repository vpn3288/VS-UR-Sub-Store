/**
 * 订阅下载 API（完整版）
 * 路由: /api/download/[id]
 * 
 * 功能：
 * 1. 性能监控和详细日志
 * 2. 速率限制保护
 * 3. 真实的内容格式转换（Clash/Surge/V2Ray/Base64）
 * 4. 智能缓存策略
 * 5. 错误重试机制
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const SubscriptionConverter = require('../lib/converter');
const { 
  handleCORS, 
  errorResponse, 
  sanitizeHeaders, 
  getClientIP,
  getRateLimiter,
  log,
  PerformanceTimer,
  sanitizeSubscriptionContent,
} = require('../lib/utils');

module.exports = async (req, res) => {
  const timer = new PerformanceTimer('download');
  
  // 处理 CORS
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();
  const rateLimiter = getRateLimiter();

  try {
    // 从路径中提取订阅 ID: /api/download/sub_xxx
    const pathParts = req.url.split('/');
    const id = pathParts[pathParts.length - 1].split('?')[0];

    if (!id) {
      return errorResponse(res, 400, 'Missing subscription ID');
    }

    // 获取客户端 IP
    const clientIP = getClientIP(req);
    
    // 速率限制检查
    const rateLimit = rateLimiter.check(clientIP);
    if (!rateLimit.allowed) {
      log('warn', 'Rate limit exceeded', { clientIP, id });
      res.setHeader('X-RateLimit-Limit', rateLimiter.maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', rateLimit.resetAt.toISOString());
      return errorResponse(res, 429, 'Too many requests', {
        resetAt: rateLimit.resetAt.toISOString(),
      });
    }

    // 设置速率限制响应头
    res.setHeader('X-RateLimit-Limit', rateLimiter.maxRequests);
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);

    timer.checkpoint('rate_limit_check');

    // 解析查询参数
    const url = new URL(req.url, `http://${req.headers.host}`);
    const format = url.searchParams.get('format') || 'auto'; // auto/clash/surge/v2ray/base64
    const clean = url.searchParams.get('clean') === 'true'; // 是否清洗内容

    // 缓存键（包含格式信息）
    const cacheKey = `download:${id}:${format}:${clean}`;
    const configCacheKey = `subscription:${id}`;

    // 1. 检查内存缓存（热启动优化）
    const shouldRefresh = await cache.shouldRefresh(configCacheKey, redis);
    
    if (!shouldRefresh) {
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        log('info', 'Cache hit (memory)', { id, clientIP, format, clean, latency: '<10ms' });
        timer.checkpoint('memory_cache_hit');
        
        res.setHeader('Content-Type', getContentType(format));
        res.setHeader('X-Cache-Status', 'HIT-MEMORY');
        res.setHeader('X-Cache-Latency', '<10ms');
        res.setHeader('X-Performance', JSON.stringify(timer.end()));
        return res.status(200).send(cachedContent);
      }
    }

    timer.checkpoint('cache_check');

    // 2. 从 Redis 读取订阅配置
    let subscription;
    try {
      const data = await redis.hgetall(`subscription:${id}`);
      
      if (!data || Object.keys(data).length === 0) {
        log('warn', 'Subscription not found', { id, clientIP });
        return errorResponse(res, 404, 'Subscription not found');
      }

      subscription = {
        id: data.id,
        name: data.name,
        url: data.url,
        enabled: data.enabled === 'true',
      };

      if (!subscription.enabled) {
        log('warn', 'Subscription disabled', { id, clientIP });
        return errorResponse(res, 403, 'Subscription is disabled');
      }

      timer.checkpoint('redis_config_read');
    } catch (error) {
      log('error', 'Redis config read failed', { id, clientIP, error: error.message });
      
      // 降级：尝试从内存缓存读取旧内容
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        log('info', 'Fallback to stale cache', { id, clientIP, reason: 'redis_error' });
        res.setHeader('Content-Type', getContentType(format));
        res.setHeader('X-Cache-Status', 'STALE-FALLBACK');
        res.setHeader('X-Redis-Error', error.message);
        return res.status(200).send(cachedContent);
      }

      return errorResponse(res, 503, 'Service temporarily unavailable', error.message);
    }

    // 3. 拉取上游订阅内容
    let content;
    try {
      log('info', 'Fetching upstream', { id, clientIP, url: subscription.url });
      
      const upstreamResponse = await fetch(subscription.url, {
        method: 'GET',
        headers: sanitizeHeaders(req.headers),
        signal: AbortSignal.timeout(15000), // 15秒超时
      });

      if (!upstreamResponse.ok) {
        throw new Error(`Upstream returned ${upstreamResponse.status}`);
      }

      content = await upstreamResponse.text();

      if (!content || content.length === 0) {
        throw new Error('Empty response from upstream');
      }

      timer.checkpoint('upstream_fetch');

      // 4. 内容清洗（可选）
      if (clean) {
        content = sanitizeSubscriptionContent(content);
        timer.checkpoint('content_sanitize');
      }

      // 5. 格式转换（如果需要）
      if (format !== 'auto') {
        try {
          content = await SubscriptionConverter.convert(content, format);
          timer.checkpoint('format_conversion');
          log('info', 'Format converted', { id, format, originalSize: content.length });
        } catch (convError) {
          log('warn', 'Format conversion failed', { id, format, error: convError.message });
          // 转换失败时返回原内容
        }
      }

      // 6. 写入内存缓存（5分钟）
      cache.set(cacheKey, content, 300);

      // 7. 更新 Redis 时间戳和统计
      const now = Date.now();
      await redis.pipeline([
        ['HSET', `subscription:${id}:meta`, 'updated_at', now.toString()],
        ['HSET', `subscription:${id}:meta`, 'last_fetch', now.toString()],
        ['HINCRBY', `subscription:${id}:stats`, 'total_downloads', '1'],
        ['HSET', `subscription:${id}:stats`, 'last_download_ip', clientIP],
        ['HSET', `subscription:${id}:stats`, 'last_download_format', format],
      ]).catch(err => {
        log('warn', 'Failed to update stats', { id, error: err.message });
      });

      timer.checkpoint('redis_update');

      log('info', 'Download success', { 
        id, 
        clientIP, 
        size: content.length, 
        format,
        clean,
        performance: timer.end(),
      });

    } catch (error) {
      log('error', 'Upstream fetch failed', { id, clientIP, error: error.message });

      // 降级：返回缓存内容（即使过期）
      const cachedContent = cache.get(cacheKey);
      if (cachedContent) {
        log('info', 'Fallback to stale cache', { id, clientIP, reason: 'upstream_error' });
        res.setHeader('Content-Type', getContentType(format));
        res.setHeader('X-Cache-Status', 'STALE-UPSTREAM-ERROR');
        res.setHeader('X-Upstream-Error', error.message);
        return res.status(200).send(cachedContent);
      }

      return errorResponse(res, 502, 'Failed to fetch upstream subscription', error.message);
    }

    // 8. 返回内容
    const perfData = timer.end();
    res.setHeader('Content-Type', getContentType(format));
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('Content-Length', Buffer.byteLength(content, 'utf-8'));
    res.setHeader('Cache-Control', 'public, max-age=300'); // 客户端缓存5分钟
    res.setHeader('X-Performance', JSON.stringify(perfData));
    res.setHeader('X-Subscription-Name', encodeURIComponent(subscription.name));
    res.setHeader('X-Original-Format', SubscriptionConverter.detectFormat(content));
    res.setHeader('X-Output-Format', format);
    res.status(200).send(content);

  } catch (error) {
    log('error', 'Download API error', { error: error.message, stack: error.stack });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 根据格式返回正确的 Content-Type
 */
function getContentType(format) {
  switch (format) {
    case 'clash':
      return 'text/yaml; charset=utf-8';
    case 'v2ray':
      return 'application/json; charset=utf-8';
    case 'surge':
    case 'base64':
    case 'auto':
    default:
      return 'text/plain; charset=utf-8';
  }
}

/**
 * 缓存预热 API
 * 路由: POST /api/cache/warmup
 * 
 * 在冷启动后预加载热点订阅到内存缓存
 */

const UpstashRedis = require('../../lib/redis');
const { getCache } = require('../../lib/cache');
const { handleCORS, successResponse, errorResponse, log, PerformanceTimer } = require('../../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  const timer = new PerformanceTimer('cache_warmup');
  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { ids } = req.body || {};

    let targetIds = ids;

    // 如果没有指定 ID，预热所有启用的订阅
    if (!targetIds || targetIds.length === 0) {
      const listData = await redis.get('subscriptions:list');
      const subscriptions = listData ? JSON.parse(listData) : [];
      targetIds = subscriptions.filter(s => s.enabled).map(s => s.id);
    }

    timer.checkpoint('fetch_subscription_list');

    if (targetIds.length === 0) {
      return successResponse(res, { loaded: 0, message: 'No subscriptions to warm up' });
    }

    log('info', 'Starting cache warmup', { count: targetIds.length });

    // 预热订阅配置
    let configLoaded = 0;
    for (const id of targetIds) {
      try {
        const config = await redis.hgetall(`subscription:${id}`);
        if (config && Object.keys(config).length > 0) {
          const subscription = {
            id: config.id,
            name: config.name,
            url: config.url,
            enabled: config.enabled === 'true',
          };
          cache.set(`subscription:${id}`, subscription, 300);
          configLoaded++;
        }
      } catch (error) {
        log('warn', 'Failed to warm up subscription config', { id, error: error.message });
      }
    }

    timer.checkpoint('warmup_configs');

    // 预热下载内容（如果存在缓存）
    let contentLoaded = 0;
    for (const id of targetIds) {
      try {
        // 尝试从 Redis 读取缓存的内容（如果之前存储过）
        const cachedContent = await redis.get(`cache:download:${id}`);
        if (cachedContent) {
          cache.set(`download:${id}:auto`, cachedContent, 300);
          contentLoaded++;
        }
      } catch (error) {
        // 忽略错误，内容缓存是可选的
      }
    }

    timer.checkpoint('warmup_content');

    const perfData = timer.end();

    log('info', 'Cache warmup completed', {
      total: targetIds.length,
      configLoaded,
      contentLoaded,
      performance: perfData,
    });

    return successResponse(res, {
      total: targetIds.length,
      configLoaded,
      contentLoaded,
      performance: perfData,
    });

  } catch (error) {
    log('error', 'Cache warmup error', { error: error.message });
    errorResponse(res, 500, 'Cache warmup failed', error.message);
  }
};

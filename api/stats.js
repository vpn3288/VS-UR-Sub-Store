/**
 * 统计分析 API
 * 路由: /api/stats
 * 
 * 提供订阅下载统计、性能分析、缓存健康度等信息
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { handleCORS, successResponse, errorResponse } = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { id } = req.query;

    if (id) {
      // 获取单个订阅的统计
      return await getSubscriptionStats(redis, cache, id, res);
    } else {
      // 获取全局统计
      return await getGlobalStats(redis, cache, res);
    }
  } catch (error) {
    console.error('Stats API error:', error);
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 获取单个订阅的统计
 */
async function getSubscriptionStats(redis, cache, id, res) {
  try {
    const exists = await redis.exists(`subscription:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Subscription not found');
    }

    const [config, meta, stats] = await Promise.all([
      redis.hgetall(`subscription:${id}`),
      redis.hgetall(`subscription:${id}:meta`),
      redis.hgetall(`subscription:${id}:stats`),
    ]);

    const result = {
      id,
      name: config.name,
      url: config.url,
      enabled: config.enabled === 'true',
      created_at: parseInt(config.created_at, 10),
      updated_at: parseInt(config.updated_at, 10),
      stats: {
        total_downloads: parseInt(stats.total_downloads || '0', 10),
        last_download_ip: stats.last_download_ip || null,
        last_fetch: meta.last_fetch ? parseInt(meta.last_fetch, 10) : null,
      },
    };

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, 503, 'Failed to fetch stats', error.message);
  }
}

/**
 * 获取全局统计
 */
async function getGlobalStats(redis, cache, res) {
  try {
    // 获取所有订阅列表
    const listData = await redis.get('subscriptions:list');
    const subscriptions = listData ? JSON.parse(listData) : [];

    // 获取缓存统计
    const cacheStats = cache.stats();
    const cacheHealth = cache.health();

    // 计算总下载量
    let totalDownloads = 0;
    for (const sub of subscriptions) {
      try {
        const stats = await redis.hgetall(`subscription:${sub.id}:stats`);
        totalDownloads += parseInt(stats.total_downloads || '0', 10);
      } catch (error) {
        console.error(`Failed to get stats for ${sub.id}:`, error.message);
      }
    }

    const result = {
      subscriptions: {
        total: subscriptions.length,
        enabled: subscriptions.filter(s => s.enabled).length,
        disabled: subscriptions.filter(s => !s.enabled).length,
      },
      downloads: {
        total: totalDownloads,
      },
      cache: {
        stats: cacheStats,
        health: cacheHealth,
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node_version: process.version,
      },
    };

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, 503, 'Failed to fetch global stats', error.message);
  }
}

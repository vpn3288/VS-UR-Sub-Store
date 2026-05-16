/**
 * 健康检查 API
 * 路由: /api/health
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { handleCORS, successResponse, errorResponse } = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const startTime = Date.now();
  const redis = new UpstashRedis();
  const cache = getCache();

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cache: cache.stats(),
    redis: { status: 'unknown', latency: null },
  };

  // 测试 Redis 连接
  try {
    const testKey = 'health:ping';
    const testValue = Date.now().toString();
    
    const redisStart = Date.now();
    await redis.set(testKey, testValue, 10);
    const result = await redis.get(testKey);
    const redisLatency = Date.now() - redisStart;

    if (result === testValue) {
      health.redis.status = 'healthy';
      health.redis.latency = `${redisLatency}ms`;
    } else {
      health.redis.status = 'degraded';
      health.redis.error = 'Value mismatch';
    }
  } catch (error) {
    health.status = 'degraded';
    health.redis.status = 'unhealthy';
    health.redis.error = error.message;
  }

  const totalLatency = Date.now() - startTime;
  health.latency = `${totalLatency}ms`;

  if (health.status === 'healthy') {
    return successResponse(res, health);
  } else {
    return errorResponse(res, 503, 'Service degraded', health);
  }
};

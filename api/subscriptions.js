/**
 * 订阅管理 API
 * 路由: /api/subscriptions
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { handleCORS, errorResponse, successResponse, isValidSubscriptionUrl, generateId, safeJsonParse } = require('../lib/utils');

module.exports = async (req, res) => {
  // 处理 CORS
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { method } = req;
    const { id } = req.query;

    // GET /api/subscriptions - 获取所有订阅
    if (method === 'GET' && !id) {
      return await listSubscriptions(redis, cache, res);
    }

    // GET /api/subscriptions?id=xxx - 获取单个订阅
    if (method === 'GET' && id) {
      return await getSubscription(redis, cache, id, res);
    }

    // POST /api/subscriptions - 创建订阅
    if (method === 'POST') {
      return await createSubscription(redis, cache, req, res);
    }

    // PUT /api/subscriptions?id=xxx - 更新订阅
    if (method === 'PUT' && id) {
      return await updateSubscription(redis, cache, id, req, res);
    }

    // DELETE /api/subscriptions?id=xxx - 删除订阅
    if (method === 'DELETE' && id) {
      return await deleteSubscription(redis, cache, id, res);
    }

    errorResponse(res, 405, 'Method not allowed');
  } catch (error) {
    console.error('Subscriptions API error:', error);
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 列出所有订阅
 */
async function listSubscriptions(redis, cache, res) {
  const cacheKey = 'subscriptions:list';
  
  // 尝试从内存缓存读取
  const cached = cache.get(cacheKey);
  if (cached) {
    return successResponse(res, cached, { source: 'memory_cache', latency: '<10ms' });
  }

  try {
    // 从 Redis 读取
    const listData = await redis.get('subscriptions:list');
    const subscriptions = safeJsonParse(listData, []);

    // 写入内存缓存
    cache.set(cacheKey, subscriptions, 60); // 1分钟缓存

    return successResponse(res, subscriptions, { source: 'redis', count: subscriptions.length });
  } catch (error) {
    // Redis 失败，返回空列表
    console.error('Redis list failed:', error.message);
    return successResponse(res, [], { source: 'fallback', error: error.message });
  }
}

/**
 * 获取单个订阅
 */
async function getSubscription(redis, cache, id, res) {
  const cacheKey = `subscription:${id}`;
  
  // 检查是否需要刷新
  const shouldRefresh = await cache.shouldRefresh(cacheKey, redis);
  
  if (!shouldRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return successResponse(res, cached, { source: 'memory_cache', latency: '<10ms' });
    }
  }

  try {
    const data = await redis.hgetall(`subscription:${id}`);
    
    if (!data || Object.keys(data).length === 0) {
      return errorResponse(res, 404, 'Subscription not found');
    }

    // 解析 JSON 字段
    const subscription = {
      id: data.id,
      name: data.name,
      url: data.url,
      enabled: data.enabled === 'true',
      created_at: parseInt(data.created_at, 10),
      updated_at: parseInt(data.updated_at, 10),
    };

    // 写入内存缓存
    cache.set(cacheKey, subscription, 300); // 5分钟缓存

    return successResponse(res, subscription, { source: 'redis' });
  } catch (error) {
    console.error('Redis get failed:', error.message);
    
    // 尝试从内存缓存降级
    const cached = cache.get(cacheKey);
    if (cached) {
      return successResponse(res, cached, { source: 'memory_cache_fallback', warning: error.message });
    }

    return errorResponse(res, 503, 'Service temporarily unavailable', error.message);
  }
}

/**
 * 创建订阅
 */
async function createSubscription(redis, cache, req, res) {
  const { name, url, enabled = true } = req.body || {};

  if (!name || !url) {
    return errorResponse(res, 400, 'Missing required fields: name, url');
  }

  if (!isValidSubscriptionUrl(url)) {
    return errorResponse(res, 400, 'Invalid subscription URL');
  }

  try {
    const id = generateId('sub');
    const now = Date.now();

    const subscription = {
      id,
      name,
      url,
      enabled: enabled.toString(),
      created_at: now.toString(),
      updated_at: now.toString(),
    };

    // 写入 Redis Hash
    await redis.executePost([
      ['HSET', `subscription:${id}`, 'id', id],
      ['HSET', `subscription:${id}`, 'name', name],
      ['HSET', `subscription:${id}`, 'url', url],
      ['HSET', `subscription:${id}`, 'enabled', enabled.toString()],
      ['HSET', `subscription:${id}`, 'created_at', now.toString()],
      ['HSET', `subscription:${id}`, 'updated_at', now.toString()],
      ['HSET', `subscription:${id}:meta`, 'updated_at', now.toString()],
    ]);

    // 更新列表
    const listData = await redis.get('subscriptions:list');
    const list = safeJsonParse(listData, []);
    list.push({ id, name, enabled });
    await redis.set('subscriptions:list', JSON.stringify(list));

    // 清除缓存
    cache.delete('subscriptions:list');
    cache.delete(`subscription:${id}`);

    return successResponse(res, { id, name, url, enabled, created_at: now, updated_at: now }, { created: true });
  } catch (error) {
    console.error('Redis create failed:', error.message);
    return errorResponse(res, 503, 'Failed to create subscription', error.message);
  }
}

/**
 * 更新订阅
 */
async function updateSubscription(redis, cache, id, req, res) {
  const { name, url, enabled } = req.body || {};

  try {
    const exists = await redis.exists(`subscription:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Subscription not found');
    }

    const now = Date.now();
    const updates = [['HSET', `subscription:${id}`, 'updated_at', now.toString()]];

    if (name !== undefined) updates.push(['HSET', `subscription:${id}`, 'name', name]);
    if (url !== undefined) {
      if (!isValidSubscriptionUrl(url)) {
        return errorResponse(res, 400, 'Invalid subscription URL');
      }
      updates.push(['HSET', `subscription:${id}`, 'url', url]);
    }
    if (enabled !== undefined) updates.push(['HSET', `subscription:${id}`, 'enabled', enabled.toString()]);

    // 更新时间戳
    updates.push(['HSET', `subscription:${id}:meta`, 'updated_at', now.toString()]);

    await redis.executePost(updates);

    // 清除缓存
    cache.delete(`subscription:${id}`);
    cache.delete('subscriptions:list');

    return successResponse(res, { id, updated_at: now }, { updated: true });
  } catch (error) {
    console.error('Redis update failed:', error.message);
    return errorResponse(res, 503, 'Failed to update subscription', error.message);
  }
}

/**
 * 删除订阅
 */
async function deleteSubscription(redis, cache, id, res) {
  try {
    const exists = await redis.exists(`subscription:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Subscription not found');
    }

    await redis.executePost([
      ['DEL', `subscription:${id}`],
      ['DEL', `subscription:${id}:meta`],
    ]);

    // 更新列表
    const listData = await redis.get('subscriptions:list');
    const list = safeJsonParse(listData, []);
    const filtered = list.filter(item => item.id !== id);
    await redis.set('subscriptions:list', JSON.stringify(filtered));

    // 清除缓存
    cache.delete(`subscription:${id}`);
    cache.delete('subscriptions:list');

    return successResponse(res, { id }, { deleted: true });
  } catch (error) {
    console.error('Redis delete failed:', error.message);
    return errorResponse(res, 503, 'Failed to delete subscription', error.message);
  }
}

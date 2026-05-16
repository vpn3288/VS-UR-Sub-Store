/**
 * 批量操作 API
 * 路由: /api/batch
 * 
 * 支持批量创建、更新、删除订阅
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { 
  handleCORS, 
  errorResponse, 
  successResponse, 
  isValidSubscriptionUrl, 
  generateId,
  log,
  PerformanceTimer,
} = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const timer = new PerformanceTimer('batch');
  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { method } = req;

    if (method !== 'POST') {
      return errorResponse(res, 405, 'Method not allowed');
    }

    const { action, items } = req.body || {};

    if (!action || !items || !Array.isArray(items)) {
      return errorResponse(res, 400, 'Missing required fields: action, items');
    }

    timer.checkpoint('validation');

    let results = [];

    switch (action) {
      case 'create':
        results = await batchCreate(redis, cache, items, timer);
        break;
      case 'update':
        results = await batchUpdate(redis, cache, items, timer);
        break;
      case 'delete':
        results = await batchDelete(redis, cache, items, timer);
        break;
      default:
        return errorResponse(res, 400, `Unknown action: ${action}`);
    }

    const perfData = timer.end();
    log('info', 'Batch operation completed', { action, count: items.length, performance: perfData });

    return successResponse(res, results, { 
      action, 
      total: items.length,
      performance: perfData,
    });

  } catch (error) {
    log('error', 'Batch API error', { error: error.message });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 批量创建订阅
 */
async function batchCreate(redis, cache, items, timer) {
  const results = [];
  const now = Date.now();
  const commands = [];

  for (const item of items) {
    const { name, url, enabled = true } = item;

    if (!name || !url) {
      results.push({ success: false, error: 'Missing name or url', item });
      continue;
    }

    if (!isValidSubscriptionUrl(url)) {
      results.push({ success: false, error: 'Invalid URL', item });
      continue;
    }

    const id = generateId('sub');

    // 构建批量命令
    commands.push(['HSET', `subscription:${id}`, 'id', id]);
    commands.push(['HSET', `subscription:${id}`, 'name', name]);
    commands.push(['HSET', `subscription:${id}`, 'url', url]);
    commands.push(['HSET', `subscription:${id}`, 'enabled', enabled.toString()]);
    commands.push(['HSET', `subscription:${id}`, 'created_at', now.toString()]);
    commands.push(['HSET', `subscription:${id}`, 'updated_at', now.toString()]);
    commands.push(['HSET', `subscription:${id}:meta`, 'updated_at', now.toString()]);

    results.push({ success: true, id, name, url, enabled });
  }

  // 批量执行
  if (commands.length > 0) {
    await redis.pipeline(commands);
    timer.checkpoint('redis_batch_create');
  }

  // 清除列表缓存
  cache.delete('subscriptions:list');

  return results;
}

/**
 * 批量更新订阅
 */
async function batchUpdate(redis, cache, items, timer) {
  const results = [];
  const now = Date.now();
  const commands = [];

  for (const item of items) {
    const { id, name, url, enabled } = item;

    if (!id) {
      results.push({ success: false, error: 'Missing id', item });
      continue;
    }

    const exists = await redis.exists(`subscription:${id}`);
    if (!exists) {
      results.push({ success: false, error: 'Subscription not found', item });
      continue;
    }

    if (name !== undefined) {
      commands.push(['HSET', `subscription:${id}`, 'name', name]);
    }
    if (url !== undefined) {
      if (!isValidSubscriptionUrl(url)) {
        results.push({ success: false, error: 'Invalid URL', item });
        continue;
      }
      commands.push(['HSET', `subscription:${id}`, 'url', url]);
    }
    if (enabled !== undefined) {
      commands.push(['HSET', `subscription:${id}`, 'enabled', enabled.toString()]);
    }

    commands.push(['HSET', `subscription:${id}`, 'updated_at', now.toString()]);
    commands.push(['HSET', `subscription:${id}:meta`, 'updated_at', now.toString()]);

    // 清除缓存
    cache.delete(`subscription:${id}`);

    results.push({ success: true, id, updated_at: now });
  }

  if (commands.length > 0) {
    await redis.pipeline(commands);
    timer.checkpoint('redis_batch_update');
  }

  cache.delete('subscriptions:list');

  return results;
}

/**
 * 批量删除订阅
 */
async function batchDelete(redis, cache, items, timer) {
  const results = [];
  const commands = [];

  for (const item of items) {
    const { id } = item;

    if (!id) {
      results.push({ success: false, error: 'Missing id', item });
      continue;
    }

    const exists = await redis.exists(`subscription:${id}`);
    if (!exists) {
      results.push({ success: false, error: 'Subscription not found', item });
      continue;
    }

    commands.push(['DEL', `subscription:${id}`]);
    commands.push(['DEL', `subscription:${id}:meta`]);
    commands.push(['DEL', `subscription:${id}:stats`]);

    // 清除缓存
    cache.delete(`subscription:${id}`);
    cache.deletePattern(`download:${id}:*`);

    results.push({ success: true, id });
  }

  if (commands.length > 0) {
    await redis.pipeline(commands);
    timer.checkpoint('redis_batch_delete');
  }

  cache.delete('subscriptions:list');

  return results;
}

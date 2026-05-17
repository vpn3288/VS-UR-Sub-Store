/**
 * Webhook 通知 API
 * 路由: /api/webhook
 * 
 * 支持订阅更新、节点变化等事件通知
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { 
  handleCORS, 
  errorResponse, 
  successResponse,
  generateId,
  log,
} = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();

  try {
    const { method } = req;
    const { id } = req.query;

    // GET /api/webhook - 列出所有 webhook
    if (method === 'GET' && !id) {
      return await listWebhooks(redis, res);
    }

    // GET /api/webhook?id=xxx - 获取单个 webhook
    if (method === 'GET' && id) {
      return await getWebhook(redis, id, res);
    }

    // POST /api/webhook - 创建 webhook
    if (method === 'POST') {
      return await createWebhook(redis, req, res);
    }

    // PUT /api/webhook?id=xxx - 更新 webhook
    if (method === 'PUT' && id) {
      return await updateWebhook(redis, id, req, res);
    }

    // DELETE /api/webhook?id=xxx - 删除 webhook
    if (method === 'DELETE' && id) {
      return await deleteWebhook(redis, id, res);
    }

    errorResponse(res, 405, 'Method not allowed');
  } catch (error) {
    log('error', 'Webhook API error', { error: error.message });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 列出所有 webhook
 */
async function listWebhooks(redis, res) {
  try {
    const listData = await redis.get('webhooks:list');
    const webhooks = listData ? JSON.parse(listData) : [];
    return successResponse(res, webhooks);
  } catch (error) {
    return errorResponse(res, 503, 'Failed to list webhooks', error.message);
  }
}

/**
 * 获取单个 webhook
 */
async function getWebhook(redis, id, res) {
  try {
    const data = await redis.hgetall(`webhook:${id}`);
    
    if (!data || Object.keys(data).length === 0) {
      return errorResponse(res, 404, 'Webhook not found');
    }

    const webhook = {
      id: data.id,
      name: data.name,
      url: data.url,
      events: JSON.parse(data.events || '[]'),
      enabled: data.enabled === 'true',
      created_at: parseInt(data.created_at, 10),
    };

    return successResponse(res, webhook);
  } catch (error) {
    return errorResponse(res, 503, 'Failed to get webhook', error.message);
  }
}

/**
 * 创建 webhook
 */
async function createWebhook(redis, req, res) {
  const { name, url, events = [], enabled = true } = req.body || {};

  if (!name || !url) {
    return errorResponse(res, 400, 'Missing required fields: name, url');
  }

  if (!isValidWebhookUrl(url)) {
    return errorResponse(res, 400, 'Invalid webhook URL');
  }

  try {
    const id = generateId('webhook');
    const now = Date.now();

    await redis.pipeline([
      ['HSET', `webhook:${id}`, 'id', id],
      ['HSET', `webhook:${id}`, 'name', name],
      ['HSET', `webhook:${id}`, 'url', url],
      ['HSET', `webhook:${id}`, 'events', JSON.stringify(events)],
      ['HSET', `webhook:${id}`, 'enabled', enabled.toString()],
      ['HSET', `webhook:${id}`, 'created_at', now.toString()],
    ]);

    // 更新列表
    const listData = await redis.get('webhooks:list');
    const list = listData ? JSON.parse(listData) : [];
    list.push({ id, name, enabled });
    await redis.set('webhooks:list', JSON.stringify(list));

    log('info', 'Webhook created', { id, name, url, events });

    return successResponse(res, { id, name, url, events, enabled, created_at: now }, { created: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to create webhook', error.message);
  }
}

/**
 * 更新 webhook
 */
async function updateWebhook(redis, id, req, res) {
  const { name, url, events, enabled } = req.body || {};

  try {
    const exists = await redis.exists(`webhook:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Webhook not found');
    }

    const updates = [];

    if (name !== undefined) updates.push(['HSET', `webhook:${id}`, 'name', name]);
    if (url !== undefined) {
      if (!isValidWebhookUrl(url)) {
        return errorResponse(res, 400, 'Invalid webhook URL');
      }
      updates.push(['HSET', `webhook:${id}`, 'url', url]);
    }
    if (events !== undefined) updates.push(['HSET', `webhook:${id}`, 'events', JSON.stringify(events)]);
    if (enabled !== undefined) updates.push(['HSET', `webhook:${id}`, 'enabled', enabled.toString()]);

    if (updates.length > 0) {
      await redis.pipeline(updates);
    }

    log('info', 'Webhook updated', { id });

    return successResponse(res, { id }, { updated: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to update webhook', error.message);
  }
}

/**
 * 删除 webhook
 */
async function deleteWebhook(redis, id, res) {
  try {
    const exists = await redis.exists(`webhook:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Webhook not found');
    }

    await redis.del(`webhook:${id}`);

    // 更新列表
    const listData = await redis.get('webhooks:list');
    const list = listData ? JSON.parse(listData) : [];
    const filtered = list.filter(item => item.id !== id);
    await redis.set('webhooks:list', JSON.stringify(filtered));

    log('info', 'Webhook deleted', { id });

    return successResponse(res, { id }, { deleted: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to delete webhook', error.message);
  }
}

/**
 * 验证 webhook URL
 */
function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 触发 webhook（供其他模块调用）
 */
async function triggerWebhook(redis, event, payload) {
  try {
    const listData = await redis.get('webhooks:list');
    const webhooks = listData ? JSON.parse(listData) : [];

    for (const webhook of webhooks) {
      if (!webhook.enabled) continue;

      const data = await redis.hgetall(`webhook:${webhook.id}`);
      const events = JSON.parse(data.events || '[]');

      if (events.includes(event) || events.includes('*')) {
        // 发送 webhook
        try {
          await fetch(data.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': event,
            },
            body: JSON.stringify({
              event,
              timestamp: new Date().toISOString(),
              payload,
            }),
            signal: AbortSignal.timeout(10000),
          });

          log('info', 'Webhook triggered', { id: webhook.id, event });
        } catch (error) {
          log('error', 'Webhook trigger failed', { id: webhook.id, event, error: error.message });
        }
      }
    }
  } catch (error) {
    log('error', 'Webhook trigger error', { event, error: error.message });
  }
}

module.exports.triggerWebhook = triggerWebhook;

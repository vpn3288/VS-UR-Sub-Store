/**
 * 订阅模板 API
 * 路由: /api/templates
 * 
 * 管理 Clash/Surge 配置模板
 */

const UpstashRedis = require('../lib/redis');
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

    if (method === 'GET' && !id) {
      return await listTemplates(redis, res);
    }

    if (method === 'GET' && id) {
      return await getTemplate(redis, id, res);
    }

    if (method === 'POST') {
      return await createTemplate(redis, req, res);
    }

    if (method === 'PUT' && id) {
      return await updateTemplate(redis, id, req, res);
    }

    if (method === 'DELETE' && id) {
      return await deleteTemplate(redis, id, res);
    }

    errorResponse(res, 405, 'Method not allowed');
  } catch (error) {
    log('error', 'Template API error', { error: error.message });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 列出所有模板
 */
async function listTemplates(redis, res) {
  try {
    const listData = await redis.get('templates:list');
    const templates = listData ? JSON.parse(listData) : getDefaultTemplates();
    return successResponse(res, templates);
  } catch (error) {
    return successResponse(res, getDefaultTemplates(), { source: 'default' });
  }
}

/**
 * 获取单个模板
 */
async function getTemplate(redis, id, res) {
  try {
    const data = await redis.hgetall(`template:${id}`);
    
    if (!data || Object.keys(data).length === 0) {
      // 返回默认模板
      const defaultTemplates = getDefaultTemplates();
      const defaultTemplate = defaultTemplates.find(t => t.id === id);
      
      if (defaultTemplate) {
        return successResponse(res, defaultTemplate, { source: 'default' });
      }
      
      return errorResponse(res, 404, 'Template not found');
    }

    const template = {
      id: data.id,
      name: data.name,
      type: data.type,
      content: data.content,
      description: data.description,
      created_at: parseInt(data.created_at, 10),
    };

    return successResponse(res, template);
  } catch (error) {
    return errorResponse(res, 503, 'Failed to get template', error.message);
  }
}

/**
 * 创建模板
 */
async function createTemplate(redis, req, res) {
  const { name, type, content, description = '' } = req.body || {};

  if (!name || !type || !content) {
    return errorResponse(res, 400, 'Missing required fields: name, type, content');
  }

  if (!['clash', 'surge'].includes(type)) {
    return errorResponse(res, 400, 'Invalid type, must be clash or surge');
  }

  try {
    const id = generateId('template');
    const now = Date.now();

    await redis.pipeline([
      ['HSET', `template:${id}`, 'id', id],
      ['HSET', `template:${id}`, 'name', name],
      ['HSET', `template:${id}`, 'type', type],
      ['HSET', `template:${id}`, 'content', content],
      ['HSET', `template:${id}`, 'description', description],
      ['HSET', `template:${id}`, 'created_at', now.toString()],
    ]);

    // 更新列表
    const listData = await redis.get('templates:list');
    const list = listData ? JSON.parse(listData) : [];
    list.push({ id, name, type, description });
    await redis.set('templates:list', JSON.stringify(list));

    log('info', 'Template created', { id, name, type });

    return successResponse(res, { id, name, type, description, created_at: now }, { created: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to create template', error.message);
  }
}

/**
 * 更新模板
 */
async function updateTemplate(redis, id, req, res) {
  const { name, content, description } = req.body || {};

  try {
    const exists = await redis.exists(`template:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Template not found');
    }

    const updates = [];

    if (name !== undefined) updates.push(['HSET', `template:${id}`, 'name', name]);
    if (content !== undefined) updates.push(['HSET', `template:${id}`, 'content', content]);
    if (description !== undefined) updates.push(['HSET', `template:${id}`, 'description', description]);

    if (updates.length > 0) {
      await redis.pipeline(updates);
    }

    log('info', 'Template updated', { id });

    return successResponse(res, { id }, { updated: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to update template', error.message);
  }
}

/**
 * 删除模板
 */
async function deleteTemplate(redis, id, res) {
  try {
    const exists = await redis.exists(`template:${id}`);
    if (!exists) {
      return errorResponse(res, 404, 'Template not found');
    }

    await redis.del(`template:${id}`);

    // 更新列表
    const listData = await redis.get('templates:list');
    const list = listData ? JSON.parse(listData) : [];
    const filtered = list.filter(item => item.id !== id);
    await redis.set('templates:list', JSON.stringify(filtered));

    log('info', 'Template deleted', { id });

    return successResponse(res, { id }, { deleted: true });
  } catch (error) {
    return errorResponse(res, 503, 'Failed to delete template', error.message);
  }
}

/**
 * 获取默认模板
 */
function getDefaultTemplates() {
  return [
    {
      id: 'clash-basic',
      name: 'Clash 基础模板',
      type: 'clash',
      description: '包含基本的代理组和规则',
      content: \`port: 7890
socks-port: 7891
allow-lan: false
mode: Rule
log-level: info
external-controller: 127.0.0.1:9090

proxy-groups:
  - name: "🚀 节点选择"
    type: select
    proxies:
      - "♻️ 自动选择"
      - DIRECT

  - name: "♻️ 自动选择"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300

rules:
  - DOMAIN-SUFFIX,google.com,🚀 节点选择
  - GEOIP,CN,DIRECT
  - MATCH,🚀 节点选择\`,
    },
    {
      id: 'surge-basic',
      name: 'Surge 基础模板',
      type: 'surge',
      description: '包含基本的代理组和规则',
      content: \`[General]
loglevel = notify
dns-server = system, 223.5.5.5

[Proxy Group]
🚀 节点选择 = select, ♻️ 自动选择, DIRECT
♻️ 自动选择 = url-test, url = http://www.gstatic.com/generate_204, interval = 300

[Rule]
DOMAIN-SUFFIX,google.com,🚀 节点选择
GEOIP,CN,DIRECT
FINAL,🚀 节点选择\`,
    },
  ];
}

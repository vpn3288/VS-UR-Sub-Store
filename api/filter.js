/**
 * 节点过滤和规则 API
 * 路由: /api/filter
 * 
 * 支持按关键词、地区、协议过滤节点
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const SubscriptionConverter = require('../lib/converter');
const { 
  handleCORS, 
  errorResponse, 
  successResponse,
  log,
} = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { method } = req;

    if (method === 'POST') {
      return await applyFilter(redis, cache, req, res);
    }

    if (method === 'GET') {
      return await listFilters(redis, res);
    }

    errorResponse(res, 405, 'Method not allowed');
  } catch (error) {
    log('error', 'Filter API error', { error: error.message });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 应用过滤规则
 */
async function applyFilter(redis, cache, req, res) {
  const { subscriptionId, rules } = req.body || {};

  if (!subscriptionId || !rules) {
    return errorResponse(res, 400, 'Missing required fields: subscriptionId, rules');
  }

  try {
    // 获取订阅配置
    const data = await redis.hgetall(`subscription:${subscriptionId}`);
    if (!data || Object.keys(data).length === 0) {
      return errorResponse(res, 404, 'Subscription not found');
    }

    // 获取订阅内容
    const cacheKey = `download:${subscriptionId}:auto:false`;
    let content = cache.get(cacheKey);

    if (!content) {
      // 从上游拉取
      const upstreamResponse = await fetch(data.url, {
        signal: AbortSignal.timeout(15000),
      });
      content = await upstreamResponse.text();
    }

    // 解析节点
    const format = SubscriptionConverter.detectFormat(content);
    let nodes = [];

    switch (format) {
      case 'base64':
        nodes = SubscriptionConverter.parseBase64(content);
        break;
      case 'clash':
        nodes = SubscriptionConverter.parseClash(content);
        break;
      case 'surge':
        nodes = SubscriptionConverter.parseSurge(content);
        break;
      case 'uri':
        nodes = SubscriptionConverter.parseURI(content);
        break;
      default:
        return errorResponse(res, 400, 'Unsupported subscription format');
    }

    // 应用过滤规则
    const filteredNodes = filterNodes(nodes, rules);

    log('info', 'Filter applied', {
      subscriptionId,
      originalCount: nodes.length,
      filteredCount: filteredNodes.length,
      rules,
    });

    return successResponse(res, {
      originalCount: nodes.length,
      filteredCount: filteredNodes.length,
      nodes: filteredNodes,
    });

  } catch (error) {
    log('error', 'Filter apply failed', { subscriptionId, error: error.message });
    return errorResponse(res, 503, 'Failed to apply filter', error.message);
  }
}

/**
 * 过滤节点
 */
function filterNodes(nodes, rules) {
  let filtered = [...nodes];

  // 关键词过滤
  if (rules.include && rules.include.length > 0) {
    filtered = filtered.filter(node => {
      return rules.include.some(keyword => 
        node.name.toLowerCase().includes(keyword.toLowerCase())
      );
    });
  }

  if (rules.exclude && rules.exclude.length > 0) {
    filtered = filtered.filter(node => {
      return !rules.exclude.some(keyword => 
        node.name.toLowerCase().includes(keyword.toLowerCase())
      );
    });
  }

  // 地区过滤
  if (rules.regions && rules.regions.length > 0) {
    const regionKeywords = {
      'hk': ['香港', 'hong kong', 'hk'],
      'tw': ['台湾', 'taiwan', 'tw'],
      'sg': ['新加坡', 'singapore', 'sg'],
      'jp': ['日本', 'japan', 'jp'],
      'us': ['美国', 'united states', 'us'],
      'kr': ['韩国', 'korea', 'kr'],
    };

    filtered = filtered.filter(node => {
      return rules.regions.some(region => {
        const keywords = regionKeywords[region.toLowerCase()] || [region];
        return keywords.some(keyword => 
          node.name.toLowerCase().includes(keyword.toLowerCase())
        );
      });
    });
  }

  // 协议过滤
  if (rules.protocols && rules.protocols.length > 0) {
    filtered = filtered.filter(node => 
      rules.protocols.includes(node.type)
    );
  }

  // 端口过滤
  if (rules.portRange) {
    const [minPort, maxPort] = rules.portRange;
    filtered = filtered.filter(node => 
      node.port >= minPort && node.port <= maxPort
    );
  }

  // 去重（按名称）
  if (rules.deduplicate) {
    const seen = new Set();
    filtered = filtered.filter(node => {
      if (seen.has(node.name)) {
        return false;
      }
      seen.add(node.name);
      return true;
    });
  }

  // 限制数量
  if (rules.limit && rules.limit > 0) {
    filtered = filtered.slice(0, rules.limit);
  }

  return filtered;
}

/**
 * 列出所有过滤规则（预设）
 */
async function listFilters(redis, res) {
  const presets = {
    'hk-only': {
      name: '仅香港节点',
      rules: {
        regions: ['hk'],
      },
    },
    'no-cn': {
      name: '排除中国节点',
      rules: {
        exclude: ['cn', '中国', 'china'],
      },
    },
    'ss-only': {
      name: '仅 Shadowsocks',
      rules: {
        protocols: ['ss'],
      },
    },
    'top-10': {
      name: '前 10 个节点',
      rules: {
        limit: 10,
      },
    },
    'deduplicated': {
      name: '去重节点',
      rules: {
        deduplicate: true,
      },
    },
  };

  return successResponse(res, presets);
}

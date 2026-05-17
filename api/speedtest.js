/**
 * 节点测速 API
 * 路由: /api/speedtest
 * 
 * 测试节点延迟和可用性
 */

const UpstashRedis = require('../lib/redis');
const { getCache } = require('../lib/cache');
const { 
  handleCORS, 
  errorResponse, 
  successResponse,
  log,
  PerformanceTimer,
} = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const redis = new UpstashRedis();
  const cache = getCache();

  try {
    const { method } = req;

    if (method === 'POST') {
      return await testNodes(redis, cache, req, res);
    }

    if (method === 'GET') {
      const { subscriptionId } = req.query;
      if (subscriptionId) {
        return await getTestResults(redis, subscriptionId, res);
      }
    }

    errorResponse(res, 405, 'Method not allowed');
  } catch (error) {
    log('error', 'Speedtest API error', { error: error.message });
    errorResponse(res, 500, 'Internal server error', error.message);
  }
};

/**
 * 测试节点
 */
async function testNodes(redis, cache, req, res) {
  const { nodes, testUrl = 'http://www.gstatic.com/generate_204', timeout = 5000 } = req.body || {};

  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return errorResponse(res, 400, 'Missing or invalid nodes array');
  }

  const results = [];

  for (const node of nodes) {
    const timer = new PerformanceTimer(`test_${node.name}`);
    
    try {
      // 简化的延迟测试（实际需要通过代理连接）
      // 这里只是示例，真实环境需要配置代理客户端
      const testResult = await testNodeLatency(node, testUrl, timeout);
      
      results.push({
        name: node.name,
        server: node.server,
        port: node.port,
        type: node.type,
        latency: testResult.latency,
        available: testResult.available,
        error: testResult.error,
      });

      timer.checkpoint('test_complete');
    } catch (error) {
      results.push({
        name: node.name,
        server: node.server,
        port: node.port,
        type: node.type,
        latency: -1,
        available: false,
        error: error.message,
      });
    }
  }

  // 按延迟排序
  results.sort((a, b) => {
    if (!a.available) return 1;
    if (!b.available) return -1;
    return a.latency - b.latency;
  });

  log('info', 'Speedtest completed', {
    total: nodes.length,
    available: results.filter(r => r.available).length,
  });

  return successResponse(res, {
    total: nodes.length,
    available: results.filter(r => r.available).length,
    results,
  });
}

/**
 * 测试单个节点延迟（简化版）
 */
async function testNodeLatency(node, testUrl, timeout) {
  const startTime = Date.now();
  
  try {
    // 注意：这里只是测试服务器的 TCP 连接
    // 真实的代理测试需要通过代理协议连接
    const response = await fetch(`http://${node.server}:${node.port}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    }).catch(() => {
      // 如果直接连接失败，尝试 ping 测试 URL
      return fetch(testUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeout),
      });
    });

    const latency = Date.now() - startTime;

    return {
      latency,
      available: true,
      error: null,
    };
  } catch (error) {
    return {
      latency: -1,
      available: false,
      error: error.message,
    };
  }
}

/**
 * 获取测试结果（从缓存）
 */
async function getTestResults(redis, subscriptionId, res) {
  try {
    const cacheKey = `speedtest:${subscriptionId}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      return successResponse(res, cached, { source: 'cache' });
    }

    // 从 Redis 读取
    const data = await redis.get(cacheKey);
    if (data) {
      const results = JSON.parse(data);
      cache.set(cacheKey, results, 300);
      return successResponse(res, results, { source: 'redis' });
    }

    return errorResponse(res, 404, 'No test results found');
  } catch (error) {
    return errorResponse(res, 503, 'Failed to get test results', error.message);
  }
}

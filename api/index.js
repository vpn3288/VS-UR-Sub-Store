/**
 * 根路由 API
 * 路由: /api 或 /
 */

const { handleCORS, successResponse } = require('../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const info = {
    name: 'VS-UR-Sub-Store',
    description: 'Vercel Serverless + Upstash Redis 的 Sub-Store 后端同步方案',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      subscriptions: {
        list: 'GET /api/subscriptions',
        get: 'GET /api/subscriptions?id={id}',
        create: 'POST /api/subscriptions',
        update: 'PUT /api/subscriptions?id={id}',
        delete: 'DELETE /api/subscriptions?id={id}',
      },
      download: 'GET /api/download/{id}',
      cache: {
        stats: 'GET /api/cache/stats',
        clear: 'POST /api/cache/clear',
      },
    },
    features: [
      '无状态 REST 读写引擎（避免连接池泄露）',
      '内存级读写穿透缓存（热启动 <10ms）',
      '异常捕获与回退机制（优雅降级）',
      '跨域与 Header 伪装（模拟常规流量）',
    ],
    architecture: {
      runtime: 'Vercel Node.js 18.x Serverless',
      storage: 'Upstash Redis (REST API)',
      cache: 'In-Memory (热启动保留)',
    },
  };

  return successResponse(res, info);
};

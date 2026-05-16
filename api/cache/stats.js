/**
 * 缓存统计 API
 * 路由: /api/cache/stats
 */

const { getCache } = require('../../lib/cache');
const { handleCORS, successResponse } = require('../../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  const cache = getCache();
  const stats = cache.stats();

  const detailedStats = {
    ...stats,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };

  return successResponse(res, detailedStats);
};

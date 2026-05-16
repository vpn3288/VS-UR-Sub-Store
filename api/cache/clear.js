/**
 * 清除缓存 API
 * 路由: POST /api/cache/clear
 */

const { getCache } = require('../../lib/cache');
const { handleCORS, successResponse, errorResponse } = require('../../lib/utils');

module.exports = async (req, res) => {
  if (handleCORS(req, res)) return;

  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  const cache = getCache();
  const beforeStats = cache.stats();
  
  cache.clear();
  
  const afterStats = cache.stats();

  return successResponse(res, {
    cleared: true,
    before: beforeStats,
    after: afterStats,
  });
};

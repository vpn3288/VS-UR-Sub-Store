/**
 * 工具函数库
 */

/**
 * 清洗客户端 Header，移除特异性标识
 */
function sanitizeHeaders(headers) {
  const sanitized = {};
  const blocklist = [
    'x-clash-client-id',
    'x-surge-skip-scripting',
    'x-quantumult-x',
    'user-agent', // 将被替换
  ];

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (!blocklist.includes(lowerKey)) {
      sanitized[key] = value;
    }
  }

  // 伪装为常规浏览器
  sanitized['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  return sanitized;
}

/**
 * 处理 CORS 预检请求
 */
function handleCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

/**
 * 统一错误响应
 */
function errorResponse(res, statusCode, message, details = null) {
  const response = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    response.details = details;
  }

  res.status(statusCode).json(response);
}

/**
 * 统一成功响应
 */
function successResponse(res, data, meta = {}) {
  res.status(200).json({
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
}

/**
 * 验证订阅 URL 格式
 */
function isValidSubscriptionUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 生成唯一 ID
 */
function generateId(prefix = 'sub') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 安全的 JSON 解析
 */
function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = {
  sanitizeHeaders,
  handleCORS,
  errorResponse,
  successResponse,
  isValidSubscriptionUrl,
  generateId,
  safeJsonParse,
};

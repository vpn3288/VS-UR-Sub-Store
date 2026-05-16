/**
 * 工具函数库（增强版）
 * 新增：速率限制、请求签名、日志记录、性能监控
 */

// ========== 速率限制 ==========

class RateLimiter {
  constructor() {
    this.requests = new Map(); // IP -> [timestamps]
    this.windowMs = 60000; // 1分钟窗口
    this.maxRequests = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
  }

  /**
   * 检查是否超过速率限制
   */
  check(identifier) {
    const now = Date.now();
    const timestamps = this.requests.get(identifier) || [];

    // 清理过期的时间戳
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

    if (validTimestamps.length >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(validTimestamps[0] + this.windowMs),
      };
    }

    validTimestamps.push(now);
    this.requests.set(identifier, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - validTimestamps.length,
      resetAt: new Date(now + this.windowMs),
    };
  }

  /**
   * 清理过期数据（定期调用）
   */
  cleanup() {
    const now = Date.now();
    for (const [identifier, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, valid);
      }
    }
  }
}

// 全局速率限制器
let globalRateLimiter = null;
function getRateLimiter() {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter();
    // 每5分钟清理一次
    setInterval(() => globalRateLimiter.cleanup(), 300000);
  }
  return globalRateLimiter;
}

// ========== Header 处理 ==========

/**
 * 清洗客户端 Header，移除特异性标识
 */
function sanitizeHeaders(headers) {
  const sanitized = {};
  const blocklist = [
    'x-clash-client-id',
    'x-surge-skip-scripting',
    'x-quantumult-x',
    'x-shadowrocket',
    'user-agent', // 将被替换
    'x-forwarded-for',
    'x-real-ip',
  ];

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (!blocklist.includes(lowerKey)) {
      sanitized[key] = value;
    }
  }

  // 伪装为常规浏览器
  sanitized['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  sanitized['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  sanitized['Accept-Language'] = 'en-US,en;q=0.9';
  
  return sanitized;
}

/**
 * 获取客户端真实 IP
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         'unknown';
}

// ========== CORS 处理 ==========

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

// ========== 响应处理 ==========

/**
 * 统一错误响应
 */
function errorResponse(res, statusCode, message, details = null) {
  const response = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };

  if (details && process.env.NODE_ENV !== 'production') {
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

// ========== 验证函数 ==========

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
 * 验证订阅 ID 格式
 */
function isValidSubscriptionId(id) {
  return /^sub_\d+_[a-z0-9]+$/.test(id);
}

// ========== ID 生成 ==========

/**
 * 生成唯一 ID
 */
function generateId(prefix = 'sub') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ========== JSON 处理 ==========

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

/**
 * 安全的 JSON 字符串化
 */
function safeJsonStringify(obj, fallback = '{}') {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback;
  }
}

// ========== 日志记录 ==========

/**
 * 结构化日志
 */
function log(level, message, meta = {}) {
  const logEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const logString = JSON.stringify(logEntry);

  switch (level) {
    case 'error':
      console.error(logString);
      break;
    case 'warn':
      console.warn(logString);
      break;
    case 'info':
      console.info(logString);
      break;
    default:
      console.log(logString);
  }
}

// ========== 性能监控 ==========

/**
 * 性能计时器
 */
class PerformanceTimer {
  constructor(name) {
    this.name = name;
    this.startTime = Date.now();
    this.checkpoints = [];
  }

  checkpoint(label) {
    const now = Date.now();
    this.checkpoints.push({
      label,
      elapsed: now - this.startTime,
      timestamp: now,
    });
  }

  end() {
    const totalTime = Date.now() - this.startTime;
    return {
      name: this.name,
      totalTime: `${totalTime}ms`,
      checkpoints: this.checkpoints,
    };
  }
}

// ========== 请求签名（可选） ==========

/**
 * 生成请求签名（用于验证请求来源）
 */
function generateSignature(data, secret) {
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', secret || process.env.API_SECRET || 'default-secret')
    .update(JSON.stringify(data))
    .digest('hex');
}

/**
 * 验证请求签名
 */
function verifySignature(data, signature, secret) {
  const expected = generateSignature(data, secret);
  return signature === expected;
}

// ========== 数据清洗 ==========

/**
 * 清洗订阅内容（移除敏感信息）
 */
function sanitizeSubscriptionContent(content) {
  // 移除可能的追踪参数
  return content
    .replace(/&?token=[^&\s]+/gi, '')
    .replace(/&?uuid=[^&\s]+/gi, '')
    .replace(/&?user=[^&\s]+/gi, '');
}

module.exports = {
  // 速率限制
  getRateLimiter,
  
  // Header 处理
  sanitizeHeaders,
  getClientIP,
  
  // CORS
  handleCORS,
  
  // 响应
  errorResponse,
  successResponse,
  
  // 验证
  isValidSubscriptionUrl,
  isValidSubscriptionId,
  
  // ID 生成
  generateId,
  
  // JSON
  safeJsonParse,
  safeJsonStringify,
  
  // 日志
  log,
  
  // 性能
  PerformanceTimer,
  
  // 签名
  generateSignature,
  verifySignature,
  
  // 数据清洗
  sanitizeSubscriptionContent,
};

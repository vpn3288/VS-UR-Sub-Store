/**
 * Upstash Redis REST API 客户端（增强版）
 * 使用原生 fetch，避免连接池泄露
 * 新增：批量操作、管道、重试机制
 */

class UpstashRedis {
  constructor() {
    this.url = process.env.UPSTASH_REDIS_REST_URL;
    this.token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!this.url || !this.token) {
      throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
    }

    // 重试配置
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1秒
  }

  /**
   * 执行 Redis 命令（带重试）
   * @param {string[]} command - Redis 命令数组，如 ['GET', 'key']
   * @param {number} retries - 当前重试次数
   * @returns {Promise<any>}
   */
  async execute(command, retries = 0) {
    try {
      const response = await fetch(`${this.url}/${command.join('/')}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
        signal: AbortSignal.timeout(5000), // 5秒超时
      });

      if (!response.ok) {
        throw new Error(`Upstash API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      // 重试逻辑
      if (retries < this.maxRetries && this.shouldRetry(error)) {
        console.warn(`Redis execute failed, retrying (${retries + 1}/${this.maxRetries})...`);
        await this.sleep(this.retryDelay * Math.pow(2, retries)); // 指数退避
        return this.execute(command, retries + 1);
      }

      if (error.name === 'AbortError') {
        throw new Error('Upstash API timeout');
      }
      throw error;
    }
  }

  /**
   * POST 方式执行命令（用于复杂命令和批量操作）
   */
  async executePost(commands, retries = 0) {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(10000), // 批量操作延长到10秒
      });

      if (!response.ok) {
        throw new Error(`Upstash API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (retries < this.maxRetries && this.shouldRetry(error)) {
        console.warn(`Redis executePost failed, retrying (${retries + 1}/${this.maxRetries})...`);
        await this.sleep(this.retryDelay * Math.pow(2, retries));
        return this.executePost(commands, retries + 1);
      }

      if (error.name === 'AbortError') {
        throw new Error('Upstash API timeout');
      }
      throw error;
    }
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(error) {
    // 网络错误、超时、5xx 错误应该重试
    return error.name === 'AbortError' || 
           error.message.includes('500') || 
           error.message.includes('502') ||
           error.message.includes('503') ||
           error.message.includes('504');
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========== 基础命令 ==========

  async get(key) {
    return await this.execute(['GET', key]);
  }

  async set(key, value, expirySeconds = null) {
    const commands = ['SET', key, value];
    if (expirySeconds) {
      commands.push('EX', expirySeconds.toString());
    }
    return await this.execute(commands);
  }

  async del(key) {
    return await this.execute(['DEL', key]);
  }

  async exists(key) {
    return await this.execute(['EXISTS', key]);
  }

  async ttl(key) {
    return await this.execute(['TTL', key]);
  }

  async expire(key, seconds) {
    return await this.execute(['EXPIRE', key, seconds.toString()]);
  }

  // ========== Hash 命令 ==========

  async hget(key, field) {
    return await this.execute(['HGET', key, field]);
  }

  async hset(key, field, value) {
    return await this.execute(['HSET', key, field, value]);
  }

  async hgetall(key) {
    const result = await this.execute(['HGETALL', key]);
    if (!result) return {};
    
    // 将数组转换为对象 [k1, v1, k2, v2] -> {k1: v1, k2: v2}
    const obj = {};
    for (let i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1];
    }
    return obj;
  }

  async hdel(key, field) {
    return await this.execute(['HDEL', key, field]);
  }

  async hmset(key, fieldValuePairs) {
    const commands = ['HMSET', key];
    for (const [field, value] of Object.entries(fieldValuePairs)) {
      commands.push(field, value);
    }
    return await this.execute(commands);
  }

  // ========== List 命令 ==========

  async lpush(key, value) {
    return await this.execute(['LPUSH', key, value]);
  }

  async rpush(key, value) {
    return await this.execute(['RPUSH', key, value]);
  }

  async lrange(key, start, stop) {
    return await this.execute(['LRANGE', key, start.toString(), stop.toString()]);
  }

  async llen(key) {
    return await this.execute(['LLEN', key]);
  }

  // ========== Set 命令 ==========

  async sadd(key, member) {
    return await this.execute(['SADD', key, member]);
  }

  async smembers(key) {
    return await this.execute(['SMEMBERS', key]);
  }

  async sismember(key, member) {
    return await this.execute(['SISMEMBER', key, member]);
  }

  // ========== 批量操作（管道） ==========

  /**
   * 批量获取多个 key
   */
  async mget(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return [];
    }
    return await this.execute(['MGET', ...keys]);
  }

  /**
   * 批量设置多个 key
   */
  async mset(keyValuePairs) {
    const commands = ['MSET'];
    for (const [key, value] of Object.entries(keyValuePairs)) {
      commands.push(key, value);
    }
    return await this.execute(commands);
  }

  /**
   * 批量删除多个 key
   */
  async mdel(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return 0;
    }
    return await this.execute(['DEL', ...keys]);
  }

  /**
   * 管道操作（一次性执行多个命令）
   */
  async pipeline(commands) {
    return await this.executePost(commands);
  }

  // ========== 高级功能 ==========

  /**
   * 原子性递增
   */
  async incr(key) {
    return await this.execute(['INCR', key]);
  }

  /**
   * 原子性递减
   */
  async decr(key) {
    return await this.execute(['DECR', key]);
  }

  /**
   * 设置带 NX 选项（仅当 key 不存在时设置）
   */
  async setnx(key, value, expirySeconds = null) {
    const commands = ['SET', key, value, 'NX'];
    if (expirySeconds) {
      commands.push('EX', expirySeconds.toString());
    }
    return await this.execute(commands);
  }

  /**
   * 获取并设置（原子操作）
   */
  async getset(key, value) {
    return await this.execute(['GETSET', key, value]);
  }
}

module.exports = UpstashRedis;

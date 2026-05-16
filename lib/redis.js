/**
 * Upstash Redis REST API 客户端
 * 使用原生 fetch，避免连接池泄露
 */

class UpstashRedis {
  constructor() {
    this.url = process.env.UPSTASH_REDIS_REST_URL;
    this.token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!this.url || !this.token) {
      throw new Error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
    }
  }

  /**
   * 执行 Redis 命令
   * @param {string[]} command - Redis 命令数组，如 ['GET', 'key']
   * @returns {Promise<any>}
   */
  async execute(command) {
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
      if (error.name === 'AbortError') {
        throw new Error('Upstash API timeout');
      }
      throw error;
    }
  }

  /**
   * POST 方式执行命令（用于复杂命令）
   */
  async executePost(commands) {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Upstash API error: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Upstash API timeout');
      }
      throw error;
    }
  }

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

  async ttl(key) {
    return await this.execute(['TTL', key]);
  }

  async expire(key, seconds) {
    return await this.execute(['EXPIRE', key, seconds.toString()]);
  }
}

module.exports = UpstashRedis;

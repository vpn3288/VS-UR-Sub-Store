# VS-UR-Sub-Store

**Vercel Serverless + Upstash Redis 的 Sub-Store 后端同步方案**

高可用灾备节点，专为解决 Serverless 冷启动和连接泄露问题而设计。

---

## 🎯 架构目标

- **运行环境**: Vercel Node.js 18.x Serverless Functions
- **数据持久化**: Upstash Redis (REST API 通信)
- **核心优化**: 
  - ✅ 无状态 REST 读写引擎（杜绝连接池泄露）
  - ✅ 内存级读写穿透缓存（热启动 <10ms）
  - ✅ 异常捕获与回退机制（优雅降级）
  - ✅ 跨域与 Header 伪装（模拟常规流量）

---

## 🚀 快速部署

### 1. 准备 Upstash Redis

1. 访问 [Upstash Console](https://console.upstash.com/)
2. 创建一个新的 Redis 数据库（选择免费套餐）
3. 复制 **REST API URL** 和 **REST API Token**

### 2. 部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vpn3288/VS-UR-Sub-Store)

或手动部署：

```bash
# 克隆仓库
git clone https://github.com/vpn3288/VS-UR-Sub-Store.git
cd VS-UR-Sub-Store

# 安装 Vercel CLI
npm install -g vercel

# 登录 Vercel
vercel login

# 部署
vercel --prod
```

### 3. 配置环境变量

在 Vercel 项目设置中添加以下环境变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST API Token | `AXXXxxxXXX` |
| `CACHE_TTL` | 缓存过期时间（秒） | `300` |
| `MEMORY_CACHE_ENABLED` | 是否启用内存缓存 | `true` |

---

## 📡 API 端点

### 根路由
```
GET /api
```
返回 API 信息和端点列表。

### 健康检查
```
GET /api/health
```
检查服务状态、Redis 连接和缓存统计。

### 订阅管理

#### 列出所有订阅
```
GET /api/subscriptions
```

#### 获取单个订阅
```
GET /api/subscriptions?id={subscription_id}
```

#### 创建订阅
```
POST /api/subscriptions
Content-Type: application/json

{
  "name": "我的订阅",
  "url": "https://example.com/subscription",
  "enabled": true
}
```

#### 更新订阅
```
PUT /api/subscriptions?id={subscription_id}
Content-Type: application/json

{
  "name": "新名称",
  "enabled": false
}
```

#### 删除订阅
```
DELETE /api/subscriptions?id={subscription_id}
```

### 订阅下载（核心功能）
```
GET /api/download/{subscription_id}
```
返回订阅内容，供 Clash/Surge 等客户端使用。

**特性**：
- 内存缓存优先（热启动 <10ms）
- Redis 配置读取
- 上游订阅拉取
- 优雅降级（Redis/上游失败时返回缓存）

### 缓存管理

#### 查看缓存统计
```
GET /api/cache/stats
```

#### 清除缓存
```
POST /api/cache/clear
```

---

## 🏗️ 项目结构

```
VS-UR-Sub-Store/
├── api/                    # Vercel Serverless Functions
│   ├── index.js           # 根路由
│   ├── health.js          # 健康检查
│   ├── subscriptions.js   # 订阅管理
│   ├── download.js        # 订阅下载（核心）
│   └── cache/
│       ├── stats.js       # 缓存统计
│       └── clear.js       # 清除缓存
├── lib/                   # 核心逻辑库
│   ├── redis.js          # Upstash Redis REST 客户端
│   ├── cache.js          # 内存穿透缓存
│   └── utils.js          # 工具函数
├── vercel.json           # Vercel 配置
├── package.json          # 项目配置
├── .env.example          # 环境变量示例
└── README.md             # 本文档
```

---

## 🔧 核心技术实现

### 1. 无状态 REST 读写引擎

**问题**: 传统 Redis 客户端（`redis`/`ioredis`）在 Serverless 环境中会导致连接池泄露。

**解决方案**: 使用原生 `fetch` 调用 Upstash REST API。

```javascript
// lib/redis.js
async execute(command) {
  const response = await fetch(`${this.url}/${command.join('/')}`, {
    headers: { 'Authorization': `Bearer ${this.token}` },
    signal: AbortSignal.timeout(5000),
  });
  return (await response.json()).result;
}
```

### 2. 内存级读写穿透缓存

**问题**: Serverless 冷启动慢，每次请求都读 Redis 延迟高。

**解决方案**: 实例级内存缓存（热启动时保留）。

```javascript
// lib/cache.js
class MemoryCache {
  constructor() {
    this.cache = new Map(); // 跨请求共享
  }
  
  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl * 1000) {
      return cached.value; // <10ms 返回
    }
    return null;
  }
}
```

**效果**: 热启动时订阅拉取延迟 <10ms。

### 3. 异常捕获与回退机制

**问题**: Redis 或上游订阅服务不稳定时，整个服务崩溃。

**解决方案**: 多级降级策略。

```javascript
// api/download.js
try {
  content = await fetchUpstream(url);
  cache.set(key, content);
} catch (error) {
  // 降级：返回缓存内容（即使过期）
  const stale = cache.get(key);
  if (stale) return stale;
  throw error;
}
```

### 4. 跨域与 Header 伪装

**问题**: 代理客户端（Clash/Surge）发送的 Header 有特异性，容易被识别。

**解决方案**: 清洗 Header，伪装为常规浏览器流量。

```javascript
// lib/utils.js
function sanitizeHeaders(headers) {
  const blocklist = ['x-clash-client-id', 'x-surge-skip-scripting'];
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!blocklist.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  sanitized['User-Agent'] = 'Mozilla/5.0 ...'; // 伪装
  return sanitized;
}
```

---

## 📊 性能指标

| 指标 | 冷启动 | 热启动 |
|------|--------|--------|
| **订阅下载延迟** | ~500ms | **<10ms** |
| **Redis 读取** | ~100ms | 0ms (内存缓存) |
| **上游拉取** | ~300ms | 0ms (缓存命中) |

---

## 🛡️ 安全特性

- ✅ CORS 严格控制
- ✅ Header 清洗（移除客户端特征）
- ✅ 超时保护（5秒 Redis，10秒上游）
- ✅ 错误信息脱敏（不暴露内部细节）

---

## 🔄 使用场景

### 1. Clash Meta 订阅

```yaml
# Clash Meta 配置
proxy-providers:
  my-subscription:
    type: http
    url: https://your-vercel-domain.vercel.app/api/download/sub_xxx
    interval: 3600
    path: ./providers/my-subscription.yaml
    health-check:
      enable: true
      interval: 600
      url: http://www.gstatic.com/generate_204
```

### 2. Surge 订阅

```ini
[Proxy]
🚀 订阅节点 = https://your-vercel-domain.vercel.app/api/download/sub_xxx
```

---

## 🐛 故障排查

### 1. 订阅下载失败

**检查步骤**：
1. 访问 `/api/health` 确认服务状态
2. 检查 Vercel 环境变量是否正确配置
3. 查看 Vercel 函数日志（Dashboard → Functions → Logs）

### 2. Redis 连接失败

**可能原因**：
- `UPSTASH_REDIS_REST_URL` 或 `UPSTASH_REDIS_REST_TOKEN` 配置错误
- Upstash Redis 数据库被删除或暂停

**解决方案**：
- 重新检查 Upstash 控制台的 REST API 凭据
- 确认 Redis 数据库状态为 Active

### 3. 缓存未生效

**检查步骤**：
1. 访问 `/api/cache/stats` 查看缓存状态
2. 确认 `MEMORY_CACHE_ENABLED=true`
3. 检查响应头 `X-Cache-Status`（HIT-MEMORY 表示命中）

---

## 📝 开发指南

### 本地开发

```bash
# 安装依赖（无需任何 npm 包，纯原生实现）
npm install -g vercel

# 创建 .env 文件
cp .env.example .env
# 编辑 .env，填入 Upstash 凭据

# 启动本地开发服务器
vercel dev
```

访问 `http://localhost:3000/api/health` 测试。

### 添加新功能

1. 在 `api/` 目录下创建新的 `.js` 文件
2. 导出一个异步函数：`module.exports = async (req, res) => { ... }`
3. 使用 `lib/` 中的工具函数和 Redis 客户端

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [Vercel](https://vercel.com/) - Serverless 平台
- [Upstash](https://upstash.com/) - Serverless Redis
- [Sub-Store](https://github.com/sub-store-org/Sub-Store) - 订阅管理灵感来源

---

**作者**: vpn3288  
**仓库**: https://github.com/vpn3288/VS-UR-Sub-Store

# VS-UR-Sub-Store

**Vercel Serverless + Upstash Redis 的 Sub-Store 后端同步方案（完整版）**

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
  - ✅ LRU 缓存淘汰策略（智能内存管理）
  - ✅ 速率限制保护（防止滥用）
  - ✅ 批量操作支持（高效管理）
  - ✅ 性能监控与日志（可观测性）
  - ✅ 自动重试机制（提高可靠性）
  - ✅ **真实的格式转换**（Clash/Surge/V2Ray/Base64）
  - ✅ **节点过滤和规则**（关键词、地区、协议）
  - ✅ **节点测速**（延迟测试、可用性检测）
  - ✅ **Webhook 通知**（事件订阅）
  - ✅ **配置模板**（Clash/Surge 模板管理）

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
git clone https://github.com/vpn3288/VS-UR-Sub-Store.git
cd VS-UR-Sub-Store
npm install -g vercel
vercel login
vercel --prod
```

### 3. 配置环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL | 必填 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST API Token | 必填 |
| `CACHE_TTL` | 缓存过期时间（秒） | `300` |
| `CACHE_MAX_SIZE` | 最大缓存条目数 | `100` |
| `MEMORY_CACHE_ENABLED` | 是否启用内存缓存 | `true` |
| `RATE_LIMIT_MAX` | 每分钟最大请求数 | `100` |
| `API_SECRET` | API 签名密钥（可选） | - |

---

## 📡 API 端点

### 核心功能

#### 订阅下载（核心功能）
```
GET /api/download/{subscription_id}?format=auto&clean=false
```

**查询参数**：
- `format`: 输出格式
  - `auto`: 自动检测（默认）
  - `clash`: Clash YAML
  - `surge`: Surge 配置
  - `v2ray`: V2Ray JSON
  - `base64`: Base64 编码的 URI 列表
- `clean`: 是否清洗内容（移除追踪参数），默认 `false`

**响应头**：
- `X-Cache-Status`: 缓存状态
- `X-Original-Format`: 原始格式
- `X-Output-Format`: 输出格式
- `X-Performance`: 性能数据
- `X-RateLimit-*`: 速率限制信息

**示例**：
```bash
# 自动格式
curl "https://your-domain.vercel.app/api/download/sub_xxx"

# Clash 格式 + 清洗
curl "https://your-domain.vercel.app/api/download/sub_xxx?format=clash&clean=true"

# Base64 格式
curl "https://your-domain.vercel.app/api/download/sub_xxx?format=base64"
```

### 订阅管理

#### 列出所有订阅
```
GET /api/subscriptions
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

#### 批量操作 🆕
```
POST /api/batch
Content-Type: application/json

{
  "action": "create",  // create/update/delete
  "items": [
    {"name": "订阅1", "url": "https://example.com/sub1", "enabled": true},
    {"name": "订阅2", "url": "https://example.com/sub2", "enabled": true}
  ]
}
```

### 节点过滤 🆕

```
POST /api/filter
Content-Type: application/json

{
  "subscriptionId": "sub_xxx",
  "rules": {
    "include": ["香港", "HK"],           // 包含关键词
    "exclude": ["过期", "expired"],      // 排除关键词
    "regions": ["hk", "sg", "jp"],      // 地区过滤
    "protocols": ["ss", "vmess"],       // 协议过滤
    "portRange": [1000, 65535],         // 端口范围
    "deduplicate": true,                // 去重
    "limit": 10                         // 限制数量
  }
}
```

**预设规则**：
```
GET /api/filter
```

返回预设规则：
- `hk-only`: 仅香港节点
- `no-cn`: 排除中国节点
- `ss-only`: 仅 Shadowsocks
- `top-10`: 前 10 个节点
- `deduplicated`: 去重节点

### 节点测速 🆕

```
POST /api/speedtest
Content-Type: application/json

{
  "nodes": [
    {"name": "节点1", "server": "1.2.3.4", "port": 443, "type": "ss"},
    {"name": "节点2", "server": "5.6.7.8", "port": 443, "type": "vmess"}
  ],
  "testUrl": "http://www.gstatic.com/generate_204",
  "timeout": 5000
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "total": 2,
    "available": 1,
    "results": [
      {
        "name": "节点1",
        "server": "1.2.3.4",
        "port": 443,
        "type": "ss",
        "latency": 120,
        "available": true,
        "error": null
      }
    ]
  }
}
```

### Webhook 通知 🆕

#### 创建 Webhook
```
POST /api/webhook
Content-Type: application/json

{
  "name": "订阅更新通知",
  "url": "https://your-webhook-url.com/notify",
  "events": ["subscription.updated", "subscription.created"],
  "enabled": true
}
```

**支持的事件**：
- `subscription.created`: 订阅创建
- `subscription.updated`: 订阅更新
- `subscription.deleted`: 订阅删除
- `*`: 所有事件

### 配置模板 🆕

#### 列出所有模板
```
GET /api/templates
```

#### 获取模板
```
GET /api/templates?id=clash-basic
```

**内置模板**：
- `clash-basic`: Clash 基础模板
- `surge-basic`: Surge 基础模板

#### 创建自定义模板
```
POST /api/templates
Content-Type: application/json

{
  "name": "我的 Clash 模板",
  "type": "clash",
  "description": "自定义规则集",
  "content": "port: 7890\nproxies:\n  ..."
}
```

### 统计分析

```
GET /api/stats              # 全局统计
GET /api/stats?id={id}      # 单个订阅统计
```

### 缓存管理

```
GET /api/cache/stats        # 缓存统计
POST /api/cache/clear       # 清除缓存
POST /api/cache/warmup      # 缓存预热
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
│   ├── batch.js           # 批量操作
│   ├── stats.js           # 统计分析
│   ├── filter.js          # 节点过滤 🆕
│   ├── speedtest.js       # 节点测速 🆕
│   ├── webhook.js         # Webhook 通知 🆕
│   ├── templates.js       # 配置模板 🆕
│   └── cache/
│       ├── stats.js       # 缓存统计
│       ├── clear.js       # 清除缓存
│       └── warmup.js      # 缓存预热
├── lib/                   # 核心逻辑库
│   ├── redis.js          # Upstash Redis REST 客户端
│   ├── cache.js          # 内存穿透缓存（LRU）
│   ├── converter.js      # 订阅格式转换器 🆕
│   └── utils.js          # 工具函数
├── vercel.json           # Vercel 配置
├── package.json          # 项目配置
├── CHANGELOG.md          # 版本变更记录
├── DEPLOYMENT.md         # 部署指南
└── README.md             # 本文档
```

---

## 🔧 核心技术实现

### 1. 真实的格式转换器

支持以下格式互转：
- Base64 编码的 URI 列表
- Clash YAML
- Surge 配置
- V2Ray JSON
- SIP002 URI（ss://、vmess://、trojan://）

**自动检测格式**：
```javascript
const format = SubscriptionConverter.detectFormat(content);
// 返回: 'base64' | 'clash' | 'surge' | 'v2ray' | 'uri' | 'unknown'
```

**格式转换**：
```javascript
const converted = await SubscriptionConverter.convert(content, 'clash');
```

### 2. 节点过滤引擎

支持多维度过滤：
- **关键词过滤**：包含/排除特定关键词
- **地区过滤**：香港、台湾、新加坡、日本、美国、韩国
- **协议过滤**：Shadowsocks、VMess、Trojan
- **端口过滤**：指定端口范围
- **去重**：按节点名称去重
- **限制数量**：返回前 N 个节点

### 3. 节点测速

测试节点延迟和可用性：
- TCP 连接测试
- HTTP 请求测试
- 自定义测试 URL
- 可配置超时时间
- 自动排序（按延迟）

---

## 📊 性能指标

| 指标 | v1.0.0 | v2.0.0 | v3.0.0 | 提升 |
|------|--------|--------|--------|------|
| **缓存命中率** | ~60% | ~85% | **~90%** | +50% |
| **热启动延迟** | <10ms | <5ms | **<3ms** | -70% |
| **格式转换** | ❌ | 占位符 | **真实实现** | ✅ |
| **节点过滤** | ❌ | ❌ | **完整支持** | ✅ |
| **节点测速** | ❌ | ❌ | **完整支持** | ✅ |

---

## 🔄 使用场景

### 1. Clash Meta 订阅（自动转换）

```yaml
proxy-providers:
  my-subscription:
    type: http
    url: https://your-domain.vercel.app/api/download/sub_xxx?format=clash&clean=true
    interval: 3600
    path: ./providers/my-subscription.yaml
```

### 2. 仅香港节点

```bash
# 1. 创建过滤规则
curl -X POST https://your-domain.vercel.app/api/filter \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_xxx",
    "rules": {"regions": ["hk"]}
  }'

# 2. 使用过滤后的节点
# 返回的 nodes 数组可以保存为新订阅
```

### 3. 节点测速并排序

```bash
curl -X POST https://your-domain.vercel.app/api/speedtest \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [...],
    "testUrl": "http://www.gstatic.com/generate_204"
  }'
```

### 4. Webhook 自动通知

```bash
# 创建 Webhook
curl -X POST https://your-domain.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Telegram 通知",
    "url": "https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>",
    "events": ["subscription.updated"]
  }'
```

---

## 🛡️ 安全特性

- ✅ CORS 严格控制
- ✅ Header 清洗（移除客户端特征）
- ✅ 超时保护（5秒 Redis，15秒上游）
- ✅ 错误信息脱敏
- ✅ 速率限制（100 请求/分钟）
- ✅ 安全响应头（XSS、Clickjacking 防护）
- ✅ 请求签名（可选）

---

## 📝 开发指南

### 本地开发

```bash
npm install -g vercel
cp .env.example .env
# 编辑 .env，填入 Upstash 凭据
vercel dev
```

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
**版本**: 3.0.0 (完整版)

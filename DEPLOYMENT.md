# 部署指南

本文档提供详细的部署步骤和配置说明。

---

## 📋 前置准备

### 1. 注册 Upstash 账号

1. 访问 [Upstash Console](https://console.upstash.com/)
2. 使用 GitHub/Google 账号登录
3. 免费套餐包含：
   - 10,000 命令/天
   - 256 MB 存储
   - 全球边缘网络

### 2. 创建 Redis 数据库

1. 点击 **Create Database**
2. 配置：
   - **Name**: `sub-store-backend`
   - **Type**: `Regional` (推荐) 或 `Global`
   - **Region**: 选择离你最近的区域（如 `ap-southeast-1`）
   - **Eviction**: `noeviction` (不自动删除数据)
3. 点击 **Create**

### 3. 获取 REST API 凭据

创建完成后，在数据库详情页面找到：

- **REST API URL**: `https://xxx-xxxxx.upstash.io`
- **REST API Token**: `AXXXxxxXXXxxxXXX`

**⚠️ 重要**: 保存这两个值，稍后配置时需要。

---

## 🚀 方式一：一键部署（推荐）

### 1. 点击部署按钮

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vpn3288/VS-UR-Sub-Store)

### 2. 配置环境变量

在部署页面填入：

| 变量名 | 值 |
|--------|-----|
| `UPSTASH_REDIS_REST_URL` | 你的 Upstash REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | 你的 Upstash REST API Token |
| `CACHE_TTL` | `300` (可选) |
| `MEMORY_CACHE_ENABLED` | `true` (可选) |

### 3. 完成部署

点击 **Deploy**，等待 1-2 分钟。

部署完成后，你会得到一个域名：`https://your-project.vercel.app`

---

## 🛠️ 方式二：手动部署

### 1. Fork 仓库

访问 [VS-UR-Sub-Store](https://github.com/vpn3288/VS-UR-Sub-Store)，点击右上角 **Fork**。

### 2. 克隆到本地

```bash
git clone https://github.com/你的用户名/VS-UR-Sub-Store.git
cd VS-UR-Sub-Store
```

### 3. 安装 Vercel CLI

```bash
npm install -g vercel
```

### 4. 登录 Vercel

```bash
vercel login
```

选择登录方式（GitHub/GitLab/Email）。

### 5. 部署

```bash
vercel --prod
```

按提示操作：
1. **Set up and deploy**: 选择 `Y`
2. **Which scope**: 选择你的账号
3. **Link to existing project**: 选择 `N`
4. **Project name**: 输入项目名称（如 `sub-store-backend`）
5. **Directory**: 直接回车（使用当前目录）
6. **Override settings**: 选择 `N`

### 6. 配置环境变量

部署完成后，访问 [Vercel Dashboard](https://vercel.com/dashboard)：

1. 选择你的项目
2. 进入 **Settings** → **Environment Variables**
3. 添加以下变量：

| Key | Value | Environment |
|-----|-------|-------------|
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Production, Preview, Development |
| `UPSTASH_REDIS_REST_TOKEN` | `AXXXxxxXXX` | Production, Preview, Development |
| `CACHE_TTL` | `300` | Production, Preview, Development |
| `MEMORY_CACHE_ENABLED` | `true` | Production, Preview, Development |

4. 点击 **Save**

### 7. 重新部署

```bash
vercel --prod
```

---

## ✅ 验证部署

### 1. 健康检查

访问：`https://your-project.vercel.app/api/health`

预期响应：
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "redis": {
      "status": "healthy",
      "latency": "50ms"
    },
    "cache": {
      "size": 0,
      "enabled": true
    }
  }
}
```

### 2. 创建测试订阅

```bash
curl -X POST https://your-project.vercel.app/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试订阅",
    "url": "https://example.com/subscription",
    "enabled": true
  }'
```

预期响应：
```json
{
  "success": true,
  "data": {
    "id": "sub_1234567890_abc123",
    "name": "测试订阅",
    "url": "https://example.com/subscription",
    "enabled": true
  }
}
```

### 3. 测试订阅下载

访问：`https://your-project.vercel.app/api/download/sub_1234567890_abc123`

如果上游 URL 有效，应该返回订阅内容。

---

## 🔧 高级配置

### 自定义域名

1. 在 Vercel Dashboard 中选择项目
2. 进入 **Settings** → **Domains**
3. 添加你的域名（如 `sub.550995.xyz`）
4. 按提示配置 DNS 记录：
   - **Type**: `CNAME`
   - **Name**: `sub`
   - **Value**: `cname.vercel-dns.com`

### 调整缓存策略

修改环境变量：

- `CACHE_TTL`: 缓存过期时间（秒）
  - 默认 `300`（5分钟）
  - 建议范围：`60` - `3600`
  
- `MEMORY_CACHE_ENABLED`: 是否启用内存缓存
  - `true`: 启用（推荐）
  - `false`: 禁用（每次都读 Redis）

### 调整函数配置

编辑 `vercel.json`：

```json
{
  "functions": {
    "api/**/*.js": {
      "memory": 1024,        // 内存大小（MB）
      "maxDuration": 10      // 最大执行时间（秒）
    }
  }
}
```

---

## 🐛 常见问题

### 1. 部署失败：Missing environment variables

**原因**: 环境变量未配置。

**解决方案**:
1. 检查 Vercel Dashboard → Settings → Environment Variables
2. 确保 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 已添加
3. 重新部署

### 2. 健康检查失败：Redis unhealthy

**原因**: Redis 凭据错误或数据库不可用。

**解决方案**:
1. 访问 Upstash Console，确认数据库状态为 **Active**
2. 重新复制 REST API URL 和 Token
3. 更新 Vercel 环境变量
4. 重新部署

### 3. 订阅下载返回 404

**原因**: 订阅 ID 不存在。

**解决方案**:
1. 访问 `/api/subscriptions` 查看所有订阅
2. 确认订阅 ID 正确
3. 检查订阅是否被删除

### 4. 订阅下载返回 502

**原因**: 上游订阅 URL 不可访问。

**解决方案**:
1. 检查上游 URL 是否有效
2. 尝试在浏览器中直接访问上游 URL
3. 检查 Vercel 函数日志（Dashboard → Functions → Logs）

---

## 📊 监控与日志

### 查看函数日志

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 选择项目
3. 进入 **Deployments** → 选择最新部署
4. 点击 **Functions** → 选择函数 → 查看 **Logs**

### 监控 Redis 使用情况

1. 访问 [Upstash Console](https://console.upstash.com/)
2. 选择数据库
3. 查看 **Metrics**：
   - 命令数/天
   - 存储使用量
   - 延迟

---

## 🔄 更新部署

### 方式一：Git 推送自动部署

```bash
git pull origin main  # 拉取最新代码
git push origin main  # 推送到 GitHub
```

Vercel 会自动检测到推送并重新部署。

### 方式二：手动重新部署

```bash
vercel --prod
```

---

## 🗑️ 删除部署

### 删除 Vercel 项目

```bash
vercel remove your-project-name
```

或在 Vercel Dashboard 中：
1. 选择项目
2. **Settings** → **Advanced** → **Delete Project**

### 删除 Upstash 数据库

1. 访问 Upstash Console
2. 选择数据库
3. **Settings** → **Delete Database**

---

## 📞 获取帮助

- **GitHub Issues**: https://github.com/vpn3288/VS-UR-Sub-Store/issues
- **Vercel 文档**: https://vercel.com/docs
- **Upstash 文档**: https://docs.upstash.com/

---

**祝部署顺利！** 🎉

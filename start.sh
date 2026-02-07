#!/bin/bash
set -e

echo "🤖 Social Agent - 一键启动脚本"
echo ""

# 检查必要工具
command -v node >/dev/null 2>&1 || { echo "❌ 需要安装 Node.js (v18+)"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "❌ 需要安装 npm"; exit 1; }

# 检查 PostgreSQL
if ! command -v psql >/dev/null 2>&1; then
  echo "⚠️  未检测到 PostgreSQL，尝试使用 Docker..."
  if command -v docker >/dev/null 2>&1; then
    docker run -d --name social-agent-pg -p 5432:5432 \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=social_agent \
      postgres:16 2>/dev/null || true
    echo "✅ PostgreSQL Docker 容器已启动"
  else
    echo "❌ 需要 PostgreSQL 或 Docker"
    echo "   安装 PostgreSQL: https://www.postgresql.org/download/"
    echo "   或者 Docker:     https://docs.docker.com/get-docker/"
    exit 1
  fi
fi

# 检查 Redis
if ! command -v redis-cli >/dev/null 2>&1; then
  echo "⚠️  未检测到 Redis，尝试使用 Docker..."
  if command -v docker >/dev/null 2>&1; then
    docker run -d --name social-agent-redis -p 6379:6379 redis:7 2>/dev/null || true
    echo "✅ Redis Docker 容器已启动"
  else
    echo "⚠️  Redis 未安装（非必须，跳过）"
  fi
fi

# 安装依赖
echo ""
echo "📦 安装依赖..."
npm install

# 创建 .env（如果不存在）
if [ ! -f packages/server/.env ]; then
  echo ""
  echo "📝 创建 .env 配置..."
  cat > packages/server/.env << 'ENVEOF'
DEMO_MODE=true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/social_agent
REDIS_URL=redis://localhost:6379
PORT=3001
FRONTEND_URL=http://localhost:3001
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
VAPI_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=anthropic/claude-sonnet-4-20250514
WEBHOOK_BASE_URL=http://localhost:3001
ENVEOF
  echo "✅ .env 已创建（Demo 模式，无需 API 密钥）"
fi

# 创建数据库（如果不存在）
echo ""
echo "🗄️  初始化数据库..."
cd packages/server
createdb social_agent 2>/dev/null || true
npx prisma db push --skip-generate 2>/dev/null
npx prisma generate
cd ../..

# 构建前端
echo ""
echo "🔨 构建前端..."
cd packages/web
npx vite build
cd ../..

# 启动服务
echo ""
echo "🚀 启动 Social Agent..."
echo ""
echo "   打开浏览器访问: http://localhost:3001"
echo ""
echo "   支持的 Demo 指令:"
echo "     • 帮我跟张三约晚餐"
echo "     • 帮我约李磊周末打球"
echo "     • 帮我通知小组会议改期"
echo ""
echo "   按 Ctrl+C 停止服务"
echo ""

cd packages/server
npx tsx src/index.ts

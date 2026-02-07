# 🤖 Social Agent

用户下达社交指令（如"帮我跟张三约晚餐"），Agent 通过短信/电话自主完成多轮协调。

## 快速开始

### 前置要求

- Node.js 18+
- PostgreSQL（或 Docker）
- Redis（可选）

### 一键启动

```bash
git clone <repo-url> && cd social-agent
chmod +x start.sh && ./start.sh
```

打开浏览器访问 **http://localhost:3001**

### 手动启动

```bash
# 安装依赖
npm install

# 配置环境变量
cp packages/server/.env.example packages/server/.env

# 初始化数据库
cd packages/server && npx prisma db push && cd ../..

# 构建前端
cd packages/web && npx vite build && cd ../..

# 启动服务
cd packages/server && npx tsx src/index.ts
```

### 用 Docker 启动数据库

```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=social_agent postgres:16
docker run -d -p 6379:6379 redis:7
```

## Demo 模式

不配置任何 API 密钥时自动进入 Demo 模式，支持三个预设场景：

| 指令 | 流程 |
|------|------|
| 帮我跟张三约晚餐 | 发短信→收回复→选时间→选餐厅→通知确认 |
| 帮我约李磊周末打球 | 发短信→收回复→确认安排→完成 |
| 帮我通知小组会议改期 | 选通知内容→发通知→收确认 |

## 接入真实 API

编辑 `packages/server/.env`：

```env
OPENROUTER_API_KEY=sk-or-...     # LLM 规划+对话
TWILIO_ACCOUNT_SID=AC...          # 真实 SMS
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
```

## 技术栈

- **后端**: Node.js + TypeScript + Express + Prisma + Socket.IO
- **前端**: React + TypeScript + Tailwind CSS + Vite
- **LLM**: OpenRouter (兼容 OpenAI SDK)
- **通信**: Twilio SMS/Voice + Vapi

## 项目结构

```
packages/
├── server/src/
│   ├── gateway/        # 通信网关 (Twilio SMS, Voice, Vapi)
│   ├── planner/        # 任务规划器 (LLM 驱动)
│   ├── executor/       # 对话执行器 (文本 + 语音)
│   ├── router/         # 决策路由器
│   ├── state/          # 状态管理器 (Prisma + EventEmitter)
│   ├── demo/           # Demo 模拟器
│   ├── llm/            # OpenRouter LLM 客户端
│   ├── orchestrator.ts # 主控制器
│   └── index.ts        # Express 入口
└── web/src/
    ├── components/     # React 组件
    ├── hooks/          # Socket.IO hook
    └── App.tsx         # 主页面
```

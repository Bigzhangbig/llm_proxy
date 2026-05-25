# llm_proxy

一个极轻量的 OpenAI Responses API 本地中转网关，专为单用户本地开发调试设计。

## 项目介绍

`llm_proxy` 对外暴露标准的 `/v1/responses` 有状态接口，底层通过转换层调用无状态的 `/v1/chat/completions` 接口，让不原生支持 Responses API 的 LLM 供应商也能以 Responses 协议交互。

**技术栈：** TypeScript + Bun + Hono + bun:sqlite

## 核心功能

1. **Responses API ↔ Chat Completions 双向转换** — 完整实现 OpenAI Responses 格式的请求/响应映射
2. **推理模型思维链解析** — 流式解析 `reasoning_content` / `reasoning_details`，并按序重组为标准格式
3. **Web 搜索多后端支持** — Exa / MiniMax Grounding / Gemini Grounding，可按需切换
4. **Web Fetch 网页内容提取管道** — 基于 MinerU 的页面解析 + 小模型精炼，输出干净 Markdown
5. **多模态输入支持** — 图像理解降级策略，兼容多供应商图像处理差异
6. **工具调用生命周期管理** — 完整 Agentic Loop，支持多轮工具调用直到任务完成
7. **多供应商适配** — DeepSeek V4 / Kimi k2.6 / MiniMax M2.7 / MiMo V2.5-Pro
8. **SQLite 本地会话持久化** — Conversation、Item、输出项本地存储，支持断点续查
9. **结构化 JSON 输出降级** — 当原生格式不支持时自动降级处理
10. **并发安全** — per-conversation 互斥锁，避免同一会话并发写冲突

## 快速开始

### 环境要求

- [Bun](https://bun.sh) v1.2+

### 安装运行

```bash
git clone https://github.com/Bigzhangbig/llm_proxy.git
cd llm_proxy
bun install
cp .env.example .env   # 填入你的 API Key
bun run dev
```

### 验证服务

```bash
curl http://localhost:3000/health
```

## 架构概览

```
客户端（Cursor / 代码 / curl）
        │
        ▼
  ┌─────────────────┐
  │  Hono HTTP 服务  │  :3000
  │  /v1/responses   │
  └────────┬────────┘
           │ 请求转换
           ▼
  ┌─────────────────┐
  │   转换层          │  Responses ↔ Chat Completions
  │   工具循环        │  Agentic Loop + 搜索/Fetch 管道
  └────────┬────────┘
           │ /v1/chat/completions
           ▼
  ┌─────────────────┐
  │   供应商适配层    │  DeepSeek / Kimi / MiniMax / MiMo
  └────────┬────────┘
           │
           ▼
     云服务商 API
```

数据流：客户端发送 Responses API 请求 → 网关接收并转换为 Chat Completions 格式 → 路由到对应供应商 → 返回结果并重组为 Responses 格式 → 流式/批量返回给客户端。

## 支持的供应商

| 供应商 | 模型 | Base URL | 特性 |
|--------|------|----------|------|
| DeepSeek | deepseek-v4-pro | `https://api.deepseek.com/v1` | 推理链、长上下文、工具调用 |
| Kimi (Moonshot) | kimi-k2.6 | `https://api.kimi.com/coding/v1` | 代码优化、网页搜索集成 |
| MiniMax | M2.7 | `https://api.minimax.io/v1` | 多模态、Grounding 搜索 |
| MiMo (Xiaomi) | MiMo-V2.5-Pro | `https://token-plan-cn.xiaomimimo.com/v1` | 推理增强、国内优化 |

## 开发指南

```bash
# 开发模式（热重载）
bun run dev

# 生产模式
bun run start

# 运行测试
bun test
```

### 项目结构

```
llm_proxy/
├── .env.example          # 环境变量模板
├── .gitignore
├── README.md
├── docs/                 # 项目文档
│   ├── execution_plan.md
│   ├── openai_responses_research.md
│   ├── web_search_extraction_design.md
│   └── 执行记录.md
├── scratch/              # 实验代码（不提交）
│   └── test_grounding.py
└── src/                  # 源代码（开发中）
    └── .gitkeep
```

## 许可证

MIT

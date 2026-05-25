# llm_proxy 详细执行计划与验收方案 v2

本计划将适配工作重组为 **6 个能力阶段**，按功能依赖顺序推进：先跑通 DeepSeek 核心管道，再逐步叠加搜索、抓取、多模态、工具调用能力，最后扩展到其他供应商。每个阶段包含具体任务、验收用例和通过标准。

---

## 技术栈（已确认）

| 维度 | 选型 |
|---|---|
| 运行时 | Bun |
| HTTP 框架 | **Hono**（14KB，内置 SSE/proxy/CORS/logger） |
| 数据库 | **bun:sqlite**（零依赖，WAL + synchronous=NORMAL） |
| 环境变量 | **Bun.env**（自动加载 .env） |
| SSE 流式 | Hono `streamSSE` helper |
| 并发控制 | `p-limit` |
| UUID | `crypto.randomUUID()`（Bun 内置） |

### 项目结构
```
llm_proxy/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts              # Hono app 入口
│   ├── config.ts             # 环境变量 + 类型安全配置
│   ├── types.ts              # 共享类型定义
│   ├── routes/
│   │   └── responses.ts      # POST /v1/responses 路由
│   ├── core/
│   │   ├── assembler.ts      # messages ↔ ConversationItem 转换
│   │   ├── stream.ts         # SSE 状态机 + streamSSE
│   │   ├── reasoning.ts      # reasoning_content / reasoning_details 处理
│   │   ├── lock.ts           # per-conversation 互斥锁
│   │   └── schema.ts         # JSON Schema 降级
│   ├── search/
│   │   ├── router.ts         # 搜索意图路由（exa/mmx/gemini）
│   │   ├── exa.ts            # Exa API 封装
│   │   ├── mmx.ts            # MiniMax 搜索（POST /v1/coding_plan/search）
│   │   └── gemini.ts         # Gemini Grounding 搜索
│   ├── fetch/
│   │   ├── downloader.ts     # curl 下载 + anti-bot UA
│   │   ├── extractor.ts      # MinerU / Exa contents 提取
│   │   └── refiner.ts        # 小模型内容精炼
│   ├── providers/
│   │   ├── deepseek.ts       # DeepSeek V4 适配器
│   │   ├── kimi.ts           # Kimi k2.6 适配器
│   │   ├── minimax.ts        # MiniMax M2.7 适配器
│   │   └── mimo.ts           # MiMo V2.5-Pro 适配器
│   └── db/
│       └── index.ts          # bun:sqlite 初始化 + CRUD
└── llm_proxy.db
```

---

## 阶段 0：项目脚手架与基础设施

### 任务清单
1. `bun init`，`bun add hono p-limit`
2. 配置 `tsconfig.json`：
   ```json
   {
     "compilerOptions": {
       "target": "ESNext", "module": "ESNext",
       "moduleResolution": "bundler",
       "types": ["bun-types"],
       "strict": true, "skipLibCheck": true,
       "esModuleInterop": true, "resolveJsonModule": true
     },
     "include": ["src/**/*"]
   }
   ```
3. 创建 `.env.example`：
   ```
   PORT=3000
   DEEPSEEK_API_KEY=
   DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
   DEEPSEEK_MODEL=deepseek-v4-pro
   EXA_API_KEY=
   GEMINI_API_KEY=
   KIMI_API_KEY=
   KIMI_BASE_URL=https://api.kimi.com/coding/v1
   MINIMAX_API_KEY=
   MIMO_API_KEY=
   MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
   DEBUG=false
   ```
4. 创建 `src/config.ts`：读取 `Bun.env`，导出类型安全配置。
5. 创建 `src/db/index.ts`：
   ```typescript
   import { Database } from 'bun:sqlite'
   const db = new Database('llm_proxy.db')
   db.run("PRAGMA journal_mode = WAL;")
   db.run("PRAGMA synchronous = NORMAL;")
   ```
   - 表 `conversations`: `id TEXT PK, created_at INT, updated_at INT`
   - 表 `conversation_items`: `id TEXT PK, conversation_id TEXT, role TEXT, content TEXT, reasoning_content TEXT, reasoning_details TEXT, tool_calls TEXT, tool_call_id TEXT, name TEXT, created_at INT`
   - 导出 CRUD 函数
6. 创建 `src/types.ts`：`ResponsesRequest`, `ChatCompletionRequest`, `ChatCompletionChunk`, `ConversationItem`, `ProviderConfig` 等。
7. 创建 `src/index.ts`：Hono app 启动 + logger + CORS + health 路由。
8. 创建 `src/routes/responses.ts`：`POST /v1/responses` 路由占位。

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 0.1 | 服务启动 | `bun run dev` | 输出 `Server running on port 3000` |
| 0.2 | 健康检查 | `curl localhost:3000/health` | `{"status":"ok"}` |
| 0.3 | 数据库 | 启动后查 DB | `conversations` 和 `conversation_items` 表存在 |
| 0.4 | 路由占位 | `curl -X POST localhost:3000/v1/responses -d '{}'` | 501 或占位响应，不崩溃 |

---

## 阶段 1：DeepSeek V4 完整支持

### 目标
实现 DeepSeek V4 的完整代理管道：请求映射、流式转发、reasoning_content 处理、多轮回传、SQLite 持久化。

### 任务清单

#### 1.1 基础转发管道
1. `src/routes/responses.ts` 实现完整路由处理：
   - 提取 `input`（字符串/数组）、`instructions`、`tools`、`model`、`stream`、`conversation`、`previous_response_id`
   - 有 `conversation`/`previous_response_id` 时从 SQLite 加载历史
   - `instructions` → system message
   - 构建 Chat Completions 请求体
2. `src/core/assembler.ts`：`ConversationItem[]` ↔ `messages[]` 双向转换。
3. 非流式转发：`fetch` → DeepSeek → 映射为 Responses Response。
4. 流式转发基础版：SSE → `response.output_text.delta` → `response.completed`。
5. 响应结束后 `appendItems()` 保存到 SQLite。

#### 1.2 推理字段处理
6. `src/core/reasoning.ts`：reasoning_content 状态机：
   - 状态：`IDLE → REASONING → TEXT → DONE`
   - `delta.reasoning_content` 非空 + `delta.content` 空 → `REASONING`，发 `response.reasoning_summary_text.delta`
   - `delta.content` 非空 → `TEXT`，发 `response.output_item.done`（reasoning）→ `response.output_item.added`（message）→ `response.output_text.delta`
7. DB 保存时 assistant 消息包含 `reasoning_content`。
8. 多轮拼装时原样回传 `reasoning_content`（DeepSeek V4 必须）。

#### 1.3 结构化输出降级
9. `src/core/schema.ts`：检测 `text.format` 含 `json_schema` → system message 注入 Schema → 出站 JSON.parse 校验 → `output_parsed` 字段。

#### 1.4 并发锁
10. `src/core/lock.ts`：内存 Map per-conversation 互斥锁，超时 10s 返回 409。

#### 1.5 收尾
11. 全局错误处理、请求日志、SSE 中途断开清理。

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 1.1 | 非流式单轮 | `POST /v1/responses {"model":"deepseek-v4-pro","input":"你好","stream":false}` | Response JSON 含 output |
| 1.2 | 流式单轮 | 同上 stream:true | SSE: created → output_text.delta... → output_item.done → completed |
| 1.3 | 推理事件流 | "解释量子纠缠" | reasoning added → reasoning_summary_text.delta... → reasoning done → message added → output_text.delta... → message done → completed |
| 1.4 | 推理完整性 | 收集 reasoning delta 拼接 | 与 summary[0].text 一致 |
| 1.5 | 正文纯净 | 检查 output_text.delta | 无 <think> 标签、无 reasoning_content |
| 1.6 | 多轮上下文 | 第一轮 "我叫张三"，第二轮 "我叫什么" | 第二轮含 "张三" |
| 1.7 | reasoning 多轮回传 | 拦截第二轮发往 DeepSeek 的 payload | 历史 assistant 含 reasoning_content |
| 1.8 | SQLite 写入 | 多轮后查 DB | user + assistant 记录完整，reasoning_content 列非空 |
| 1.9 | JSON Schema 降级 | text.format 含 json_schema | output_parsed 非空 |
| 1.10 | 并发锁 | 同一 conversation 并发两请求 | 无 database is locked，依次完成 |
| 1.11 | token 统计 | 检查 completed.usage | 含 input_tokens, output_tokens, reasoning_tokens |
| 1.12 | 错误处理 | 不带 API Key | 401/500 + 清晰错误，服务不崩 |
| 1.13 | SSE 半包 | TCP 分片一个 SSE 事件 | 状态机正确重组 |
| 1.14 | 客户端断连 | 流式中 Ctrl+C | 资源清理，下次正常 |

---

## 阶段 2：Web 搜索支持

### 目标
实现多后端 Web 搜索能力：Exa 语义搜索、MiniMax 搜索（POST /v1/coding_plan/search）、Google Gemini Grounding 搜索。网关根据配置选择搜索后端，将结果注入上下文。

### 任务清单

#### 2.1 Exa 语义搜索
1. `src/search/exa.ts`：
   - `exaSearch(query, apiKey, numResults=5): Promise<SearchResult[]>`
   - POST `https://api.exa.ai/search`，`useAutoprompt: true`
   - 返回 `{ title, url, highlights }[]`

#### 2.2 MiniMax 搜索
2. `src/search/mmx.ts`：
   - `mmxSearch(query): Promise<SearchResult[]>`
   - POST `{baseUrl}/v1/coding_plan/search`，Body: `{ q: query }`
   - 优先从 `~/.mmx/config.json` 读取 api_key 和 region，fallback 到环境变量 `MMX_API_KEY` / `MMX_REGION`
   - 返回 `{ title, url, content }[]`，content 为 `snippet + date`

#### 2.3 Google Gemini Grounding 搜索
3. `src/search/gemini.ts`：
   - 调用 Gemini API（`gemini-2.5-flash` 或 `gemini-2.5-flash-lite`）+ `google_search` 工具
   - 解析 `groundingMetadata`：
     - `webSearchQueries`：实际搜索词
     - `groundingChunks`：数据源（`{ web: { uri, title } }`）
     - `groundingSupports`：文本片段→数据源映射（`{ segment: { startIndex, endIndex }, groundingChunkIndices }`）
   - 非流式：按 `endIndex` 降序反向插入脚注标记，`Set` 去重
   - 流式：`groundingChunks` 存 Map 增量去重，`finishReason=STOP` 时一体化合并 text + 脚注
   - 免费层配额为 0 时降级报错

#### 2.4 搜索路由
4. `src/search/router.ts`：
   - 根据配置选择搜索后端：`SEARCH_PROVIDER=exa|mmx|gemini`
   - 若未配置，默认使用 Exa
   - 返回统一 `SearchResult[]` 格式

#### 2.5 网关集成
5. 在 `src/routes/responses.ts` 中：
   - 检测请求 tools 中含 `web_search` 类型
   - 替换为虚拟 function `_gateway_web_search`（参数：`query: string`）
   - 拦截 `finish_reason: "tool_calls"` + 工具名 `_gateway_web_search`
   - 调用搜索路由获取结果
   - 拼装 `role: "tool"` 消息，自动发起第二轮 completions（Agentic Loop）
   - 最多 3 轮循环保护

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 2.1 | Exa 搜索 | `exaSearch("AI latest news")` | 返回 5 个相关 URL + 标题 |
| 2.2 | Gemini Grounding | 调用 Gemini + google_search | 返回 groundingMetadata 三字段 |
| 2.3 | Gemini 脚注插入 | 非流式结果 | 正文末尾含 `[1][2]` 脚注，URL 对应正确 |
| 2.4 | Gemini 流式脚注 | 流式结果 | 脚注在最后一个 chunk 一体化输出，无粘包 |
| 2.5 | Gemini 免费层降级 | 无付费 Key | 返回明确错误，不崩溃 |
| 2.6 | 搜索路由 | 配置 `SEARCH_PROVIDER=exa` | 走 Exa 后端 |
| 2.7 | 工具替换 | 发送含 web_search tools 的请求 | payload 中为 `_gateway_web_search` |
| 2.8 | 搜索触发 | 问 "今天北京天气" | 搜索后端被调用，query 合理 |
| 2.9 | 二轮迭代 | SSE 流 | 第一轮流中断 → 搜索 → 第二轮流 → 最终回答含实时信息 |
| 2.10 | 循环保护 | 模型连续 3 轮搜索 | 第 3 轮后强制结束 |
| 2.11 | 搜索失败降级 | API 返回错误 | 返回 "搜索服务暂不可用"，不崩溃 |
| 2.12 | 非搜索不触发 | 问 "1+1" | 不调用搜索 |

---

## 阶段 3：Web Fetch 支持

### 目标
实现网页内容抓取与提取能力：下载网页 HTML → MinerU/Exa 提取正文 → 小模型精炼，为模型提供网页内容上下文。

### 任务清单

#### 3.1 网页下载
1. `src/fetch/downloader.ts`：
   - `curlDownload(url, outputPath): Promise<{ path, size }>`
   - 伪造 UA（Chrome 120），`--max-time 15 --connect-timeout 5`
   - 支持代理配置 `HTTP_PROXY`
   - 返回下载文件路径和大小

#### 3.2 内容提取
2. `src/fetch/extractor.ts`：
   - 双模策略：
     - `< 10MB`：`mineru-open-api flash-extract <file> -o <dir>`（免 Token）
     - `≥ 10MB`：`mineru-open-api extract <file> -f html -o <dir>`（高精度）
   - 递归查找输出目录中的 `.md` 文件
   - Exa 备选：`exaSearch` 返回结果中的 `highlights` 字段可作为轻量替代

#### 3.3 小模型精炼
3. `src/fetch/refiner.ts`：
   - `refinePageContent(query, rawMarkdown, config): Promise<RefinedContext>`
   - 使用配置的轻量模型（默认 `deepseek-v4-flash`，可配 `mimo-v2-flash`）
   - Prompt：提取与 query 相关的核心事实/数据，输出 Markdown 列表
   - 不相关则返回 `[无相关干货]`
   - `temperature: 0.1`，截取前 30k 字符
   - 并发控制：`p-limit(3)`

#### 3.4 管道整合
4. `src/search/pipeline.ts`：串联 download → extract → refine 管道
   - 清理临时文件
   - 返回拼接好的上下文 Markdown（标明来源 URL）

#### 3.5 网关集成
5. 在 Agentic Loop 中，当搜索结果包含需要深入阅读的 URL 时，自动触发 fetch 管道
   - 或作为独立工具 `_gateway_web_fetch` 暴露给模型

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 3.1 | curl 下载 | `downloader("https://example.com")` | 本地 HTML 文件存在，大小合理 |
| 3.2 | MinerU 快速提取 | < 10MB HTML | 输出 Markdown 文件，内容为网页正文 |
| 3.3 | MinerU 精确提取 | ≥ 10MB HTML | 输出 Markdown，表格/公式保留 |
| 3.4 | 小模型精炼 | 传入长 Markdown + query | 返回 500-1000 Token 干货列表 |
| 3.5 | 无关过滤 | 传入无关网页 | 返回 `[无相关干货]` |
| 3.6 | 并发下载 | 5 个 URL 并发 | p-limit 控制最多 3 个同时执行 |
| 3.7 | 临时文件清理 | 管道完成后 | /tmp 无残留 HTML/MD 文件 |
| 3.8 | 管道完整流程 | 搜索 → 下载 → 提取 → 精炼 | 输出含来源 URL 的精炼上下文 |
| 3.9 | 超时处理 | 慢响应网站 | 15s 后超时，不阻塞管道 |

---

## 阶段 4：多模态支持

### 目标
支持图像理解、音频转录等多模态输入，通过小模型预处理后注入上下文。

### 任务清单

#### 4.1 图像理解
1. 支持 Responses API 的多模态 input（`input_image_url` 类型）
2. 下载图片 → 调用小模型（Gemini Flash / MiniMax Vision）进行描述
3. 将描述文本注入 user message 的 content 数组

#### 4.2 多模态输入转换
5. 将 Responses API 的 `input_image_url` 转换为 Chat Completions 的 `image_url` content part
6. 若底层模型不支持视觉，自动降级为小模型描述 + 文本注入

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 4.1 | 图像 URL 输入 | 发送含 image_url 的 input | 底层收到 image_url content part |
| 4.2 | 视觉模型直传 | 底层为视觉模型 | 图片直传，模型直接描述 |
| 4.3 | 非视觉模型降级 | 底层为纯文本模型 | 小模型先描述图片，文本注入 message |
| 4.4 | 多图处理 | input 含多张图片 | 每张图片独立处理/描述 |

---

## 阶段 5：工具调用支持

### 目标
实现 OpenAI Responses API 的完整工具调用生命周期：工具定义透传、tool_calls 拦截、tool result 回填、多轮 Agentic Loop。

### 任务清单

#### 5.1 工具定义透传
1. 将 Responses API 的 `tools` 数组转换为 Chat Completions 的 `tools` 格式
2. 过滤/替换内置工具为虚拟工具（如 `web_search` → `_gateway_web_search`）

#### 5.2 tool_calls 拦截与回填
3. 检测 `finish_reason: "tool_calls"` → 提取 tool_calls 数组
4. 对于内置虚拟工具（`_gateway_web_search`, `_gateway_web_fetch`）：网关代执行
5. 对于普通 function 工具：将 tool_calls 透传给客户端，等待客户端返回 tool result
6. 对于供应商原生内置工具（Kimi `$web_search`, MiMo `web_search`）：自动回弹空 tool result

#### 5.3 Agentic Loop 管理
7. 统一的 loop 管理器：最多 N 轮迭代（可配，默认 5）
8. 每轮记录 tool_calls 和 tool_results 到 SQLite
9. 循环终止条件：finish_reason != "tool_calls" 或达到最大轮次

#### 5.4 结构化 tool output
10. 支持 tool result 为 JSON 字符串
11. 支持多工具并行调用（多个 tool_calls 同时返回）

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 5.1 | 工具透传 | 定义自定义 function 工具 | 底层收到 tools 定义 |
| 5.2 | tool_calls 拦截 | 模型返回 tool_calls | SSE 中出现 tool_calls 事件 |
| 5.3 | 虚拟工具代执行 | `_gateway_web_search` 被调用 | 网关执行搜索，自动回填结果 |
| 5.4 | 原生工具回弹 | Kimi `$web_search` 被调用 | 自动回弹空 content，Kimi 服务端执行 |
| 5.5 | 多轮 loop | 模型连续调用 3 次工具 | 每次结果正确回填，最终输出完整 |
| 5.6 | 循环保护 | 模型调用 6 次工具 | 第 5 轮后强制结束 |
| 5.7 | 多工具并行 | 一轮返回 2 个 tool_calls | 两个结果都正确回填 |
| 5.8 | tool result 保存 | 多轮后查 DB | tool_calls 和 tool_results 完整记录 |

---

## 阶段 6：其他供应商适配

### 目标
在 DeepSeek 已验证的核心管道基础上，扩展支持 Kimi k2.6、MiniMax M2.7、MiMo V2.5-Pro。每个供应商仅需处理其特有差异。

### 任务清单

#### 6.1 Kimi k2.6
1. `src/providers/kimi.ts`：
   - Base URL: `api.kimi.com/coding/v1`
   - 自动注入 `thinking: {"type": "enabled"}` + `thinking.keep: "all"`
   - reasoning_content 处理复用阶段 1 的 reasoning.ts
   - `$web_search` 回弹代理（阶段 5 已支持）
   - usage fallback（无 reasoning_tokens 时设 0）

#### 6.2 MiniMax M2.7
2. `src/providers/minimax.ts`：
   - Base URL: `api.minimax.io/v1`（同标准 API）
   - 自动注入 `reasoning_split: true`
   - `reasoning_details` 结构化数组解析：
     - `delta.reasoning_details` → 遍历 `[{"type":"reasoning.text","text":"..."}]`
     - 提取 text 拼接为推理文本
   - DB 保存含 `reasoning_details` 数组
   - 多轮回传原样保留 `reasoning_details`

#### 6.3 MiMo V2.5-Pro
3. `src/providers/mimo.ts`：
   - Base URL: `token-plan-cn.xiaomimimo.com/v1`
   - 自动注入 `thinking: {"type": "enabled"}`
   - reasoning_content 处理复用
   - `web_search` 工具注入（MiMo 服务端执行，阶段 5 已支持）
   - 多轮必须带回 `reasoning_content`（尤其含 tool_calls 时）

#### 6.4 供应商路由
4. `src/providers/router.ts`：
   - 根据 model 名自动选择适配器
   - model → provider 映射表（可配置扩展）

### 验收用例
| 编号 | 用例 | 操作 | 预期结果 |
|---|---|---|---|
| 6.1 | Kimi thinking.keep | 拦截 payload | 含 thinking.type + thinking.keep |
| 6.2 | Kimi 推理流 | 流式请求 | reasoning → text 事件完整 |
| 6.3 | Kimi $web_search | 搜索问题 | tool_calls → 回弹 → 实时结果 |
| 6.4 | MiniMax reasoning_split | 拦截 payload | 含 reasoning_split: true |
| 6.5 | MiniMax 数组解析 | 流式请求 | reasoning_details[].text 正确拼接 |
| 6.6 | MiniMax 多轮 | 第二轮 payload | 含 reasoning_details 数组 |
| 6.7 | MiMo thinking | 拦截 payload | 含 thinking.type: enabled |
| 6.8 | MiMo web_search | 搜索问题 | web_search 工具注入 → 服务端执行 |
| 6.9 | MiMo 多轮 | 第二轮 payload | 含 reasoning_content |
| 6.10 | 供应商自动路由 | 指定不同 model | 自动选择正确适配器 |

---

## 端到端验收清单

### E2E-1：DeepSeek V4 完整流程
```bash
# 单轮推理 + 流式
curl -N localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"解释相对论","stream":true}'
# 验证：reasoning → text 事件，最终回答完整
```

### E2E-2：多轮对话（含 reasoning 保持）
```bash
RESP1=$(curl -s localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"我叫小明","stream":false}')
CONV_ID=$(echo $RESP1 | jq -r '.conversation_id')
curl -s localhost:3000/v1/responses \
  -d "{\"model\":\"deepseek-v4-pro\",\"input\":\"我叫什么\",\"conversation\":\"$CONV_ID\",\"stream\":false}"
# 验证：回答含 "小明"，DB 中 reasoning_content 完整
```

### E2E-3：Web 搜索（Exa）
```bash
SEARCH_PROVIDER=exa curl -N localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"2026年最新AI趋势","stream":true,"tools":[{"type":"web_search"}]}'
# 验证：Exa 搜索被调用，回答含实时信息
```

### E2E-4：Web 搜索（Gemini Grounding）
```bash
SEARCH_PROVIDER=gemini curl -N localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"今天深圳天气","stream":true,"tools":[{"type":"web_search"}]}'
# 验证：Gemini groundingMetadata 解析，脚注正确插入
```

### E2E-5：Web Fetch 管道
```bash
curl -s localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"总结这个网页的核心观点 https://example.com/article","stream":false,"tools":[{"type":"web_fetch"}]}'
# 验证：下载 → MinerU 提取 → 小模型精炼 → 回答含核心观点
```

### E2E-6：Kimi 推理 + 搜索
```bash
curl -N localhost:3000/v1/responses \
  -d '{"model":"kimi-k2.6","input":"今天深圳天气","stream":true,"tools":[{"type":"web_search"}]}'
# 验证：reasoning 事件 + 实时天气（$web_search 回弹）
```

### E2E-7：MiniMax 推理
```bash
curl -N localhost:3000/v1/responses \
  -d '{"model":"MiniMax-M2.7","input":"光合作用原理","stream":true}'
# 验证：reasoning_details 数组正确解析为 reasoning_summary_text.delta
```

### E2E-8：MiMo 推理 + 搜索
```bash
curl -N localhost:3000/v1/responses \
  -d '{"model":"MiMo-V2.5-Pro","input":"最新AI论文","stream":true,"tools":[{"type":"web_search"}]}'
# 验证：reasoning + web_search 工具服务端执行
```

### E2E-9：多工具调用
```bash
curl -s localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"搜索今天的新闻并总结","stream":false,"tools":[{"type":"web_search"},{"type":"function","function":{"name":"summarize","parameters":{}}}]}'
# 验证：工具调用 → 搜索 → 结果回填 → 总结输出
```

### E2E-10：并发安全
```bash
curl -s localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"问题1","conversation":"conv-x","stream":false}' &
curl -s localhost:3000/v1/responses \
  -d '{"model":"deepseek-v4-pro","input":"问题2","conversation":"conv-x","stream":false}' &
# 验证：无 database is locked，依次完成
```

---

## 供应商适配速查表

| 特性 | DeepSeek V4 | Kimi k2.6 | MiniMax M2.7 | MiMo V2.5-Pro |
|---|---|---|---|---|
| Base URL | `api.deepseek.com/v1` | `api.kimi.com/coding/v1` | `api.minimax.io/v1` | `token-plan-cn.xiaomimimo.com/v1` |
| 推理字段 | `reasoning_content` (string) | `reasoning_content` (string) | `reasoning_details` (array) | `reasoning_content` (string) |
| 推理开启 | thinking mode | 默认开启 | `reasoning_split: true` | `thinking.type: "enabled"` |
| 多轮回传 | 必须带回 reasoning_content | 必须带回 + `thinking.keep: "all"` | 必须带回 reasoning_details | 必须带回 reasoning_content |
| 内置搜索 | 无 | `$web_search` 回弹 | 无 | `web_search` 工具 |
| 搜索+推理 | N/A | 已兼容 (k2.6) | N/A | N/A |

---

## 搜索后端速查表

| 后端 | API | 特点 | 适用场景 |
|---|---|---|---|
| **Exa** | `api.exa.ai/search` | 语义搜索，useAutoprompt | 学术/技术内容 |
| **MiniMax** | `api.minimaxi.com/v1/coding_plan/search` | 中文新闻/网页搜索 | 中文内容/国内资讯 |
| **Gemini Grounding** | Gemini API + `google_search` | 实时性强，返回 groundingMetadata | 实时新闻/天气 |

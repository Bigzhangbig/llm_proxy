# 大模型供应商 API 兼容性与 Responses 接口适配研究报告

本报告旨在分析 DeepSeek, Kimi (Moonshot AI), MiniMax, 以及 MiMo (小米大模型) 这四家供应商提供的 `/v1/chat/completions` API 接口规格，评估它们与 OpenAI 协议的兼容性、独特的推理（CoT）及网页搜索机制，并详细设计如何通过本地中转网关（llm_proxy）将它们转换为 OpenAI 有状态的 `/v1/responses` 接口。

---

## 一、 供应商 API 与 OpenAI Chat Completions 兼容性横向对比

| 特性维度 | OpenAI 规范 | DeepSeek | Kimi (Moonshot) | MiniMax | MiMo (小米) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **基础参数兼容性** | 支持 `model`, `messages`, `temperature`, `stream` 等 | 高度兼容 (支持 `max_completion_tokens`) | 高度兼容 | 高度兼容 | 高度兼容 |
| **流式返回格式 (SSE)** | `choices[0].delta` 结构化增量输出 | 完全兼容 | 完全兼容 | 完全兼容 | 完全兼容 |
| **stream_options** | 支持 `include_usage` 在最后一个 chunk 返回 token 统计 | 支持 | 支持 | 支持 | 支持 |
| **Tool Calling** | 标准 `tools` / `tool_choice` 格式 | 支持 (V3 及 R1 均支持) | 支持 | 支持 | 支持 |
| **JSON Schema** | `response_format` 指定结构化输出格式 | 支持 `json_schema` 和 `json_object` | 支持 `json_schema` 和 `json_object` | 支持 | 支持 |
| **深度推理 (CoT) 字段** | 无官方原生流式推理字段 (o1/o3 隐式推理无流式 CoT) | 支持 `reasoning_content` (纯文本增量) | 支持 `reasoning_content` (纯文本增量) | 支持 `reasoning_details` (结构化数组增量) | 支持 `reasoning_content` (纯文本增量) |
| **内置联网搜索** | 无内置搜索参数 (需外部工具集成) | 不支持内置 (需自定义 Tool 实现) | 支持内置 `$web_search` (自执行回弹机制) | 不支持直接内置 completions 级搜索 (需 MCP/独立 API) | 支持内置 `web_search` 工具 (控制台激活 + 强搜控制) |

---

## 二、 四家供应商推理字段 (CoT) 与流式输出格式详析

1. **DeepSeek (V4 系列，`deepseek-v4-pro` / `deepseek-v4-flash`，thinking mode)** *(注：V4 为项目规划命名，对应 DeepSeek 后续推理模型代际)*
   - **参数配置**：通过 thinking mode 开启推理，支持 tool calling。
   - **流式输出**：流式返回的 SSE 数据块中，在 `choices[0].delta` 下包含独有的 `reasoning_content` 字段（格式为 plain string 增量）。
   - **时序特征**：生成时分阶段进行：先输出 `reasoning_content` 增量，此时 `content` 为空或 null；思维链结束后，`reasoning_content` 停止输出，正式的回答 `content` 开始流式吐出。
   - **多轮历史回传（关键）**：V4 **必须**在历史 assistant 消息中回传 `reasoning_content` 字段，尤其是包含 `tool_calls` 时。缺失则返回 400 错误：`"The reasoning_content in the thinking mode must be passed back to the API."`。
     回传格式：直接原样追加上一轮 assistant 消息即可，包含 `reasoning_content`、`content` 和 `tool_calls` 三个字段。

2. **Kimi (`kimi-k2.6`，thinking 默认开启)**
   - **参数配置**：`kimi-k2.6` 默认开启 thinking，可通过 `thinking.type: "disabled"` 关闭。也支持 `chat_template_kwargs: {"thinking": true}` 方式配置。
   - **流式输出**：思考过程包含在 `choices[0].delta` 的 `reasoning_content` 字段中（plain string 增量）。
   - **多轮历史回传**：
     - 必须在请求体中设置 **`thinking.keep: "all"`**，否则默认值为 `null`（忽略历史 `reasoning_content`），会导致多轮推理链丢失。
     - 当使用 `keep: "all"` 时，需将上一轮 API 返回的 assistant 消息原样追加回 `messages`。

3. **MiniMax**
   - **参数配置**：必须在请求体（通常在 `extra_body`）中显式指定 `"reasoning_split": true`。
   - **流式输出**：开启后，增量思维链位于 **`choices[0].delta.reasoning_details`** 字段中。
   - **结构差异**：与 DeepSeek/Kimi 的纯字符串不同，MiniMax 采用的是**结构化数组格式**，其流式 Chunk 的 payload 结构为：
     ```json
     data: {"choices": [{"delta": {"reasoning_details": [{"type": "reasoning.text", "text": "增量思考文本..."}]}}]}
     ```
     每个数组元素包含 `type` 字段（值为 `"reasoning.text"`）和 `text` 字段。非流式响应中还包含 `id`、`format`、`index` 等元数据。中转网关在解析时，需要提取该数组中每一项的 `text` 内容进行流式输出。
   - **多轮历史回传**：使用 OpenAI SDK 时，`response_message` 对象已包含 `reasoning_details` 字段，直接 `messages.append(response_message)` 即可原样回传。手动构造时需确保 assistant 消息中包含完整的 `reasoning_details` 数组。遗漏会导致 Interleaved Thinking 功能中断。

4. **MiMo (小米大模型)**
   - **参数配置**：通过配置请求顶层的 `thinking` 对象参数开启，例如 `{"thinking": {"type": "enabled"}}`。
   - **流式输出**：思维链通过 `choices[0].delta.reasoning_content`（纯文本增量）流式返回。
   - **多轮历史回传**：需要在 `messages` 历史消息中回传上一轮的 `reasoning_content`（无额外参数，原样保留 assistant 消息即可）。若 assistant 消息包含 `tool_calls`，必须完整回传 `reasoning_content`，否则返回 400 错误。

---

## 三、 内置网页搜索工具调用机制与差异

1. **DeepSeek**
   - 官方 completions 接口不提供内置的网页搜索工具。
   - **网关层适配**：中转网关需要拦截客户端的 search 需求，并在网关层作为“代执行者”进行 Tavily 等外部 API 的请求，拼装为第二轮的 completions 发送给底层的 DeepSeek 静态接口。

2. **Kimi (Moonshot AI)**
   - **独特的 `$web_search` 插件自执行回弹机制**：
     - 在请求的 `tools` 中配置内置函数：`{"type": "builtin_function", "function": {"name": "$web_search"}}`。
     - 模型决策要联网时，返回 `finish_reason="tool_calls"`，输出工具名为 `"$web_search"`，参数为 search query。
     - **网关层无需真正去调第三方搜索**：网关在处理该 tool_calls 时，只需在下一轮 completions 请求中直接构造一个 `role="tool"`, `name="$web_search"`, 并将 `content` 设置为空字符串的条目。Kimi 接收到后会在其服务端自执行联网检索并继续生成。
   - **Thinking 与 `$web_search` 兼容性（重要区分）**：
     - `kimi-k2-thinking`：使用 `$web_search` 时**必须禁用 thinking 模式**（官方文档明确要求两者互斥）。
     - `kimi-k2.6`：已解除此限制，thinking 模式可与 `$web_search` 及其他官方工具（如 `date`）同时使用，支持多步工具调用与深度推理并行。
     - **网关适配建议**：`kimi-k2.6` 的 thinking 模式已与 `$web_search` 兼容，网关可直接注入原生工具，无需降级处理。

3. **MiniMax**
   - 无直接的 completions 内置搜索参数。
   - **网关层适配**：网关需内置 Tavily 等外部搜索，拦截虚拟工具后本地代执行。

4. **MiMo (小米大模型)**
   - **内置 `web_search` 工具支持**：
     - 需先在小米 MiMo 开放平台控制台的”插件管理”中激活 Web Search 插件。
     - 调用时在 `tools` 中配置，完整格式如下：
       ```json
       {
         “type”: “web_search”,
         “max_keyword”: 3,
         “force_search”: true,
         “limit”: 1,
         “user_location”: {
           “type”: “approximate”,
           “country”: “China”,
           “region”: “Hubei”,
           “city”: “Wuhan”
         }
       }
       ```
     - `force_search: true` 强制触发联网搜索，`max_keyword` 限制搜索关键字数量，`limit` 控制返回网页数，`user_location` 提供地理位置上下文（可选）。

---

## 四、 本地中转网关转换设计与适配方案 (Completions -> Responses)

为了将上述无状态 completions 转为有状态的 `/v1/responses` 接口，中转网关需要实现以下五大适配和补齐模块：

### 1. 会话状态与生命周期持久化与 CoT 回传注入
- **会话映射**：Responses 接口采用 `previous_response_id` 串联多轮。网关基于本地 SQLite 数据库中的 `conversations` 与 `conversation_items` 表。收到请求后，网关在底层提取历史条目装配出无状态 completions 接收的 `messages` 数组。
- **CoT 多轮注入规范**：拼装历史 `messages` 时，网关必须自适应注入 CoT 字段以规避底层的 400 Bad Request 校验报错：
  - **对于 DeepSeek/Kimi/MiMo**，拼接历史 assistant 消息时需强行注入 `reasoning_content`：
    ```json
    {
      "role": "assistant",
      "content": "最终回答内容",
      "reasoning_content": "上一次生成的完整思考文本"
    }
    ```
  - **对于 MiniMax**，拼接历史 assistant 消息时需强行注入 `reasoning_details` 结构化数组：
    ```json
    {
      "role": "assistant",
      "content": "最终回答内容",
      "reasoning_details": [{"text": "上一次生成的完整思考文本"}]
    }
    ```

### 2. 内置工具代执行与代理循环
- **对于不支持服务端代执行的模型（DeepSeek / MiniMax）**：网关拦截虚拟工具调用 `_gateway_web_search`，由网关在本地执行 Tavily API 检索，将检索结果封装为 `role="tool"` 消息追加回上下文，并自启第二轮 completions 调用，实现客户端无感的 Agent 循环。
- **对于支持服务端代执行的模型（Kimi / MiMo）**：网关在 tools 中注入对应的内置工具。当收到模型发出的 tool_calls 时，网关扮演“回弹代理”自启下一轮请求，无需网关本地的 Tavily 额度和算力。
  - *Kimi 联网搜索回弹 JSON 交互示例*：
    ```json
    // 网关自启的第二轮请求 Payload
    {
      "model": "kimi-k2",
      "messages": [
        {"role": "user", "content": "微软最近有什么新闻？"},
        {
          "role": "assistant",
          "tool_calls": [
            {
              "id": "call_kimi_search_001",
              "type": "function",
              "function": {"name": "$web_search", "arguments": "{\"query\":\"微软最新新闻\"}"}
            }
          ]
        },
        {
          "role": "tool",
          "name": "$web_search",
          "tool_call_id": "call_kimi_search_001",
          "content": "" // 强行置空，由 Kimi 服务端接管自执行搜索
        }
      ]
    }
    ```
- **搜索与思考的互斥处理降级**：
  - 对于 `kimi-k2-thinking`：由于原生 `$web_search` 与 thinking 模式在单次请求中互斥，当客户端发起有状态的 Response 且同时开启了推理模式与搜索工具时，网关应**自动剥离**给底层的原生 `$web_search` 工具，改为在网关层通过 **Tavily 搜索代执行** 的 Agentic Loop，避开底层大模型的互斥限制。
  - 对于 `kimi-k2.6`：thinking 与 `$web_search` 已兼容，网关可直接注入原生工具，无需降级。

### 3. 思维链过滤与流式 SSE 协议状态机转换
网关必须维护一个流式协议状态机，将无状态 completions 的 raw chunks 转换为 Responses API 的细粒度 SSE 事件流：

| 阶段 / 状态 | 底层 Completion SSE 原始数据 | 网关向客户端发出的 Responses SSE 事件与数据 |
| :--- | :--- | :--- |
| **1. 握手建立** | 接收到首个 chunk | `event: response.created`<br>`data: {"id": "res_xxx", "object": "response", "status": "in_progress"}` |
| **2. 开始思维链** | 出现 `reasoning_content` / `reasoning_details` | `event: response.output_item.added`<br>`data: {"response_id": "res_xxx", "item": {"id": "item_cot_xxx", "type": "reasoning", "status": "in_progress"}}` |
| **3. 推理流式增量** | 持续收到推理字段 delta | `event: response.reasoning_summary_text.delta`<br>`data: {"response_id": "res_xxx", "item_id": "item_cot_xxx", "content_index": 0, "delta": "增量思考文本"}` |
| **4. 思维链结束** | 出现正式 `content` delta / 推理字段变为空 | `event: response.output_item.done`<br>`data: {"response_id": "res_xxx", "item": {"id": "item_cot_xxx", "type": "reasoning", "status": "completed", "summary": [{"type": "summary_text", "text": "完整思考过程"}]}}` |
| **5. 开始输出正文** | 出现首个正文 `content` delta | `event: response.output_item.added`<br>`data: {"response_id": "res_xxx", "item": {"id": "item_msg_xxx", "type": "message", "status": "in_progress", "role": "assistant", "content": []}}` |
| **6. 正文流式增量** | 持续收到 `content` delta | `event: response.output_text.delta`<br>`data: {"response_id": "res_xxx", "item_id": "item_msg_xxx", "content_index": 0, "delta": "增量回答文本"}` |
| **7. 正文输出结束** | 底层 completions SSE 块 `finish_reason` 非空 | `event: response.output_item.done`<br>`data: {"response_id": "res_xxx", "item": {"id": "item_msg_xxx", "type": "message", "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": "完整回答文本"}]}}` |
| **8. 事务收尾** | 底层 completions SSE 流结束 | `event: response.completed`<br>`data: {"id": "res_xxx", "status": "completed", "usage": {"total_tokens": 120, "input_tokens": 50, "output_tokens": 70, "output_tokens_details": {"reasoning_tokens": 30}}}` |

- **文本兜底拦截**：对于不提供原生推理字段但在 output 中输出 `<think>` 标签的模型，网关流式解析器须拦截 `<think>` 到 `</think>` 之间的内容，手动将其转换为 `response.reasoning_summary_text.delta` 吐给客户端，并在 `</think>` 后再切换为 `response.output_text.delta` 输出。

### 4. 结构化输出降级 (Structured Output Fallback)
- 客户端在 Responses 中请求 `text.format` 参数定义输出结构。若底层大模型对 JSON Schema 支持不佳，网关需在拼装消息时在 System Instructions 中强制注入 JSON Schema 约束，并在出站时对响应数据进行 JSON 格式检查，降级打包塞入 `output_parsed` 字段。

### 5. 并发排队与加锁机制 (Concurrency Mutex)
- 为避免本地单文件 SQLite 数据库在多轮或高频调用中出现 `database is locked` 异常，网关层需针对 `conversation_id` 实现轻量级并发锁或队列机制，确保会话更新串行化。

---

## 六、 Coding Plan (Token Plan) vs 按量付费 API 差异对比

三家供应商（Kimi、MiniMax、MiMo）均提供面向编程工具的订阅制计划，与标准按量 API 存在显著差异。网关对接时需明确区分。

### 6.1 计划名称与 Base URL 对照

| 供应商 | 计划名称 | Base URL (OpenAI 兼容) | Base URL (Anthropic 兼容) | 按量 API Base URL |
| :--- | :--- | :--- | :--- | :--- |
| **Kimi** | Coding Plan (编程计划) | `https://api.kimi.com/coding/v1` | `https://api.kimi.com/coding/` | `https://api.moonshot.ai/v1` |
| **MiniMax** | Token Plan (原 Coding Plan) | `https://api.minimax.io/v1`（国内: `api.minimaxi.com/v1`） | `https://api.minimax.io/anthropic` | 同 Token Plan（仅 Key 不同） |
| **MiMo** | Token Plan | `https://token-plan-cn.xiaomimimo.com/v1`（新加坡: `token-plan-sgp.xiaomimimo.com/v1`） | `https://token-plan-cn.xiaomimimo.com/anthropic` | `https://api.xiaomimimo.com/v1` |

> **注意**：Kimi 的 Coding Plan 与标准 API 使用**完全不同的域名**；MiniMax 共用域名但 **Key 不可互换**；MiMo 使用独立子域名。网关配置时需按实际使用的计划填写正确的 Base URL。

### 6.2 模型支持差异

| 供应商 | Coding/Token Plan 可用模型 | 按量 API 可用模型 |
| :--- | :--- | :--- |
| **Kimi** | `kimi-k2.6`（默认）, `kimi-k2.5`, `kimi-k2` | `kimi-k2.6`, `kimi-k2.5`, `kimi-k2 (0905)`, `moonshot-v1-8k/32k/128k` |
| **MiniMax** | M2.7, M2.7-highspeed | M2.7, M2.7-highspeed, M2.5, M2.5-highspeed, M2.1, M2.1-highspeed, M2, M2-her 等全量 |
| **MiMo** | MiMo-V2.5-Pro (2x credits), MiMo-V2.5, V2 系列 | 同 Token Plan（无模型独占差异） |

### 6.3 计费与限流差异

| 维度 | Kimi Coding Plan | MiniMax Token Plan | MiMo Token Plan |
| :--- | :--- | :--- | :--- |
| **计费模式** | 月费订阅 + 7 天周额度刷新 | 月费订阅 + 5h 滚动窗口 | 月费订阅 + Credit 系统 |
| **档位范围** | ¥49 ~ ¥699/月 | ¥29 ~ ¥899/月 | $6 ~ $100/月 (39~659 RMB) |
| **限流机制** | 5h 滚动窗口（300~1200 次/5h），最大并发 30 | 5h 滚动窗口（600~4500 次/5h）+ 周限额 | 无 5h 窗口限制，按 Credit 消耗 |
| **峰谷优惠** | 无 | 无 | 凌晨 00:00-08:00 (北京) 0.8x credit |
| **超限后** | 返回 429，等窗口重置 | 可切换按量计费或等重置 | 等下月刷新 |

### 6.4 功能差异

| 功能 | Kimi Coding Plan | MiniMax Token Plan | MiMo Token Plan |
| :--- | :--- | :--- | :--- |
| **Thinking 模式** | 支持 (`kimi-k2.6` 默认开启) | 支持 (`reasoning_split: true`) | 支持 (`thinking.type: "enabled"`) |
| **内置搜索** | 有 `SearchWeb` + `FetchURL`（自动配置） | 无内置搜索 | 未确认（标准 API 支持 `web_search`） |
| **Anthropic 兼容** | 有 (`/coding/` 端点) | 有 (`/anthropic` 端点) | 有 (`/anthropic` 端点) |
| **使用限制** | 仅限编程工具，不支持生产环境/自动化脚本 | 仅限交互式编程工具，不支持工作流平台 | 仅限编程工具，禁止自动化脚本/后端 |

### 6.5 网关适配建议
- 若网关面向个人编程调试场景，可直接对接 Coding/Token Plan，利用其低成本优势。
- 若网关需支持生产环境或多用户场景，应使用标准按量 API。
- 注意各计划的 Base URL 和 API Key 均不可与标准 API 互换。
- Kimi Coding Plan 内置 `SearchWeb` 和 `FetchURL`，网关可利用此能力减少 Tavily 依赖。

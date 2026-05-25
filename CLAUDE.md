# llm_proxy 项目指南

## 项目概述
极轻量 OpenAI Responses API 本地中转网关，单用户本地开发调试用。对外暴露 `/v1/responses`，底层调用 `/v1/chat/completions`。

## 技术栈
- **运行时**: Bun 1.2+
- **HTTP**: Hono（禁止使用 Express）
- **数据库**: bun:sqlite（禁止使用 better-sqlite3）
- **环境变量**: Bun.env（禁止使用 dotenv）
- **语言**: TypeScript strict mode

## 代码规范

基于 [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)，关键规则：

### 命名（Google 规范）
- 文件名：`kebab-case.ts`（如 `stream-transformer.ts`）
- 变量/函数/参数：`lowerCamelCase`
- 类/接口/类型/枚举：`UpperCamelCase`
- 全局常量：`CONSTANT_CASE`
- 禁止用 `_` 前缀/后缀表示私有，使用 TypeScript `private` 修饰符
- 禁止单字母变量名（循环变量 `i`/`j` 除外）

### 导入导出
- **禁止 default export**（Hono app 入口除外），使用 named export
- 使用 `import { Foo } from './foo'` 而非 `import * as foo`
- 仅导入类型时使用 `import type { Foo } from './foo'`
- 使用相对路径导入项目内模块

### TypeScript 强制规则
- 所有函数必须有显式返回类型
- **禁止 `any`**，未知类型用 `unknown`
- 优先用 `interface` 而非 `type` 定义对象结构
- 类型推断明确时不需要显式注解（如 `const x = 5`）
- 使用 `===`/`!==`，唯一例外：`== null` 检查 null/undefined
- 显式分号，不依赖 ASI
- 使用 `const`，仅在需要重赋值时用 `let`，禁止 `var`
- 控制流语句必须用花括号（即使单行）
- 禁止 `eval()`、`Function` 构造器、`with` 语句
- 禁止 `new String()` 等包装对象
- 抛异常必须用 `new Error()` 或其子类

### 文件组织
```
src/
├── index.ts          # 入口，只做组装，不写业务逻辑
├── config.ts         # 配置，从 Bun.env 读取
├── types.ts          # 共享类型，集中管理
├── routes/           # HTTP 路由，一个文件一个路由组
├── core/             # 核心逻辑，无 HTTP 依赖
├── providers/        # 供应商适配器，一个文件一个供应商
├── search/           # 搜索后端
├── fetch/            # 网页抓取管道
└── db/               # 数据库，只导出 CRUD 函数
```

### 错误处理
- 路由层 catch 所有异常，返回结构化 JSON 错误
- 不在 core 层 throw HTTP 错误
- SQLite 操作用事务包裹

### 日志
- 使用 `console.log`（Bun 原生支持 color）
- 格式：`[模块名] 消息`，如 `[Stream] SSE chunk parsed`
- 调试日志用 `config.debug` 守卫

## TDD 工作流程

### 测试框架
使用 Bun 内置 test runner：`bun test`

### 测试文件组织
```
src/
├── core/
│   ├── assembler.ts
│   ├── assembler.test.ts    # 与源文件同目录同名
│   ├── reasoning.ts
│   ├── reasoning.test.ts
```

### TDD 步骤
1. **Red**: 写失败的测试，明确输入/输出/行为
2. **Green**: 写最小代码让测试通过
3. **Refactor**: 重构代码，保持测试绿色
4. **Commit**: 测试通过后提交

### 测试命名
```typescript
describe('assembler', () => {
  describe('itemsToMessages', () => {
    it('converts user item to chat message', () => { ... })
    it('preserves reasoning_content in assistant items', () => { ... })
  })
})
```

### 测试原则
- 每个测试只验证一个行为
- 测试文件不超过 200 行
- Mock 外部依赖（fetch, SQLite），不 mock 内部函数
- 边界情况必须覆盖：空输入、null 字段、异常响应

### 运行测试
```bash
bun test                    # 全部测试
bun test src/core/          # 指定目录
bun test --watch            # 监听模式
```

## Git 规范

### Commit Message
```
<type>: <description>

[optional body]
```

Type:
- `feat`: 新功能
- `fix`: 修复
- `refactor`: 重构
- `test`: 测试
- `docs`: 文档
- `chore`: 构建/工具

### 分支
- `main`: 稳定版
- `feat/<name>`: 功能分支
- 不在 main 上直接开发

## 环境变量
参考 `.env.example`。敏感信息（API Key）禁止提交到 Git。

## 文档
所有设计文档在 `docs/` 目录，使用中文编写。

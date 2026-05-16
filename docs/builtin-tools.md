# 内置 ACP 工具

Fello 为 API Agent 内置了一套文件系统和执行工具，定义在 `src/agents/acp-client-tools.ts` 中。这些工具通过 Vercel AI SDK 的 `tool()` 构造，在 Agent 的 `streamText` 调用中注册。

## 工具清单

| 工具 | 描述 | 定义位置 |
|------|------|----------|
| `ReadFile` | 读取本地文件 | `acp-client-tools.ts` |
| `WriteFile` | 写入文件 | `acp-client-tools.ts` |
| `EditFile` | StrReplace 式编辑文件 | `acp-client-tools.ts` |
| `Shell` | 执行终端命令 | `acp-client-tools.ts` |
| `Plan` | 创建/更新执行计划 | `acp-client-tools.ts` |
| `GetFileOutline` | AST 文件结构预览 | `acp-client-tools.ts` + `file-outline.ts` |

---

## ReadFile

读取本地文件系统中的文本文件。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件路径（相对于工作目录或绝对路径） |
| `line` | `number` | 否 | 1-based 起始行号 |
| `limit` | `number` | 否 | 最大读取行数 |
| `cwd` | `string` | 否 | 工作目录（默认为会话的 cwd） |
| `force` | `boolean` | 否 | 是否绕过 100KB 大小限制 |

### 行为说明

- **大小限制**：完整读取（未指定 `line`/`limit`）时，文件内容超过 100KB 会拒绝读取，错误提示建议使用 `GetFileOutline` + `line`/`limit` 组合，或设置 `force=true`
- **部分读取**：指定 `line`/`limit` 时不受大小限制，因为只读取文件的部分内容
- **编码**：默认 UTF-8

---

## WriteFile

将文本内容写入文件。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件路径 |
| `content` | `string` | 是 | 文本内容 |
| `cwd` | `string` | 否 | 工作目录 |

### 行为说明

- 写入操作需要权限确认（`permissionMode` 为 `ask` 时）
- 会覆盖已有文件

---

## EditFile

使用 StrReplace 方式编辑文件。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件路径 |
| `oldText` | `string` | 是 | 要替换的旧文本（精确匹配） |
| `newText` | `string` | 是 | 替换后的新文本 |
| `replaceAll` | `boolean` | 否 | 是否替换所有匹配项 |
| `cwd` | `string` | 否 | 工作目录 |

### 行为说明

- 使用精确字符串匹配，不是正则
- 建议 `oldText` 带上前后唯一的上下文代码来确保匹配唯一
- 匹配到多个位置时，如果没设 `replaceAll=true` 会报错
- 编辑操作需要权限确认

---

## Shell

执行终端命令。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | `string` | 是 | 可执行命令 |
| `args` | `string[]` | 否 | 命令参数列表 |
| `cwd` | `string` | 否 | 工作目录 |
| `env` | `Record<string, string>` | 否 | 环境变量 |
| `outputByteLimit` | `number` | 否 | 输出保留字节限制 |
| `timeoutSeconds` | `number` | 否 | 超时时间（默认 120s） |

### 行为说明

- 存在命令执行权限检查（`permissionMode`）
- 支持超时自动终止
- 输出截断（`truncated` 字段标识）
- 优先使用专用工具（LS/Grep/Glob）替代 Shell 进行文件操作

---

## Plan

创建或更新执行计划。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entries` | `PlanEntry[]` | 是 | 计划条目列表 |

### PlanEntry

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | `string` | 任务描述 |
| `priority` | `"high" \| "medium" \| "low"` | 优先级 |
| `status` | `"pending" \| "in_progress" \| "completed"` | 状态 |

---

## GetFileOutline

AST 文件结构预览工具，**不读取文件的完整内容**。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件路径 |
| `cwd` | `string` | 否 | 工作目录 |

### 返回值

直接返回纯文本格式的结构摘要，例如：

```
File: src/shared/schema.ts
Language: TypeScript
Total lines: 585
─── Symbols ───
interface SessionNotificationFelloExt (lines 14-26)  // 扩展 SessionNotification 结构
    property update (lines 15-25)
interface BaseAgentInfo (lines 32-40)  // 代理（Agent）的配置信息
    property id (line 37)  // 代理的唯一标识符
    property disabled (line 39)  // 是否停用代理
...
```

### 实现原理

使用 `@ast-grep/napi`（Rust 原生 napi 加件）进行 AST 解析，而不是正则或 WASM：

1. 根据文件扩展名选择对应的语言解析器
2. 使用 AST 匹配目标节点类型（function_declaration、class_declaration、interface_declaration、type_alias_declaration、property_signature 等）
3. 提取每个节点的名称、行号范围、前面的 JSDoc 注释摘要
4. 以树状缩进格式输出

实现代码在 `src/agents/file-outline.ts`。

### 特性

- **不受 ReadFile 的 100KB 限制**：只返回结构元数据，不返回文件正文
- **树状结构**：顶级声明（interface/type/function/class）为一级，内部属性（property）缩进为二级
- **注释摘录**：提取每个符号前面紧邻的 JSDoc 注释的第一行
- **纯文本输出**：直接返回字符串，不包装 JSON

### 支持的语言

| 语言 | 扩展名 | 内置支持 |
|------|--------|----------|
| TypeScript | `.ts` | ✅ 默认 |
| JavaScript | `.js/.jsx/.mjs/.cjs` | ✅ 默认 |
| TSX | `.tsx` | ✅ 默认 |

> 注：`@ast-grep/napi` 默认只内置了 TypeScript、JavaScript、TSX、Html、Css 五种语言。更多语言可通过 `registerDynamicLanguage()` 加载 native 动态库扩展。

### 提取的符号类型

| AST 节点类型 | 显示标签 | 说明 |
|-------------|----------|------|
| `function_declaration` | function | 函数声明 |
| `method_definition` | method | 类方法定义 |
| `class_declaration` | class | 类声明 |
| `interface_declaration` | interface | 接口声明 |
| `type_alias_declaration` | type | 类型别名 |
| `enum_declaration` | enum | 枚举声明 |
| `property_signature` | property | 类型/接口中的属性签名（仅顶层属性，不穿透嵌套对象） |
| `arrow_function` | arrow function | 箭头函数（仅 JS） |

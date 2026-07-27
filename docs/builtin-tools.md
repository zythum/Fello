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

> **注：** `file_outline` 不是 ACP client tool，而是 Search MCP Server 提供的工具（见下方 [Search MCP — file_outline](#search-mcp--file_outline) 章节）。

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

- **大小限制**：完整读取（未指定 `line`/`limit`）时，文件内容超过 100KB 会拒绝读取，错误提示建议先使用 Search MCP 的 `file_outline` 获取结构，再通过 `line`/`limit` 分段读取，或设置 `force=true`
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
| `timeoutSeconds` | `number` | 否 | 超时时间（不指定则无超时，等待命令结束） |

### 行为说明

- 存在命令执行权限检查（`permissionMode`）
- 超时可选：仅在指定 `timeoutSeconds` 时才启用超时自动终止，未指定则等待进程退出
- 输出截断（`truncated` 字段标识）
- 优先使用可用的 Search MCP 工具（`search`、`rg`、`file_outline`）替代 Shell 进行文件检索和结构分析

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

## Search MCP — file_outline

`file_outline` 是 Search MCP Server（`src/scripts/mcp-search/server.ts`）提供的 MCP 工具，不属于 ACP client tools。使用 **web-tree-sitter**（WASM）进行 AST 解析，在独立子进程中执行。

> ReadFile 超过 100KB 时的错误提示中会建议使用 `file_outline (Search MCP)` 先了解文件结构。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `string` | 是 | 文件路径（相对于项目根、绝对路径、或 file:// URI） |

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

使用 **web-tree-sitter**（WASM 格式的 tree-sitter 绑定）在子进程中解析文件 AST：

1. 根据文件扩展名选择对应的 `.wasm` 语言 grammar 文件（位于 `process.treeSitterWasmPath` 目录下）
2. 在 fork 出的 worker 子进程中加载 WASM grammar 并解析文件
3. 按配置的符号类型提取目标 AST 节点
4. 以树状缩进格式输出符号名、行号范围和注释摘要

实现代码在 `src/backend/search/file-outline.ts`。

### 特性

- **不受 ReadFile 的 100KB 限制**：只返回结构元数据，不返回文件正文
- **树状结构**：顶级声明为一级，内部属性缩进为二级
- **注释摘录**：提取每个符号前面紧邻的 JSDoc/Docstring 注释
- **纯文本输出**：直接返回字符串，不包装 JSON
- **Markdown 内置解析**：`.md/.mdx/.markdown` 使用内置正则解析标题层级，不依赖 WASM

### 支持的语言

| 语言 | 扩展名 |
|------|--------|
| TypeScript | `.ts` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| TSX | `.tsx` |
| Python | `.py` |
| Go | `.go` |
| C | `.c`, `.h` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.hh` |
| Swift | `.swift` |
| Kotlin | `.kt`, `.kts` |
| Dart | `.dart` |
| Markdown | `.md`, `.mdx`, `.markdown`（内置解析器） |

### 提取的符号类型（因语言而异）

**TypeScript/TSX/JavaScript 核心：**

| AST 节点类型 | 显示标签 | 说明 |
|-------------|----------|------|
| `function_declaration` | function | 函数声明 |
| `method_definition` | method | 类方法定义 |
| `class_declaration` | class | 类声明 |
| `interface_declaration` | interface | 接口声明 |
| `type_alias_declaration` | type | 类型别名 |
| `enum_declaration` | enum | 枚举声明 |
| `internal_module` | namespace | 命名空间 |
| `property_signature` | property | 类型/接口中的属性签名（仅 TypeScript，maxDepth=1） |
| `lexical_declaration` | const/let | 顶层变量声明 |
| `import_statement` | import | 导入语句 |

**Python：** function_definition, class_definition, import_statement, import_from_statement

**Go：** package_clause, function_declaration, method_declaration, type_spec, field_declaration, const_spec, import_declaration

**C/C++：** function_definition, struct_specifier, union_specifier, enum_specifier, type_definition, class_specifier (C++), namespace_definition (C++)

**Swift：** class_declaration, protocol_declaration, function_declaration, init_declaration, property_declaration, typealias_declaration

**Kotlin：** class_declaration, function_declaration, object_declaration, type_alias, property_declaration

**Dart：** class_definition, enum_declaration, mixin_declaration, extension_declaration, function_signature, method_signature, type_alias

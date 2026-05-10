# 数据存储设计与结构

Fello 的所有用户数据均持久化存储在用户主目录下的 `.fello` 文件夹中（例如 macOS/Linux 下的 `~/.fello`）。数据以纯文本（JSON / NDJSON）格式保存，无需依赖额外的数据库服务。这种设计保证了数据的透明性、便携性以及低维护成本。

## 目录结构

```text
~/.fello/
├── settings.json                  # 全局设置（代理配置、MCP 服务器、主题、语言等）
├── projects/                      # 项目工作区数据（Stdio Agent 会话）
│   └── <project_id>/              # 每个项目一个独立文件夹，<project_id> 是项目路径 cwd 的 SHA1 哈希值
│       ├── project.json           # 该项目的元数据
│       └── sessions/              # 该项目下的所有会话记录
│           └── <session_id>/      # 每个会话一个独立文件夹，<session_id> 格式为 `<agent_id>:<resume_id>`
│               ├── session.json   # 该会话的元数据
│               ├── messages.jsonl # 历史会话流事件日志 (NDJSON)
│               └── terminals/     # 终端输出日志
│                   └── <terminal_id>.log
├── api-agents/                    # API Agent 会话数据
│   └── <agent_id>/                # 每个 API Agent 一个独立文件夹
│       └── sessions/
│           └── <session_id>/      # 每个会话独立文件夹（UUID）
│               ├── session.json   # 会话状态（modelId, allowedToolKinds）
│               └── history.jsonl  # 对话历史 (NDJSON ModelMessage)
└── ilink/                         # 微信 iLink 数据
    ├── credentials.json           # 登录凭证（权限 0o600）
    ├── cursor.json                # 消息轮询游标
    └── active-session.json        # 当前活跃会话 ID
```

## 数据文件及字段详解

### 1. 全局设置 (`settings.json`)
保存用户的全局偏好设置。如果在启动时文件不存在，系统会自动使用默认配置创建。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `agents` | `Array` | 代理（Agent）配置列表。支持两种类型 |
| ↳ StdioAgentInfo | `object` | `type: "stdio"` |
| &nbsp;&nbsp;↳ `id` | `string` | 代理的唯一标识符（如 `"kiro"`） |
| &nbsp;&nbsp;↳ `command` | `string` | 启动该代理的命令（如 `"kiro-cli"`） |
| &nbsp;&nbsp;↳ `args` | `string[]` | 启动参数列表（如 `["acp"]`） |
| &nbsp;&nbsp;↳ `env` | `Record<string, string>` | 运行时所需环境变量 |
| &nbsp;&nbsp;↳ `disabled` | `boolean` | 是否停用该代理 |
| ↳ ApiAgentInfo | `object` | `type: "api"` |
| &nbsp;&nbsp;↳ `id` | `string` | 代理的唯一标识符（如 `"deepseek"`） |
| &nbsp;&nbsp;↳ `provider` | `string` | 兼容层提供商标识（如 `"openai-compatible"`） |
| &nbsp;&nbsp;↳ `baseUrl` | `string` | API 服务基础地址 |
| &nbsp;&nbsp;↳ `apiKey` | `string` | API 鉴权密钥 |
| &nbsp;&nbsp;↳ `headers` | `Record<string, string>` | 可选的额外请求头 |
| &nbsp;&nbsp;↳ `disabled` | `boolean` | 是否停用该代理 |
| `mcpServers` | `Array` | MCP（Model Context Protocol）服务器配置列表。支持两种类型 |
| ↳ StdioMcpServerInfo | `object` | `type: "stdio"` |
| &nbsp;&nbsp;↳ `id` | `string` | MCP 服务器的唯一标识符 |
| &nbsp;&nbsp;↳ `command` | `string` | 启动该 MCP 服务器的命令 |
| &nbsp;&nbsp;↳ `args` | `string[]` | 启动参数列表 |
| &nbsp;&nbsp;↳ `env` | `Record<string, string>` | 运行时所需环境变量 |
| &nbsp;&nbsp;↳ `disabled` | `boolean` | 是否停用该 MCP 服务器 |
| ↳ HttpMcpServerInfo | `object` | `type: "http"` |
| &nbsp;&nbsp;↳ `id` | `string` | MCP 服务器的唯一标识符 |
| &nbsp;&nbsp;↳ `url` | `string` | MCP Server 的 HTTP(S) 地址 |
| &nbsp;&nbsp;↳ `headers` | `Record<string, string>` | 请求时附加的请求头 |
| &nbsp;&nbsp;↳ `disabled` | `boolean` | 是否停用该 MCP 服务器 |
| `theme` | `Object` | 主题设置。 |
| ↳ `theme_mode` | `"light" \| "dark" \| "system"` | UI 主题模式。 |
| `i18n` | `Object` | 国际化设置。 |
| ↳ `language` | `string` | 当前使用的语言代码（如 `"en"`, `"zh-CN"`）。 |

### 2. 项目元数据 (`projects/<project_id>/project.json`)
管理用户添加的各个本地代码仓库或工作区。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 项目的唯一标识符。生成规则：`SHA1(cwd)`。 |
| `title` | `string` | 项目的显示名称。默认取 `cwd` 目录的 basename（如 `"fello"`）。 |
| `cwd` | `string` | 项目的绝对路径。 |
| `created_at` | `number` | 项目的创建时间（**毫秒级**时间戳，如 `Date.now()`）。 |
| `updated_at` | `number` | 项目的最后更新时间（**毫秒级**时间戳）。 |

### 3. 会话元数据 (`projects/<project_id>/sessions/<session_id>/session.json`)
记录用户在特定项目中与特定 Agent 的对话历史元数据。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | Fello 侧的会话唯一标识。生成规则：`<agent_id>:<resume_id>`。 |
| `title` | `string` | 会话的显示标题（默认初始为 `"New Chat"`，API Agent 会话首次发消息时自动生成）。 |
| `agent_id` | `string` | 该会话使用的代理 ID（关联 `settings.json` 中的 Agent）。 |
| `resume_id` | `string` | **[关键]** Agent 侧（如 ACP 协议底层）的真实会话 ID，用于向 Agent 恢复历史上下文。 |
| `project_id` | `string` | 该会话所属的项目 ID。 |
| `cwd` | `string` | 会话的当前工作目录。 |
| `created_at` | `number` | 会话的创建时间（**毫秒级**时间戳）。 |
| `updated_at` | `number` | 会话的最后更新时间（**毫秒级**时间戳），用户每次发送新消息或修改标题时会更新此字段。 |
| `mcp_servers` | `string[]` | 该会话启用的 MCP Server ID 列表。 |
| `permission_mode` | `"ask" \| "allow-all"` | 权限模式：每次询问或默认全部允许。 |
| `models` | `SessionModelState \| null` | 会话的模型配置缓存，包含可用模型及当前选中的模型 ID。 |
| `modes` | `SessionModeState \| null` | 会话的模式配置缓存（仅 Stdio Agent）。 |
| `initialize_info` | `InitializeResponse \| null` | 代理的初始化信息缓存（包括代理能力、名称、版本等）。 |

> **⚠️ 关于 `id` 与 `resume_id` 的防混淆提示**：
> 在 Fello 的后端逻辑中，`session.id` 仅用于 Fello 自身管理 UI 侧的路由和列表。
> 当需要与底层的 ACP 服务（Agent 进程）通信时（例如 `loadSession` 或 `prompt`），必须传入 `session.resume_id`，绝不能传入 `session.id`。

### 4. API Agent 会话状态 (`api-agents/<agent_id>/sessions/<session_id>/session.json`)
存储 API Agent 会话的运行时状态，由 `OpenaiCompatibleAgent` 管理。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `modelId` | `string \| null` | 当前选中的模型 ID。 |
| `allowedToolKinds` | `string[]` | 被"始终允许"的工具权限种类列表。 |

### 5. 历史会话流事件 (`messages.jsonl` / `history.jsonl`)

**Stdio Agent (`messages.jsonl`)**：存储由 ACP 协议产生的会话状态增量更新日志（Event Stream）。

| 特性 | 说明 |
| :--- | :--- |
| **格式** | **NDJSON** (Newline Delimited JSON)，每行是一个完整的 `SessionNotificationFelloExt` 对象。 |
| **持久化机制** | 由主进程拦截 `session-update` 事件，通过追加（Append）方式落盘写入文件。 |
| **读取与恢复** | 在 `loadSession` 时，Fello 会将此文件按行解析，依次在主进程中重新分发（Replay）到前端 Store 的 Reducer，进而完美还原整个历史会话界面。 |

**API Agent (`history.jsonl`)**：由 `OpenaiCompatibleAgent` 直接管理，存储 AI SDK 的 `ModelMessage` 数组。

| 特性 | 说明 |
| :--- | :--- |
| **格式** | **NDJSON**，每行是一个 `ModelMessage` 对象（含 `role` 和 `content`）。 |
| **持久化机制** | 每次 `prompt` 完成后追加用户消息和助手响应。 |
| **读取与恢复** | 在 `resumeSession` 时按行解析，恢复完整的对话历史到 `session.history`。 |

### 6. 终端日志 (`terminals/<terminal_id>.log`)

存储 Agent 在运行过程中通过终端输出的日志内容。终端日志被持久化到当前会话的 `terminals` 目录下，确保会话休眠后或重启应用时终端输出不丢失。

### 7. iLink 数据 (`ilink/`)

| 文件 | 说明 |
| :--- | :--- |
| `credentials.json` | 微信 iLink 登录凭证（token、userId、accountId 等），权限 0o600 |
| `cursor.json` | 消息轮询游标，用于增量获取新消息 |
| `active-session.json` | 当前 iLink 活跃的 Fello 会话 ID，用于将微信消息路由到特定会话 |

---

- **纯同步操作**：后端在部分场景（如 API Agent session.json 的写入/删除）使用了 Node.js `fs` 模块的同步方法。考虑到配置文件均为小型 JSON，这避免了复杂的异步处理，同时内存占用和 IO 开销极小。
- **自动容错与降级**：在读取文件时采用了 `try/catch` 包裹，并在必要字段使用类型回退（Fallback）。如果 JSON 解析失败、字段结构变更或文件缺失，会返回默认对象或 `null`，确保整个后端不至于崩溃。
- **时间单位统一**：项目元数据存储的时间戳为毫秒级（`Date.now()`），与前端保持一致。

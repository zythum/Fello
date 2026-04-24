# 数据存储设计与结构

Fello 的所有用户数据均持久化存储在用户主目录下的 `.fello` 文件夹中（例如 macOS/Linux 下的 `~/.fello`）。数据以纯文本（JSON）格式保存，无需依赖额外的数据库服务。这种设计保证了数据的透明性、便携性以及低维护成本。

## 目录结构

```text
~/.fello/
├── settings.json               # 全局设置（代理配置、主题、语言等）
└── projects/                   # 项目工作区数据
    └── <project_id>/           # 每个项目一个独立文件夹，<project_id> 是项目路径 cwd 的 SHA1 哈希值
        ├── project.json        # 该项目的元数据
        └── sessions/           # 该项目下的所有会话记录
            └── <session_id>/   # 每个会话一个独立文件夹，<session_id> 格式为 `<agent_id>:<resume_id>`
                └── session.json# 该会话的元数据
```

## 数据文件及字段详解

### 1. 全局设置 (`settings.json`)
保存用户的全局偏好设置。如果在启动时文件不存在，系统会自动使用默认配置创建。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `agents` | `Array` | 代理（Agent）配置列表。 |
| ↳ `id` | `string` | 代理的唯一标识符（如 `"kiro"`）。 |
| ↳ `command` | `string` | 启动该代理的命令（如 `"kiro-cli"`）。 |
| ↳ `args` | `string[]` | 启动参数列表（如 `["acp"]`）。 |
| ↳ `env` | `Record<string, string>` | 运行时所需环境变量。 |
| `mcpServers` | `Array` | MCP（Model Context Protocol）服务器配置列表。 |
| ↳ `id` | `string` | MCP 服务器的唯一标识符。 |
| ↳ `command` | `string` | 启动该 MCP 服务器的命令。 |
| ↳ `args` | `string[]` | 启动参数列表。 |
| ↳ `env` | `Record<string, string>` | 运行时所需环境变量。 |
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
| `created_at` | `number` | 项目的创建时间（**秒级**时间戳，例如 `Math.floor(Date.now() / 1000)`）。 |

### 3. 会话元数据 (`projects/<project_id>/sessions/<session_id>/session.json`)
记录用户在特定项目中与特定 Agent 的对话历史元数据。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | Fello 侧的会话唯一标识。生成规则：`<agent_id>:<resume_id>`。 |
| `title` | `string` | 会话的显示标题（默认初始为 `"New Chat"`）。 |
| `agent_id` | `string` | 该会话使用的代理 ID（关联 `settings.json` 中的 Agent）。 |
| `resume_id` | `string` | **[关键]** Agent 侧（如 ACP 协议底层）的真实会话 ID，用于向 Agent 恢复历史上下文。 |
| `project_id` | `string` | 该会话所属的项目 ID。 |
| `created_at` | `number` | 会话的创建时间（**秒级**时间戳）。 |
| `updated_at` | `number` | 会话的最后更新时间（**秒级**时间戳），用户每次发送新消息或修改标题时会更新此字段，用于会话列表的排序。 |
| `mcp_servers` | `string[]` | 该会话启用的 MCP Server ID 列表。 |
| `models` | `SessionModelState \| null` | 会话的模型配置缓存，包含可用模型及当前选中的模型 ID，用于离线降级和 UI 渲染。 |
| `modes` | `SessionModeState \| null` | 会话的模式配置缓存，包含可用模式及当前选中的模式 ID，用于离线降级和 UI 渲染。 |
| `initialize_info` | `InitializeResponse \| null` | 代理的初始化信息缓存（包括代理能力、名称、版本等），用于在未连接代理时预渲染 UI 控件（如附件上传按钮）。 |

> **⚠️ 关于 `id` 与 `resume_id` 的防混淆提示**：
> 在 Fello 的后端逻辑中，`session.id` 仅用于 Fello 自身管理 UI 侧的路由和列表。
> 当需要与底层的 ACP 服务（Agent 进程）通信时（例如 `loadSession` 或 `prompt`），必须传入 `session.resume_id`，绝不能传入 `session.id`。

### 4. 历史会话流事件与终端日志

#### 历史会话流事件 (`projects/<project_id>/sessions/<session_id>/messages.jsonl`)

存储由 ACP 协议产生的会话状态增量更新日志（Event Stream）。

| 特性 | 说明 |
| :--- | :--- |
| **格式** | **NDJSON** (Newline Delimited JSON)，每行是一个完整的序列化 `SessionNotification` 对象。 |
| **持久化机制** | 由主进程拦截 `session-update` 事件，通过追加（Append）方式落盘写入文件，无并发竞争和内存瓶颈。 |
| **读取与恢复** | 在 `loadSession` 时，Fello 会将此文件按行解析，依次在主进程中重新分发（Replay）到前端 Store 的 Reducer，进而完美还原整个历史会话界面。这意味着 Fello **不依赖** Agent 进程去记录历史状态。 |

#### 终端日志 (`projects/<project_id>/sessions/<session_id>/terminals/<terminal_id>.log`)

存储 Agent 在运行过程中通过终端输出的日志内容。终端日志被持久化到当前会话的 `terminals` 目录下，确保会话休眠后或重启应用时终端输出不丢失，可以随会话状态一起被完整恢复。

- **纯同步操作**：后端直接使用了 Node.js `fs` 模块的 `readFileSync`, `writeFileSync`, `mkdirSync` 等同步方法。考虑到配置文件均为小型 JSON，这避免了复杂的异步处理，同时内存占用和 IO 开销极小。
- **自动容错与降级**：在读取文件时采用了 `try/catch` 包裹，并在必要字段使用类型回退（Fallback）。如果 JSON 解析失败、字段结构变更（如历史版本的 `command` 迁移）或文件缺失，会返回默认对象或 `null`，确保整个后端不至于崩溃。
- **时间单位统一**：存储的时间戳均为秒级（`Seconds`），不同于前端惯用的毫秒级。

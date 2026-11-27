# 个人助理（Personal Assistant）

个人助理是 Fello 内置的常驻助手：每个助理拥有自己的配置、workspace、对话历史、长期记忆、提醒和 worker。它可以创建多个，但每个助理内部始终只有一个模型会话。

本文描述当前已实现的机制。使用说明见 [`guides/zh-CN/assistant.md`](../guides/zh-CN/assistant.md) 与 [`guides/en/assistant.md`](../guides/en/assistant.md)。

## 定位与边界

- **伪会话**：`assistantId` 同时充当 Fello 侧的伪 session id，路由为 `/assistant/:assistantId`。助理不会进入项目的会话列表，也不会创建真实的 `ProjectInfo` / `SessionInfo` 记录。
- **单会话**：每个助理只有一个模型会话（`session/history.jsonl`），没有「新建会话」，也没有向量检索。记忆与日记都是人类可读的 Markdown。
- **进程内 ACP Agent**：`AssistantAgent` 实现 ACP Agent 接口，由 `backend/assistant/index.ts` 通过 `ACPBridge` 挂在主进程内，不额外 spawn 子进程。
- **来源 Agent 限制**：`sourceAgentId` 必须指向一个已启用、`provider: "openai-compatible"` 的 API Agent；Stdio Agent 不能作为助理来源。
- **工具面按需扩张**：当前包含时间、日记检索、提醒、文件系统、ask_user、分享、MCP 和 worker；没有通用终端、项目记忆或会话层 subagent 工具。
- **文件边界不是沙箱**：助理可读取本机任意文件；写入只硬性禁止助理运行时目录（`~/.fello/assistants/**` 及旧版目录），删除只允许 workspace 内路径。workspace 外写入依赖系统提示词要求模型先 `ask_user` 征得同意，不是强制拦截。

## 模块分层

| 位置 | 职责 |
| :--- | :--- |
| `src/assistant/config.ts` | 助理配置、目录布局、创建 / 更新 / 删除（含 workspace） |
| `src/assistant/storage.ts` | 每助理持久化：`state.json`、`history.jsonl`、`memory.md`、`chat/messages*.jsonl` 分段 |
| `src/assistant/assistant-agent.ts` | 进程内 ACP Agent：模型 / 思考等级、prompt 循环、系统提示词、工具装配、Dream 调度 |
| `src/assistant/dream.ts` | 记忆沉淀：结构化输出日记与长期记忆，清空模型历史 |
| `src/assistant/reminders/` | 提醒存储、定时器、`reminder_*` 工具 |
| `src/assistant/fs/` | `fs_*` 工具与路径保护 |
| `src/assistant/worker/` | 暴露给助理的 `worker_*` 工具与类型 |
| `src/assistant/diary-query.ts` | 日记检索子代理与 `diary_query` 工具 |
| `src/assistant/mcp-tools.ts` | 按助理配置懒连接 MCP Server |
| `src/assistant/ask-user-tool.ts` / `current-time-tool.ts` / `tool-updates.ts` | 其余内置工具与工具调用事件 |
| `src/backend/assistant/index.ts` | `AssistantManager` / 每助理 runtime：启动、状态广播、通知持久化、唤醒队列、iLink |
| `src/backend/assistant/worker/` | WorkerManager 与 worker 记录 / 转写存储 |
| `src/mainview/components/assistant/` | 助理页面：聊天列、详情、右侧面板 |
| `src/mainview/components/settings/assistant/` | 设置页：全局开关与 worker 类型 |
| `src/shared/assistant.ts` | workspace 的虚拟 project id |

## 生命周期

### 全局与单个助理

- `settings.assistant.enabled` 是全局开关。关闭后所有助理 runtime 停止，侧边栏的助理分区隐藏。
- 每个助理的 `config.json.disabled` 只影响自己；停用后不启动 bridge、提醒和 worker，但数据保留。
- 应用启动时 `assistant.startAll()` 只启动「全局开启 + 未 disabled」的助理。
- 每个 runtime 的 `start()` 会加载提醒、创建 workspace、连接 `ACPBridge` 并 `loadSession`。连接状态通过 `assistant-status-changed` 广播。

### 创建 / 配置 / 删除

- 创建：在侧边栏「个人助理」分区点击新增，填写名称、来源 Agent、MCP。后端生成 `pa_xxxxxxxx` id，创建全部目录并立即启动（若全局开启）。
- **立即生效**：名称、`disabled`。
- **重启生效**：来源 Agent、MCP、Dream 的 `maxContextTokens` / `preferredTime`。聊天头部的配置 Popover 只在点击「重启助理」时调用 `restartAssistant` 写入并重启 bridge。
- 全局开关变化会启动 / 停止所有助理；Agent / MCP 配置变化会重启受影响的助理（`applySettingsChange`）。worker 类型按需读取：修改或启停类型后，下一次 prompt 或新建 worker 会直接使用新列表，不需要重启助理。
- 删除是硬删除：`~/.fello/assistants/<id>/` 与 `~/.fello/workspaces/__assistant__<id>__/` 一起移除。若该助理是 iLink 活跃会话，会先清除活跃会话。

### 与 iLink

个人助理可以作为 iLink 的活跃会话。通知转发、工具调用时 flush、prompt 结束时 flush 都复用会话层逻辑；`assistant-reminder-due` 与 `open-assistant-requested` 支持从系统通知回到助理页。

## 运行时

### AssistantAgent

- 通过 `createOpenAICompatible` 直连来源 Agent 的 `baseUrl` / `apiKey` / `headers`。
- 模型列表优先取来源 Agent 手填的 `models`；否则请求 `/models`，失败回退空列表。
- 思考等级固定为 `auto` / `max` / `high` / `low`，默认 `auto`；非 `auto` 时映射为 `openaiCompatible.reasoningEffort`。
- 上下文窗口大小取来源 Agent 的 `contextWindowTokens`，默认 `128_000`，用于 `usage_update.size`。
- 每次 prompt：
  1. 检查是否需要在提问前执行 Dream（`required` 时同步等待）。
  2. 组装 system prompt、历史、当前用户消息和工具，调用 `streamText`。
  3. 文本 / 推理增量分别以 `agent_message_chunk` / `agent_thought_chunk` 推送。
  4. 结束后把本轮 `ModelMessage` 追加到 `session/history.jsonl`，更新 usage 与 Dream 状态。
- 单轮最多 128 个 inline step。存在 worker 工具时，第 8 个 step 左右会注入一次仅当轮可见的 `[Fello notice="budget"]`，建议把剩余长任务交给 worker；该提示不写历史、不收缩工具、不强制停止。
- 取消或异常时，把用户消息与已生成文本（标记 `[Cancelled]` / `[Interrupted]`）写回历史，保证下一轮上下文完整。

### 系统提示词

`buildSystemPrompt()` 由以下部分组成：

- 身份：使用用户填写的助理名称（`sanitizeAssistantName` 压平单行、去控制字符 / 尖括号 / 引号 / 反引号，限长 60 字符），为空则回退默认身份。
- 环境：workspace 路径；本机文件与日记视为不可信数据。
- Delegation：存在 worker 类型时要求长任务交给 worker；没有类型时要求自己完成。
- Tools：内置工具说明、`mcp_<server>__<tool>` 约定、worker 工具说明。
- Rules：`[Reminder ...]` / `[Worker ...]` / `[Fello ...]` 是应用注入事件，不是用户发言；提醒 `retry="N"` 的语义；不要声称未执行的工作。
- Memory：非空时以 `<assistant_memory>` 包裹注入 `memory.md`，并声明其为数据而非指令。

### 工具

| 工具 | 作用 |
| :--- | :--- |
| `current_time` | 当前时间，可指定 IANA 时区 |
| `diary_query` | 由一个只读子代理检索日记（`list_diaries` / `grep_diaries` / `read_diary`）并回答 |
| `reminder_create` / `reminder_list` / `reminder_occurrences` / `reminder_update` / `reminder_delete` | 用户提醒 |
| `fs_list` / `fs_read` / `fs_write` / `fs_edit` / `fs_move` / `fs_delete` / `fs_glob` / `fs_grep` | 文件读写、编辑、移动、删除与搜索 |
| `ask_user` | 阻塞式提问，直接复用会话的 Ask User 通道（`sessionId = assistantId`） |
| `mcp_assistant_share__share_to_user` | 内置分享 MCP，只允许分享 workspace 内已存在的文件（`type="project"`），不支持 link / base64 |
| `mcp_<server>__<tool>` | 用户在助理配置中勾选的 MCP Server |
| `worker_run` / `worker_create` / `worker_send` / `worker_status` / `worker_list` / `worker_read` / `worker_cancel` / `worker_close` / `worker_terminate` / `worker_permission` | 后台 ACP 子代理，仅在存在可用 worker 类型时暴露 |

文件工具的限制：

- `fs_read`：单文件最多 4 MB；每次最多 400 行，返回内容按 300 KB 预算保留前面的行，单行超过 1024 字符会截断并标注；二进制拒绝。不带 `line` / `limit` 的整文件读取另有 100 KB 门槛，`force: true` 同时放开 100 KB 与 400 行上限、返回整个文件（与 ACP `ReadFile` 一致，仍受 4 MB 与 300 KB 约束）。
- `fs_write`：单次最多 256 KB，支持 `overwrite` / `append`，自动建父目录。
- `fs_edit`：按 `oldText` 精确替换（StrReplace），文件上限 4 MB；`oldText` 必须唯一命中，多命中要先加长上下文或传 `replaceAll: true`，未命中直接报错且不改文件。`fs_write` / `fs_edit` 完成时会给界面发 `diff` 内容块，文件超过 300 KB 时只发文本摘要。
- `fs_list`：最多 200 项；`fs_glob` 最多 500 条；`fs_grep` 每个文件最多 500 条匹配（ripgrep `-m`），超长匹配行默认按 1024 字节截断，`maxColumns: 0` 关闭截断。
- `fs_move`：目标已存在且未传 `force: true` 时拒绝；跨卷回退为复制后删除。
- `fs_delete`：只允许 workspace 内路径，拒绝 workspace 根。桌面端进系统废纸篓（`shell.trashItem`），无头服务器回退永久删除。
- 写入 / 移动 / 删除都会经过 `assertWritablePath`，拒绝 `~/.fello/assistants/**` 与旧版 `~/.fello/assistant/{agent,session,diary}`。

助理自身的 ACP 权限请求默认 `deny`；内置工具由 `AssistantAgent` 直接执行，不会弹出工具授权框。MCP 工具是否可用完全由助理配置里的勾选决定。

### Workspace

- 目录：`~/.fello/workspaces/__assistant__<id>__/`。
- 虚拟 project id 与目录名相同（`assistantProjectId()`），文件面板、文件路由和分享都通过它寻址，不进入侧边栏项目列表。
- 相对路径默认相对 workspace；worker 的 workspace 也以它作为相对根。

## Dream（记忆沉淀）

Dream 是助理唯一的上下文整理机制，与会话层的「上下文压缩」是两件事。对外中文文案统一使用「记忆沉淀」，不要与会话层的「上下文压缩」混用。

### 触发条件

- `historyTokens` 为模型历史序列化后的 token 数；`contextTokens = historyTokens + systemPrompt tokens`。
- `contextTokens >= dream.maxContextTokens` → `dreamUrgency = "required"`。本轮结束后立即后台执行；下一次提问前若仍未完成，会同步等待。
- `historyTokens >= 8_000` 且未超限 → `scheduled`。在 `preferredTime`（默认 `02:00`）执行。
- 没有历史或没有模型时不执行。

### 调度

- 目标时刻存在 `session/state.json` 的 `dreamScheduledFor`。
- 定时器按最多 15 分钟一段重新校准，避免系统休眠导致长 timeout 失效。
- 启动时若目标时刻已过且仍需 Dream，会立即补跑；失败或完成后清空目标并排下一次，避免在同一目标上反复重试。若上下文仍然超限，下一轮结束后会再次触发。
- 正在流式输出时不打断；本轮结束后再补跑。

### 产出

一次 Dream 使用一次结构化输出（`maxOutputTokens = 16_000`）：

- 日记：`memory/diary/<start>--<end>.md`，frontmatter 含 `startTime` / `endTime` / `tags` / `model` / `sourceDigest`，正文分节：Summary / Timeline / Facts / Decisions / Commitments / Preferences / Open questions。
- 长期记忆：`memory/memory.md`，分节 Facts / Preferences / Commitments / Ongoing context，整体预算 6,000 字符。
- 清空 `session/history.jsonl`，并把 `historyStartedAt` / `historyTokens` / `needsDream` / `dreamUrgency` / `dreamScheduledFor` 重置；`lastDreamAt` 记录结束时间。
- `chat/messages*.jsonl` 不删除，界面上的对话记录仍然保留。

Dream 采用整体重写而不是追加；如果模型返回不符合 schema 的结构化输出，会生成可读错误（含字段路径）并显示在聊天头部下方。关闭提示会调用 `dismissAssistantDreamError` 清空后端状态，离开页面再回来不会重现。

### 手动触发

用量 Popover 的「立即沉淀」→ `runAssistantDream`。只要求：已连接、非流式、非 Dream 中、有模型、有历史；**不检查 8k token 门槛，也不检查是否超限**。返回 `{ started: true }` 或原因（`not-connected` / `busy` / `empty` / `no-model`），前端据此提示。

## 提醒（Reminders）

- 存储：`reminders/reminders.json`，每条包含 `id`、`text`、`trigger`、`disabled`、`firedAt`、`createdAt`、`updatedAt`。
- `trigger` 二选一：`{ type: "once", at }` 或 `{ type: "cron", expr }`（5 段式，服务端本地时区）。
- 提醒定时器只在助理 runtime 启动期间运行；停用助理不会弹通知。
- 一次性提醒只有在「到点前已武装」时才会触发。应用关闭期间错过的一次性提醒保持错过状态，不会补发。
- 到点时：
  1. 立即广播 `assistant-reminder-due`，由主进程决定是否显示系统通知。
  2. 生成一条 wake 消息（`[Reminder id="..."] text`），等待助理连接且空闲（非流式、非 Dream）后注入聊天。
  3. 提醒 wake 最多等待 1 小时；过期丢弃。投递失败会带 `retry="N"` 重试，避免模型把同一条提醒当成多次用户输入。
  4. 投递成功后写入 `firedAt`；一次性提醒随即停止。
- 日历面板按天展示提醒触发时间、倒计时 / 已触发 / 已错过状态，以及当天的日记条目。Dream 完成后会自动刷新日记列表。

## Worker（后台子代理）

Worker 是助理驱动的普通 ACP 会话，不是 Fello 的 session 记录，也没有任务对象。

### 类型

- 全局配置：`settings.assistant.workerTypes`，所有助理共享。
- 每个类型包含：`id`、`name`、`description`、`enabled`、`agentId`、`modelId`、`permissionMode`、`features`、`mcpServers`、`instructions`。
- `features` 只能是 `WORKER_FEATURES`（全部 feature 去掉 `memory`）。
- 只有「类型 enabled + `agentId` 存在 + 对应 Agent 未 disabled」的类型才会暴露给助理。一个可用类型都没有时，助理不会获得任何 `worker_*` 工具，系统提示词也会改为「全部自己做」。
- 创建 worker 时会把类型配置快照进 `workers/<id>/session.json`；之后删除类型不会影响已存在的 worker。

### 工具与生命周期

| 工具 | 行为 |
| :--- | :--- |
| `worker_run` | `create` + `send` 的语法糖，适合一次性任务；返回 `workerId` / `turnId`，后台继续 |
| `worker_create` | 只创建，不启动；用于同一 worker 多轮对话 |
| `worker_send` | 发送一轮并立即返回；worker 未连接时先重连同一 ACP 会话 |
| `worker_status` | 生命周期、连接状态、最近 10 轮、pending 权限 |
| `worker_list` | 列出该助理的 worker |
| `worker_read` | 读取一轮对话（默认最新一轮），支持 `afterEntry` 分页、`summary` / `full`、是否包含思考 |
| `worker_cancel` | 取消当前轮，保留进程 |
| `worker_close` | 杀掉 Agent 进程但保留记录与转写；下次 `worker_send` 重连 |
| `worker_terminate` | 删除记录与转写；**不删除 workspace** |
| `worker_permission` | 回答 worker 的权限请求（`allow_once` / `allow_always` / `deny`） |

- 每轮 prompt 末尾都会追加统一的 `[Fello worker]` 报告格式（Status / Done / Files / Blockers），因为 worker 是别人的 Agent，无法修改其系统提示词。
- 一轮结束或失败后，通过 wake 注入 `[Worker ... event="finished|failed"]`，带末尾 1500 字符输出；权限请求注入 `[Worker ... event="permission"]`。
- 权限请求 10 分钟未回答自动拒绝（`cancelled`）；`permissionMode: "allow-all"` 时直接选择 allow。
- 应用正常退出会把运行中的 worker 取消并标记 `idle`；崩溃后下次启动由 `init()` 标记为 `interrupted`，助理可通过 `worker_status` / `worker_list` 看到状态并自行决定是否继续。
- 状态：`running` / `awaiting_permission` / `idle` / `failed` / `closed` / `interrupted`；连接状态：`connected` / `connecting` / `disconnected`。

### 存储

`workers/<worker_id>/`：

- `session.json`：worker 记录（类型快照、agent、model、workspace、`resumeId`、状态、轮数、最后错误等）。
- `messages*.jsonl`：原始 ACP 通知分段，供只读详情页回放。
- `turns.jsonl`：轮次元数据（prompt、startedAt / endedAt、stopReason、error、segmentId）。

## 数据与持久化

```text
~/.fello/
├── assistants/<assistant_id>/
│   ├── config.json                 # 身份、来源 Agent、MCP、Dream 配置
│   ├── session/
│   │   ├── state.json              # 模型、思考等级、usage、Dream 状态
│   │   └── history.jsonl           # 模型可见历史（NDJSON ModelMessage）
│   ├── chat/
│   │   └── messages*.jsonl         # UI 通知流分段
│   ├── memory/
│   │   ├── memory.md               # 长期记忆（Dream 整体重写）
│   │   └── diary/<start>--<end>.md # 日记
│   ├── reminders/reminders.json
│   └── workers/<worker_id>/
│       ├── session.json
│       ├── messages*.jsonl
│       └── turns.jsonl
└── workspaces/
    └── __assistant__<assistant_id>__/   # 助理 workspace（虚拟 project）
```

### config.json

| 字段 | 说明 |
| :--- | :--- |
| `id` | `pa_` + 8 位十六进制；同时是伪 session id，不能包含 `:` |
| `name` | 展示名称；创建时留空会生成「个人助理 N」这类本地化默认名 |
| `disabled` | 停用后保留数据、不启动 |
| `createdAt` | 创建时间 |
| `sourceAgentId` | 来源 API Agent id；`null` 表示未配置 |
| `mcpServers` | 该助理可用的全局 MCP Server id |
| `dream.maxContextTokens` | Dream 硬上限，默认 `96_000`，必须 ≤ 来源 Agent 的上下文窗口 |
| `dream.preferredTime` | 每日 Dream 时间，`HH:mm`，默认 `02:00` |

### session/state.json

| 字段 | 说明 |
| :--- | :--- |
| `modelId` | 当前模型；来源 Agent 的模型列表变化后自动回退首个可用模型 |
| `thoughtLevel` | `auto` / `max` / `high` / `low` |
| `contextUsedTokens` | 最近一轮 input + output token 数 |
| `lastDreamAt` | 上次 Dream 结束时间 |
| `historyStartedAt` | 当前 Dream 周期的起点；Dream 后清空 |
| `historyTokens` | 历史序列化后的 token 数 |
| `needsDream` / `dreamUrgency` | 是否需要 Dream，以及 `none` / `scheduled` / `required` |
| `dreamScheduledFor` | 当前已武装的 Dream 目标时刻 |

### 两套历史

- `session/history.jsonl`：模型可见的 `ModelMessage`，Dream 会清空它。
- `chat/messages*.jsonl`：UI 通知流，Dream 不清空。segment 0 为 `messages.jsonl`，后续为 `messages-000001.jsonl` 递增。
- 助理的 `chat` 分段规则与普通会话一致：每个 segment 最多 20 个完整 user group 或 16 MiB；打开最新 segment 时若不足 20 个 user group 且存在前驱，会合并前驱，避免首屏过短。

`config.json` 与 `state.json` 使用临时文件 + rename 原子写入；Dream 的日记 / 记忆 / 历史 / 状态同样整文件替换；`history.jsonl` 与 `chat` 为追加写。

## 展示协议与前端

### 消息标签

- leading tag（`[Reminder id="…"]`、`[Worker …]`）在 user 气泡里换成 badge，正文从 tag 之后开始显示；未登记的类型保持原文。
- block tag（`[META] … [/META]`）是携带 app 元数据、不展示的脚手架文本（例如 worker prompt 末尾的报告契约）：可出现在消息任意位置，可出现多次，user 气泡与时间线预览会把它们整块删除。
- leading tag 与 block tag 都在 `src/shared/message-tag.ts` 里解析（`parseLeadingTag` / `stripHiddenBlockTags`）；复制按钮两种标记都保留原文。

### 事件

轮次流与会话共用同一套协议：助理的 ACP 通知走 `session-update`，轮次信封走 `prompt-start` / `prompt-end`，`sessionId` 即 `assistantId`。助理专属事件只保留实体状态（连接 / 模型 / 流式 / Dream）以及提醒、worker。

| 事件 | 说明 |
| :--- | :--- |
| `assistants-changed` | 助理列表 / 名称 / disabled 变更 |
| `assistant-status-changed` | 连接状态、模型、流式、Dream、usage |
| `assistant-reminders-changed` | 提醒列表变更（附服务端时区） |
| `assistant-reminder-due` | 提醒到点，供系统通知 |
| `assistant-workers-changed` | worker 列表 / 状态变更 |
| `assistant-worker-update` | 某个 worker 的实时 ACP 通知 |
| `open-assistant-requested` | 系统通知点击后打开助理页 |

通知持久化顺序：`backend/assistant/index.ts` 富化 → 写 `chat/messages*.jsonl` → 广播 `session-update`。`tool_call_update` 会先合并进行中的状态，完成时去掉 `rawInput` / `rawOutput` 再落盘。`fs_read` / `fs_write` / `fs_edit` 的 `tool_call` 带 `locations`（绝对路径，读取含起始行），与 ACP 的 `ReadFile` / `WriteFile` / `EditFile` 一致，气泡里显示可点击的文件标记。前端复用 `reduceSessionNotification` / `ChatArea` / 气泡 / 用量条，历史加载与 `isLoading` / `pendingNotifications` 语义也直接复用 `session-lifecycle`。

### 页面

- 路由：`/assistant/:assistantId`；不可用、被停用或全局关闭时回到首页。
- 侧边栏：助理分区固定在项目区上方。行状态显示 Ask User、流式 / Dream、完成 / 失败；hover 显示来源 Agent、workspace、状态；右键支持打开、重命名、启停、设为微信活跃、删除。
- 布局：与 Session 一致的三栏 `ResizablePanelGroup`——聊天列 + 可选详情 + 右侧面板；宽度 < 1000px 进入紧凑模式，打开详情时隐藏聊天列；初始化期间显示遮罩。
- 详情：文件预览、日记、记忆、worker 只读对话与参数 dock。
- 面板：Calendar / Files / Workers 三个标签页。Files 使用虚拟 project 的共享文件面板。
- 聊天列：
  - 消息列表复用 `ChatArea`（伪 `SessionInfo`、`showTimeline={false}`）。
  - 输入区复用 `ChatTextarea`，但 `attachments={null}`（助理不支持附件），草稿复用 `sessionStates.draftInput`。
  - 语音交互与会话一致：提交前先停止语音输入；流式期间语音面板发送会先取消当前生成再发送。
  - 模型 / 思考等级下拉在 `rightSlot`；发送 / 停止按钮在 `primaryAction`；支持语音与 TTS 朗读。
  - `UsageButton` 提供上下文用量、上轮明细、查看记忆和「立即沉淀」。
  - Dream 失败提示浮在 header 下方；关闭会清空后端 `status.dreamError`。
- 设置页 `settings/assistant`：全局开关 + 所有助理共享的 worker 类型（增删改、启停、拖拽排序）。模型字段使用 `ModelCombobox`。

## IPC 协议

请求：

| 方法 | 说明 |
| :--- | :--- |
| `listAssistants` / `createAssistant` / `updateAssistantConfig` / `deleteAssistant` | 助理 CRUD；`updateAssistantConfig` 只接受 `name` / `disabled` |
| `getAssistantStatus` | 运行时状态 |
| `restartAssistant` | 写入来源 Agent / MCP / Dream 并重启 |
| `listAssistantReminders` | 提醒列表 + 时区 |
| `listAssistantDiaries` / `readAssistantDiary` / `readAssistantMemory` | 日记与记忆 |
| `runAssistantDream` / `dismissAssistantDreamError` | 手动 Dream / 关闭失败提示 |
| `listAssistantWorkers` / `getAssistantWorkerHistorySegment` | worker 列表与只读转写 |
| `getAssistantDataSystemPath` | 助理数据目录绝对路径 |

发送 / 取消 / 模型 / 思考等级由助理页直接走会话入口 `sendPrompt` / `cancelPrompt` / `setModel` / `setThoughtLevel`（`sessionId` = `assistantId`）。会话层还按 `assistant.isAssistantSession(sessionId)` 分派 `sendPrompt` / `cancelPrompt` / `getHistorySegment` / `models` / `thoughtLevels` / `isSessionStreaming`；`updateSession` / `deleteSession` 显式拒绝助理 id。

## 已知取舍

- 助理不会升级为真实会话：仍是独立页面 + 伪会话 id，避免 `deleteAgentSessions` / `deleteProject` 连带删除助理数据，也避免在多个侧边栏列表入口做隐藏。
- `session/history.jsonl` 与 `chat/messages*.jsonl` 不合并：一个给模型恢复上下文，一个给界面重放通知，职责不同。
- 不引入向量检索；日记通过 `diary_query` 子代理按关键字检索。
- Worker 只有 ACP 动词与转写，没有任务 / ticket 语义；助理负责所有生命周期决策。
- 助理的权限模型很窄：内置工具直接执行，ACP 权限请求默认拒绝，MCP 由用户显式勾选。真正的硬边界只有运行时目录写入与 workspace 外删除。
- Dream 是唯一会阻塞用户下一轮提问的行为；定时失败不会自动重试，而是排到下一个目标时刻。

# 架构设计

## 整体架构

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Electron Desktop App                             │
│                                                                               │
│  ┌─────────────────────────────┐              ┌─────────────────────────────┐ │
│  │ Renderer (Electron)         │    IPC       │ Main Process (Node.js)      │ │
│  │ - Sidebar / Chat / Panel    │ ◄──────────► │ - IPC handlers              │ │
│  │ - FileTree / TerminalDetail │              │ - ACPBridge                 │ │
│  │ - Skills / Settings UI      │              │ - WebUI Server (ws)         │ │
│  │ - Zustand session store     │              │ - SocketServer (per session)│ │
│  │ - AskUserDialog             │              │ - iLink Bridge              │ │
│  │                             │              │ - Skills Catalog            │ │
│  └─────────────────────────────┘              └──────────┬──────────────────┘ │
│                                                          │                    │
│  ┌────────────────────────────────────────────┐          │                    │
│  │ Shared frontend code (App.tsx / backend.ts)│          │                    │
│  │ Electron: contextBridge → IPC              │          │                    │
│  │ WebUI:    WebSocket    → WebUI Server      │          │                    │
│  └────────────────────────────────────────────┘          │                    │
│                                                          │                    │
│  ┌─────────────────────────────┐                         │                    │
│  │ Remote Browser (WebUI)      │  WebSocket              │                    │
│  │ - Same App.tsx / backend.ts │─────────────────────────┘                    │
│  └─────────────────────────────┘                                              │
│                                                                               │
│                                                    ┌─────────────────────────┘│
│                                                    │  Main Process spawns     │
│                                                    │  Agent                   │
│                                                    ▼                          │
│                              ┌─────────────────────────────────────┐          │
│                              │ Agent Process (2 types)             │          │
│                              │                                     │          │
│                              │ Stdio: subprocess (kiro-cli acp)    │          │
│                              │ API:   in-process (@ai-sdk)         │          │
│                              │                                     │          │
│                              │  ┌─ MCP Client ────────────────┐    │          │
│                              │  │ spawns & manages subprocs   │    │          │
│                              │  │ stdio (MCP protocol)        │    │          │
│                              │  └──────┬──────────┬───────────┘    │          │
│                              └─────────┼──────────┼────────────────┘          │
│                                        │          │                           │
│                              stdio ────┘          │                           │
│                              (MCP)                │                           │
│                                        ┌──────────┘                           │
│                                        ▼                                      │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐    │
│  │ mcp-skills                       │  │ mcp-ask-user                     │    │
│  │ (ELECTRON_RUN_AS_NODE)           │  │ (ELECTRON_RUN_AS_NODE)           │    │
│  │ Skills MCP server                │  │ Ask User MCP server              │    │
│  │ stdio ↔ Agent                    │  │ stdio ↔ Agent                    │    │
│  │ Unix Socket → Main SocketServer  │  │ Unix Socket → Main SocketServer  │    │
│  └──────────────┬───────────────────┘  └──────────────┬───────────────────┘    │
│                 │ HTTP POST                           │ HTTP POST              │
│                 ▼                                     ▼                        │
│            (Main Process SocketServer)                                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 进程与模块职责

### Main Process（`src/electron/` & `src/backend/`）

- **`src/electron/main.ts`**：窗口创建、应用菜单、Electron 原生 IPC 注册、系统对话框、全屏管理
- **`src/scripts/electron-preload/preload.ts`**：通过 `contextBridge` 暴露类型安全的 `window.fello.invoke/on/off`
- **`src/backend/backend.ts`**：IPC 总入口，创建 BackendContext 与事件总线，按层级实例化各工厂模块，组装统一的 `backendHandlers` 对象并返回 `{ backendHandlers, closeBackend }`
- **`src/backend/types.ts`**：共享类型定义（`BackendContext`、`SendEventFn`、`EventListener`）
- **`src/backend/session/index.ts`**：会话生命周期管理（new/load/sendPrompt/cancel/delete）、Socket Server 生命周期
- **`src/backend/session/mcp-config.ts`**：会话 MCP Server 配置构建（按 features 注入内置 MCP）
- **`src/backend/session/notifications.ts`**：通知合并、广播、iLink 转发与 tool_call 状态追踪
- **`src/backend/bridge-connect.ts`**：Agent Bridge 连接管理（`ensureBridge`/`rekeyBridge`/`killBridge`/`killBridgesByAgent`/`clearAll`/`setBroadcast`），会话级 Bridge 生命周期、连接状态广播、权限路由
- **`src/backend/ask-user.ts`**：askUser 通用请求/响应机制、超时管理、Socket 路由注册
- **`src/backend/share-to-user.ts`**：shareToUser 文件分享机制、iLink 媒体队列
- **`src/backend/terminal.ts`**：PTY 终端管理（创建/销毁/resize/输入输出）
- **`src/backend/ilink/index.ts`**：iLink 微信集成（连接管理、状态、命令路由、消息转发），通过 `setHandlers` 延迟绑定解决与 session 的循环依赖
- **`src/backend/project/index.ts`**：项目 CRUD 操作，组合 filesystem 与 git 子模块
- **`src/backend/project/filesystem.ts`**：文件系统操作（搜索/读写/目录遍历/文件信息）
- **`src/backend/project/git.ts`**：Git 状态查询与 HEAD 文件读取
- **`src/backend/inference.ts`**：无头一次性推理原语（spawn 临时 Agent session → prompt → 收集结果 → 销毁），供 automation 使用
- **`src/backend/search/index.ts`**：搜索模块入口（ripgrep + file-outline），Socket 路由注册与 MCP Server 构建
- **`src/backend/search/ripgrep.ts`**：基于 ripgrep worker 子进程的代码搜索
- **`src/backend/search/file-outline.ts`**：基于 tree-sitter WASM 的文件大纲提取
- **`src/backend/serve-file.ts`**：安全文件服务（路径穿越防护、MIME 检测、index.html fallback）
- **`src/backend/agent/agent-bridge.ts`**：Agent 进程生命周期管理，根据 Agent 类型（Stdio/API）路由到对应的 spawner
- **`src/backend/agent/agent-terminal-manager.ts`**：管理 Agent 请求创建的独立终端进程
- **`src/backend/agent/resolve-agent-info.ts`**：Agent 配置解析（Stdio/API 类型校验，被 backend 和 automation 共享）
- **`src/backend/webui.ts`**：WebUI 模式下的 WebSocket 及 HTTP 静态服务
- **`src/backend/skills.ts`**：Skills 目录扫描、解析、skills.sh 市场搜索与安装、Socket 路由注册（`registerSkillsRoute`/`buildSkillsMcpServer`）
- **`src/backend/agent/stdio-agent.ts`**：Stdio Agent 进程 spawn（child_process），进程组管理
- **`src/backend/agent/openai-compatible-api-agent.ts`**：API Agent 进程内启动，通过 ndJsonStream 桥接
- **`src/backend/agent/base-agent.ts`**：AgentProcess 统一接口（input/output streams + close）
- **`src/backend/ilink/ilink-bridge.ts`**：微信 iLink 连接管理、QR 登录、长轮询、消息收发
- **`src/backend/ilink/ilink-client.ts`**：iLink REST API 客户端
- **`src/backend/ilink/ilink-crypto.ts`**：iLink 加密工具
- **`src/backend/storage/index.ts`**：持久化统一入口，组合设置与项目/会话 CRUD，提供消息日志（`appendSessionMessage`/`readSessionMessages`）与终端日志（`appendTerminalOutput`/`readTerminalOutput`）
- **`src/backend/storage/constant.ts`**：共享常量（`FELLO_DIR`、`SOCKETS_DIR`、`PROJECTS_DIR`、`TEMP_DIR`）
- **`src/backend/storage/settings.ts`**：全局设置读写（`getSettings`/`updateSettings`），含 Agent、MCP Server、主题、语言、iLink、snippets 等完整配置管理
- **`src/backend/storage/project-session.ts`**：项目与会话元数据 CRUD（`addProject`/`createSession`/`listProjects`/`listSessions`/`getSession`/`updateSession`/`deleteProject`/`deleteSession`），含内存缓存与磁盘持久化
- **`src/backend/file-routes.ts`**：统一文件 URL 路由解析与执行（`parseFileRoute`/`serveRoute`），支持项目文件、会话共享文件、自动化任务文件三种路由类型，同时服务于 Electron 自定义协议（`fello://web/`）和 WebUI HTTP 请求
- **`src/backend/socket-server.ts`**：Unix Domain Socket HTTP 服务器 + `generateSocketPath()` 路径生成，用于 MCP 子进程与主进程间的 IPC（每个 session 独立实例）。详见 [`docs/socket-server.md`](./socket-server.md)
- **`src/shared/schema.ts`**：主进程与渲染进程请求/事件的统一契约
- **`src/shared/zod/mcp-ask-user-schema.ts`**：Shared Zod schema，用于校验 MCP ask-user 请求与响应的数据结构
- **`src/shared/zod/mcp-skills-schema.ts`**：Shared Zod schema，用于校验 Skills MCP 工具的请求与响应数据结构
- **`src/shared/zod/mcp-search-schema.ts`**：Search MCP 工具请求与响应数据结构
- **`src/shared/zod/mcp-share-to-user-schema.ts`**：Share-to-User MCP 工具请求与响应数据结构
- **`src/shared/zod/worker-ripgrep-schema.ts`**：Ripgrep Worker 子进程 IPC 通信数据结构
- **`src/shared/zod/worker-file-outline-schema.ts`**：File Outline Worker 子进程 IPC 通信数据结构

### Agent Session Logic（`src/agents/`）

此目录是框架无关的 Agent 会话逻辑，同时被 backend（主进程）使用：

- **`openai-compatible-agent.ts`**：实现 ACP Agent 接口，使用 Vercel AI SDK（`streamText`/`generateText`）驱动 LLM。支持流式文本、推理（reasoning）、文件内容、工具调用、会话持久化、自动标题生成。每轮生成结束后通过 `result.usage` / `result.totalUsage` 采集每轮 Token 用量，并通过 ACP `usage_update` 事件发送上下文窗口占用通知
- **`session-state.ts`**：创建会话状态（SessionState），组装 ACP client tools + MCP session tools + 权限记忆。新增 `contextUsedTokens` 字段追踪当前上下文窗口已用 Token 数
- **`storage.ts`**：API Agent 会话持久化（session.json + history.jsonl），存储于 `~/.fello/api-agents/`。session.json 新增 `contextUsedTokens` 字段，支持跨会话持久化上下文用量
- **`acp-client-tools.ts`**：创建 ACP 客户端工具集（文件读写、终端、搜索等）
- **`mcp-tools.ts`**：创建 MCP 会话工具集（动态加载 MCP Server 提供的工具）
- **`permission.ts`**：权限记忆系统，支持"始终允许"（Always Allow），持久化到会话状态
- **`system-prompts.ts`**：基础系统提示词
- **`utils.ts`**：ContentBlock 与 AI SDK Part 之间的转换工具

### Renderer（`src/mainview/`）

- `App.tsx`：全局事件订阅、MessageProvider (全局对话框与 Toast 提示管理)、挂载基于 `react-router-dom` 的应用路由（HashRouter）
- `router.tsx`：使用 `react-router-dom` 定义路由拓扑（`/` 欢迎页、`/session-view/:sessionId` 会话页、`/settings/*` 嵌套设置页、`/skills/*` Skills 管理页）
- `store.ts`：Zustand 全局 store，按 session 维护聊天状态与 UI 状态，包含 askUserRequests 队列、iLink 状态、全屏状态
- `lib/session-state-reducer.ts`：ACP 事件归一处理（消息、tool、usage）+ 流式收尾
- `lib/session-selectors.ts`：Zustand 细粒度选择器 Hooks（`useSessionMessages`/`useSessionActiveToolCalls`/`useSessionIsLoading` 等），使用 `useShallow` 避免不必要的重渲染
- `lib/file-url.ts`：`resolveFileUrl(pathname)` 工具函数，根据 Electron/WebUI 环境将路径名解析为完整文件 URL
- `backend.ts`：IPC 客户端封装，支持在 Electron 环境下使用 `bridge.invoke`，在 WebUI 环境下通过 WebSocket 连接到主进程
- `electron.ts`：纯客户端专属原生系统交互 API 封装（如 `showOpenDialog`、`revealInFinder` 等），在 WebUI 模式下会自动降级或屏蔽
- 组件层：
  - `sidebar.tsx`：项目分组会话列表、会话切换、项目/会话重命名与删除
  - `session/session.tsx`：主工作区布局，使用 `ResizablePanelGroup` 三栏结构（左：Chat + 可选详情，右：标签面板），并自动监听宽度切换紧凑模式
  - `session/chat/chat.tsx`：聊天区容器（含 ChatHeader + AskUserDialog）
  - `session/chat/chat-ask-user-dialog.tsx`：Ask User 对话框，支持选项选择与自定义输入、排队动画
  - `session/chat/chat-header.tsx`：会话头部（Agent Badge、标题、项目路径、时间、MCP 服务器切换菜单、刷新、用量按钮）
  - `session/chat/bubbles/`：各类消息气泡（agent、user、system、tool、thinking、plan）
  - `session/panel/panel.tsx`：带标签的右侧面板（Files / Terminal 两个标签页切换）
  - `session/panel/file-panel/file-panel.tsx`：文件树、重命名、拖拽移动、外部文件夹导入
  - `session/panel/terminal-panel/terminal-panel.tsx`：垂直终端列表、创建/删除/切换终端
  - `session/detail/detail.tsx`：详情视图容器，根据类型渲染文件预览或终端详情
  - `session/detail/file/file-detail.tsx`：文件详情入口，根据文件类型分发到子目录（code-detail/、image-detail/、markdown-detail/、pdf-detail/、docx-detail/、xlsx-detail/、pptx-detail/、fallback-detail/），通过 subscribe 监听 `fs-changed` 事件检测文件外部修改
  - `session/detail/terminal/terminal-detail.tsx`：终端详情展示（xterm.js，含 ResizeObserver 自适应）
  - `settings/`：设置页面（general、agents、MCP、WebUI、iLink、snippets）
  - `skills/`：Skills 管理页面（已安装列表 + skills.sh 市场）

### MCP 子进程

Agent 启动时可以挂载多个 MCP Server，作为独立子进程运行（`ELECTRON_RUN_AS_NODE=1`），通过 stdio 与 Agent 通信：

- **`src/scripts/mcp-skills/server.ts`**：Skills MCP server，提供 `list_skills` 和 `activate_skill` 工具。通过 Unix Domain Socket 回调主进程的 `SocketServer`（路由 `/skills/catalog`、`/skills/detail`）。Skills 本身是会话级 feature flag，可以通过 `features` 参数开关
- **`src/scripts/mcp-ask-user/server.ts`**：Ask User MCP server，提供 `ask_user` 工具。通过 Unix Domain Socket 回调主进程的 `SocketServer`（路由 `/ask-user/ask`），将 Agent 的询问请求转发到 `askUser()` 函数
- **`src/scripts/mcp-search/server.ts`**：Search MCP server，提供 `search`、`rg` 和 `file_outline` 工具。通过 Unix Domain Socket 回调主进程的 `SocketServer`（路由 `/search/search`、`/search/rg`、`/search/file-outline`）
- **`src/scripts/mcp-share-to-user/server.ts`**：Share-to-User MCP server，提供 `share_to_user` 工具。通过 Unix Domain Socket 回调主进程的 `SocketServer`（路由 `/share-to-user/share`），将 Agent 的文件分享请求转发到 `shareToUser()` 函数

Skills、ask-user、search 和 share-to-user 的 MCP Server 是否启动由会话的 `features` 配置控制（`ALL_FEATURES` 默认为 `["skills", "ask_user", "search", "share_to_user"]`），通过 `session/mcp-config.ts` 中的 `buildMcpServersConfig()` 按需注入。

MCP 子进程的构建入口在 `electron.vite.config.ts` 中配置，输出到 `out/scripts/`。

### Worker 子进程（非 MCP）

以下 Worker 子进程不是 MCP Server，它们是普通工作子进程，通过 stdin/stdout JSON 消息与后端搜索模块通信：

- **`src/scripts/worker-ripgrep/worker.ts`**：Ripgrep 搜索 Worker，由 `src/backend/search/ripgrep.ts` 以子进程方式启动，通过 stdin/stdout JSON 通信执行文件内容搜索
- **`src/scripts/worker-file-outline/worker.ts`**：File Outline Worker，由 `src/backend/search/file-outline.ts` 以子进程方式启动，使用 tree-sitter WASM 解析文件结构大纲

### Agent 进程（两种类型）

**Stdio Agent**：通过 `child_process.spawn` 启动，使用 ACP SDK 的 NDJSON stdio 通信

**API Agent**：进程内运行 `OpenaiCompatibleAgent` 实例，通过 ACP SDK 的 `ndJsonStream` 和 `AgentSideConnection` 桥接——对外表现为标准 ACP Agent

## 核心设计决策

### 1) Agent 类型多态

Fello 支持两种 Agent 类型，通过 `src/shared/schema.ts` 中的 `AgentInfo` 判别联合类型区分：

```typescript
type AgentInfo = StdioAgentInfo | ApiAgentInfo
```

- **StdioAgentInfo**：`type: "stdio"`, `command`, `args`, `env`
- **ApiAgentInfo**：`type: "api"`, `provider: "openai-compatible"`, `baseUrl`, `apiKey`, `headers`, `contextWindowTokens`（可选，默认 128000）

`ACPBridge` 根据 `AgentInfo.type` 路由到对应的 spawner（`spawnStdioAgent` 或 `spawnOpenaiCompatibleApiAgent`），两者都实现统一的 `AgentProcess` 接口。

### 2) 单 Bridge、单 Agent 进程复用

应用全局只维护一个 `ACPBridge` 实例。所有会话操作都复用同一连接：

- 新建会话：`newSession`
- 恢复会话：`loadSession`
- 发送消息：`prompt`
- 取消生成：`cancel`

`ACPBridge` 通过 `Map<sessionId, SessionModelState>` 与 `Map<sessionId, SessionModeState>` 维护模型与模式状态缓存，避免会话切换时反复拉取。

### 3) 事件驱动的 UI 渲染

所有 ACP 增量事件统一经过同一链路进入 Zustand，再由 React 渲染：

```
ACP sessionUpdate
  → main.safeSend("session-update")
  → renderer/backend.emit()
  → reduceSessionUpdate(currentState, update)
  → useAppStore(sessionStates)
  → ChatArea / Bubble 组件更新
```

这种设计保证了实时流式更新与历史重放的处理逻辑一致。

### 4) 会话隔离与全局多态状态

`store.ts` 使用 `Map<sessionId, SessionState>` 管理每个会话隔离的：

- messages (`ChatMessage[]` 多态数组)
- `usage`: 上下文窗口用量（ACP `usage_update` 事件更新）
- `lastTurnUsage`: 上轮 Token 明细（input/output/total/thought/cache）
- permission 请求队列
- activeToolCalls

所有的消息通过 `src/mainview/lib/chat-message.ts` 中的 `StreamableMessage` 等接口实现了多态结构（基于 `ContentBlock` 数组），并且依靠 Zustand 的 Immutable 更新保证 React 流式渲染性能。

全局共享状态则直接挂载于 store 根层级：

- `configuredAgents`：用户在设置中自定义的可用 Agent 及启动配置
- `configuredMcpServers`：用户在设置中自定义的可用 MCP 服务器配置
- `theme`：UI 主题配置（深色、浅色、跟随系统）
- `i18n`：应用语言配置（英语、简体中文）
- `snippets`：用户自定义的 Snippets 列表
- `webUIStatus`：WebUI 服务状态
- `ilinkStatus`：微信 iLink 连接状态
- `activeIlinkSessionId`：当前 iLink 活跃会话 ID
- `isMacApp` / `isFullScreen`：平台与窗口状态

此外，模型与模式（`models` / `modes`）以及 Agent 初始化信息（`initializeInfo`）现在作为 `SessionInfo` 的一部分直接与每个独立的会话元数据绑定，前端会根据当前会话的 `SessionInfo` 直接渲染，避免了全局状态同步带来的界面闪烁问题。

### 5) 主进程统一托管系统能力

敏感或系统相关能力全部由主进程执行：

- 文件树读取、创建、删除、重命名、移动
- 系统对话框（选择目录）
- 原生右键菜单
- Finder 定位
- PTY 终端创建/输入/销毁/resize
- iLink 微信连接与消息收发
- Skills 目录扫描与安装

渲染层只发起受限 RPC，不直接接触 Node API。

## 关键数据流

### A. 新建会话

```
Renderer: addProject(pickWorkDir)
  → Main: storage.addProject(project.json)
  → Renderer: 在项目下触发 newSession(projectId, agentId, mcpServers, permissionMode)
  → Main: ensureBridge(agentId) → spawn Agent process (Stdio or API)
  → Agent: newSession
  → Main: storage.createSession(session.json)
  → Renderer: 刷新 sessions + 进入 active session
```

### B. 恢复会话

```
Renderer: resetSessionState(sessionId)
  → Main: loadSession(sessionId)
  → Agent: loadSession/resumeSession (服务端重放历史或从本地 history.jsonl 恢复)
  → session-update 持续推送
  → reduceSessionUpdate 重建消息/工具/usage 状态
```

### C. 发送消息（流式）

```
ChatInput submit
  → 立即写入本地 user message + isStreaming=true
  → Main: sendPrompt
  → Agent: prompt
  → session-update chunk 持续到达（text-delta / reasoning-delta / file / tool-call / tool-result）
  → reduceSessionUpdate / calculateToolCall
  → 生成结束: Agent 通过 result.usage 采集 Token 用量
    → 发送 sessionUpdate("usage_update", { used, size }) 更新上下文窗口进度
    → prompt 返回 { stopReason, usage } 包含本轮 Token 明细
  → ChatInput 收到 usage 后更新 sessionState.lastTurnUsage
  → reduceFlushStreaming 收尾，结束 streaming 状态
```

### D. 权限请求（通过 askUser 通用通道）

```
Agent requestPermission
  → Main: 通过 askUser() 统一通道
  → Renderer: 显示 AskUserDialog（选项含 danger 标记）
  → 用户选择 optionId
  → Main: resolve pending permission
  → Agent 继续执行 tool
  → 若选择"始终允许"，持久化到 session state
```

### E. 终端输出链路

```
Renderer: createTerminal(sessionId, cwd)
  → Main: node-pty spawn shell
  → Main event: terminal-output / terminal-exit (同时持久化到 sessionDir/terminals/ 下)
  → Renderer subscribe 更新 xterm 实例 (或通过 AgentTerminalOutput 渲染)
  → 用户输入 onData → writeTerminal 回传 PTY
```

### F. iLink 微信消息流

```
用户微信 → iLink Server → Main: ILinkBridge.poll() → onMessage callback
  → Main emit "ilink-status-changed" / 转发消息到活跃 session
  → Renderer store 更新 ilinkStatus
  → Agent 处理消息并回复
  → Main: ILinkBridge.sendTextReply() → iLink Server → 用户微信
```

### G. Ask User / Skills（Agent 通过 MCP 与主进程交互）

#### Ask User

```
正向：Agent → 用户
  Agent 调用 ask_user MCP tool
    → MCP ask-user server: HTTP POST /ask-user/ask over Unix Socket
    → Main SocketServer: askUserAskRequestSchema 校验
    → Main askUser(): 生成 askUserId, sendEvent("ask-user-request")
    → Renderer store: 追加到 askUserRequests 队列
    → AskUserDialog: 展示选项或输入框

反向：用户 → Agent
  用户点击选项 / 提交输入
    → Renderer: backend.request.respondAskUser({ sessionId, askUserId, value })
    → Main: resolve pendingAskUserRequests Promise
    → SocketServer: 返回 { value, reason } 给 MCP server
    → MCP server: 格式化为 MCP 文本响应
    → Agent: 收到 tool call 结果
```

#### Skills

```
Agent 调用 list_skills / activate_skill MCP tool
  → MCP skills server: HTTP POST /skills/catalog 或 /skills/detail over Unix Socket
  → Main SocketServer: 查询 Skills 目录或读取指定 Skill 详情
  → 返回结果给 MCP server
  → Agent: 收到 tool call 结果
```

#### Search

```
Agent 调用 search / rg / file_outline MCP tool
  → MCP search server: HTTP POST over Unix Socket（/search/search、/search/rg、/search/file-outline）
  → Main SocketServer: 查询 ripgrep worker 或 file-outline worker
  → 返回结果给 MCP server
  → Agent: 收到 tool call 结果
```

#### Share-to-User

```
Agent 调用 share_to_user MCP tool
  → MCP share-to-user server: HTTP POST /share-to-user/share over Unix Socket
  → Main SocketServer: 执行文件分享逻辑（shareToUser()）
  → 返回确认给 MCP server
  → Agent: 收到 tool call 结果
```

## 生命周期与退出策略

- 启动：`app.whenReady()` 后设置菜单、Dock 图标、创建主窗口，尝试恢复 iLink 会话
- 开发模式：附加 renderer console 与 did-fail-load 诊断日志
- macOS 行为：关闭窗口不退出进程，`activate` 时重建窗口
- 退出：`before-quit` 同步清理 Agent 进程组、iLink 连接与所有 PTY 终端

## 持久化边界

- 客户端本地保存项目元数据、会话元数据（`session.json`）
- Stdio Agent 会话的聊天历史通过主进程进行落盘拦截，每个会话在其独立目录下维护完整的 `messages.jsonl` 事件流文件（NDJSON 格式）
- API Agent 会话的聊天历史在 `OpenaiCompatibleAgent` 内部直接写入 `history.jsonl`
- API Agent 会话状态（modelId、allowedToolKinds、contextUsedTokens）持久化到 `session.json`
- 删除项目时删除对应 `~/.fello/projects/<project-id>/` 目录（包含其所有会话和日志）
- iLink 凭证和游标持久化到 `~/.fello/ilink/`

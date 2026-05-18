# 项目结构

## 源码目录总览

```
fello/
├── src/
│   ├── agents/                       # Agent 会话逻辑（框架无关，主进程使用）
│   │   ├── openai-compatible-agent.ts    # OpenAI 兼容 API Agent 实现（ACP Agent 接口）
│   │   ├── session-state.ts              # 会话状态创建（ACP tools + MCP tools + 权限记忆）
│   │   ├── storage.ts                    # API Agent 会话持久化（session.json + history.jsonl）
│   │   ├── acp-client-tools.ts           # ACP 客户端工具集工厂
│   │   ├── mcp-tools.ts                  # MCP 会话工具集工厂
│   │   ├── permission.ts                 # 权限记忆系统（"始终允许"）
│   │   ├── system-prompts.ts            # 基础系统提示词
│   │   └── utils.ts                     # ContentBlock 转换工具
│   │
│   ├── backend/                      # Node.js 后端逻辑与系统能力
│   │   ├── backend.ts                # IPC handlers 注册、文件/终端/Skills/iLink API 实现
│   │   ├── agent/                    # Agent 连接与进程管理
│   │   ├── agent-terminal-manager.ts # Agent 专属终端进程管理
│   │   ├── storage.ts                # 项目/会话元数据持久化（project.json / session.json）
│   │   ├── utils.ts                  # 后端工具函数（如 toPosixPath、resolveSafePath）
│   │   ├── watcher.ts                # 文件系统监控（chokidar 封装）
│   │   ├── webui.ts                  # WebUI WebSocket 与 HTTP 服务端实现
│   │   ├── skills.ts                 # Skills 目录扫描、skills.sh 市场集成
│   │   │   ├── agent-bridge.ts           # Agent 连接封装（类型路由、生命周期管理）
│   │   │   ├── base-agent.ts            # AgentProcess 统一接口
│   │   │   ├── stdio-agent.ts           # Stdio Agent 进程 spawn（child_process）
│   │   │   └── openai-compatible-api-agent.ts # API Agent 进程内启动
│   │   └── ilink/                    # 微信 iLink 集成
│   │       ├── ilink-bridge.ts       # iLink 连接管理、QR 登录、消息收发
│   │       ├── ilink-client.ts       # iLink REST API 客户端
│   │       └── ilink-crypto.ts       # iLink 加密工具
│   │
│   ├── electron/                     # Electron 主进程 + preload
│   │   ├── main.ts                   # 应用入口、窗口生命周期、系统菜单、全屏管理
│   │   └── preload.ts                # contextBridge 暴露 window.fello.invoke/on/off
│   │
│   ├── shared/                       # 前后端共享类型与常量
│   │   └── schema.ts                 # 主渲染通信协议（请求/事件类型）与持久化接口定义
│   │
│   └── mainview/                     # Renderer（React SPA）
│       ├── App.tsx                   # 根组件，订阅全局事件，挂载路由与全局上下文
│       ├── router.tsx                # 路由配置 (基于 react-router-dom HashRouter)
│       ├── main.tsx                  # React 挂载入口
│       ├── index.css                 # 全局样式与主题变量
│       ├── index.html                # renderer HTML 模板
│       ├── backend.ts                # request + subscribe 封装，并处理 WebUI 的 WebSocket 降级
│       ├── electron.ts               # 纯客户端专属原生系统交互 API 封装，屏蔽 WebUI 的调用
│       ├── global.d.ts               # window.fello 类型声明
│       ├── store.ts                  # Zustand store（按 session 分桶，含 iLink 状态）
│       ├── i18n.ts                   # i18next 多语言配置初始化
│       │
│       ├── locales/                  # 多语言 JSON 字典文件
│       │   ├── en.json
│       │   └── zh-CN.json
│       │
│       ├── lib/
│       │   ├── session-state-reducer.ts  # ACP 事件解析器，将 SessionUpdate 转换为 ChatMessage 并推入 store
│       │   ├── chat-message.ts       # 多态消息类型定义与 ContentBlock 鉴别器
│       │   ├── regexp.ts             # 正则表达式工具
│       │   ├── terminal-manager.ts   # 终端输出管理器
│       │   └── utils.ts             # cn()、formatSessionTime 等工具函数
│       │
│       ├── components/
│       │   ├── session/              # 会话主工作区相关组件
│       │   │   ├── chat/             # 聊天核心区域与气泡组件
│       │   │   │   ├── bubbles/      # 各类角色消息气泡 (agent/user/system/tool/thinking/plan)
│       │   │   │   ├── chat.tsx      # 聊天主容器（含 ChatHeader）
│       │   │   │   ├── chat-header.tsx # 会话头部 (Agent Badge, 标题, MCP菜单, 刷新)
│       │   │   │   ├── chat-area.tsx # 消息流渲染与滚动控制
│       │   │   │   ├── chat-input.tsx# 底部输入框 (文件拖拽、提及、发送)
│       │   │   │   └── chat-timeline.tsx # 聊天时间线导航
│       │   │   ├── session.tsx       # 主工作区布局 (ResizablePanelGroup 三栏: Chat + Detail + Panel)
│       │   │   ├── panel/            # 右侧标签面板
│       │   │   │   ├── panel.tsx         # 带标签的面板容器 (Files / Terminal 切换)
│       │   │   │   ├── file-panel/
│       │   │   │   │   └── file-panel.tsx   # 文件树、重命名、拖拽移动等
│       │   │   │   └── terminal-panel/
│       │   │   │       └── terminal-panel.tsx # 垂直终端列表 (创建/删除/切换)
│       │   │   └── detail/           # 详情视图 (嵌入左侧聊天区域)
│       │   │       ├── detail.tsx         # 详情视图容器 (根据类型分发)
│       │   │       ├── file/
│       │   │       │   ├── file-detail.tsx    # 文件内容与图片预览 (带关闭按钮)
│       │   │       │   └── search-bar.tsx     # 文件搜索条
│       │   │       └── terminal/
│       │   │           └── terminal-detail.tsx # 终端详情展示 (xterm.js 全尺寸)
│       │   ├── layout/               # 整体布局组件
│       │   │   └── sidebar.tsx       # 左侧边栏 (项目与会话列表管理)
│       │   ├── settings/             # 设置相关页面组件
│       │   │   ├── settings-layout.tsx          # 设置页侧边导航布局
│       │   │   ├── general/
│       │   │   │   └── settings-general.tsx         # 通用设置
│       │   │   ├── agents/
│       │   │   │   ├── settings-agents.tsx          # Agents 配置页面
│       │   │   │   ├── settings-agent-stdio-dialog.tsx # Stdio Agent 配置弹窗
│       │   │   │   └── settings-agent-api-dialog.tsx    # API Agent 配置弹窗
│       │   │   ├── mcp/
│       │   │   │   ├── settings-mcp.tsx             # MCP Servers 配置页面
│       │   │   │   ├── settings-mcp-stdio-dialog.tsx    # Stdio MCP 配置弹窗
│       │   │   │   └── settings-mcp-http-dialog.tsx     # HTTP MCP 配置弹窗
│       │   │   ├── webui/
│       │   │   │   └── settings-webui.tsx           # WebUI 配置页面
│       │   │   └── ilink/
│       │   │       └── settings-ilink.tsx           # 微信 iLink 配置页面
│       │   ├── skills/               # Skills 管理页面
│       │   │   ├── skills-layout.tsx     # Skills 页侧边导航布局
│       │   │   ├── installed/
│       │   │   │   └── skills-installed.tsx  # 已安装 Skills 列表
│       │   │   └── skills-sh/
│       │   │       └── skills-skills-sh.tsx   # skills.sh 市场浏览与安装
│       │   ├── global/               # 全局浮层与菜单
│       │   │   ├── error-boundary.tsx           # 全局错误边界与异常提示
│       │   │   ├── global-text-context-menu.tsx # 文本选中全局右键菜单
│       │   │   └── permission-dialog.tsx        # 权限确认弹层（含"始终允许"）
│       │   ├── providers/            # 全局上下文 Provider
│       │   │   ├── message.tsx       # 全局消息/Toast 提示管理
│       │   │   └── theme.tsx         # 基于 next-themes 的主题控制
│       │   ├── welcome/              # 欢迎页面
│       │   │   └── welcome.tsx
│       │   ├── common/               # 通用业务组件
│       │   │   ├── agent-terminal-output.tsx    # Agent 终端输出渲染
│       │   │   ├── code-view.tsx               # 代码高亮展示
│       │   │   ├── code-compare-view.tsx        # 代码 Diff 对比视图
│       │   │   ├── image-view.tsx              # 图片预览
│       │   │   ├── stream-markdown.tsx         # 流式 Markdown 渲染
│       │   │   └── shiki-highlighter.ts        # Shiki 代码高亮引擎
│       │   ├── content-blocks/       # 多模态消息内容渲染组件
│       │   │   ├── content-blocks.tsx    # ContentBlock 路由器
│       │   │   ├── text-block.tsx        # 文本块
│       │   │   ├── image-block.tsx       # 图片块
│       │   │   ├── audio-block.tsx       # 音频块
│       │   │   ├── resource-block.tsx    # 资源块
│       │   │   ├── resource-link-block.tsx # 资源链接块
│       │   │   └── unsupported-block.tsx # 不支持类型降级
│       │   └── ui/                   # shadcn/base-ui 基础组件
│       │       ├── badge.tsx
│       │       ├── button.tsx
│       │       ├── card.tsx
│       │       ├── collapsible.tsx
│       │       ├── context-menu.tsx
│       │       ├── dialog.tsx
│       │       ├── dropdown-menu.tsx
│       │       ├── hover-card.tsx
│       │       ├── input.tsx
│       │       ├── resizable.tsx
│       │       ├── scroll-area.tsx
│       │       ├── select.tsx
│       │       ├── separator.tsx
│       │       ├── sheet.tsx
│       │       ├── sonner.tsx
│       │       ├── switch.tsx
│       │       ├── tabs.tsx
│       │       ├── textarea.tsx
│       │       └── tooltip.tsx
│
├── icons/                            # 应用图标资源
│   ├── icon.iconset/                 # macOS 多分辨率 iconset
│   └── fello_icon.png
├── tools/                            # 构建辅助脚本
│   └── prepare-mac-icon.sh           # macOS 图标生成脚本
├── docs/                             # 项目文档
├── .github/                          # GitHub CI/CD 配置
├── components.json                   # shadcn 生成配置
├── electron.vite.config.ts           # electron-vite 主配置
├── tsconfig.json                     # renderer TS 配置
├── tsconfig.node.json                # main/preload TS 配置
├── .oxfmtrc.json                     # 格式化配置
├── .oxlintrc.json                    # 静态检查配置
└── package.json
```

## 目录职责细化

### `src/agents`

- 框架无关的 Agent 会话逻辑，被主进程（backend）直接引用
- 实现 ACP Agent 接口（`OpenaiCompatibleAgent`）
- 管理会话状态（ModelMessage 历史、工具集、权限记忆）
- 提供 API Agent 的持久化层（session.json + history.jsonl）

### `src/backend`

- 面向系统能力的底层实现：文件系统、终端 PTY
- 负责 Agent 进程与会话生命周期管理（`acp-bridge.ts`）
- Agent 进程 spawner：Stdio（child_process）和 API（in-process）
- iLink 微信集成：连接管理、消息收发
- Skills 系统：目录扫描、skills.sh 市场集成
- 通过 `src/shared/schema.ts` 保持主渲染层 API 契约稳定

### `src/electron`

- Electron 应用生命周期与窗口管理
- 系统菜单、Dock 集成、系统对话框、Finder 定位等原生能力
- 注册由 `src/backend` 提供的 IPC 处理器
- `preload.ts` 负责安全地将 IPC 能力暴露给渲染进程

### `src/mainview`

- 纯前端视图与状态管理，依赖 `window.fello` 调用主进程能力
- 事件订阅统一在 `backend.ts`，避免组件直接绑定 Electron API
- 对于只存在于 Electron 桌面端的原生交互功能，需要封装在 `electron.ts` 中，并且组件中需要通过 `isWebUI` 变量对对应的触发 UI 元素进行隐藏，以兼容 WebUI 远端协作模式
- 页面逻辑围绕"项目 + 会话"展开，使用 `react-router-dom` 统一管理页面路由
- 聊天状态仍以 sessionId 隔离
- 会话界面采用三栏 `ResizablePanelGroup` 布局：左侧为聊天区域（可内嵌文件/终端详情视图），右侧为带标签的固定面板（Files / Terminal 标签页切换）。宽度 < 1000px 时自动进入紧凑模式，详情打开时隐藏聊天区域

## 数据目录（运行时）

```
~/.fello/
├── settings.json                    # 全局设置
├── projects/                        # 项目数据（Stdio Agent 会话）
│   └── <project-id>/
│       ├── project.json
│       └── sessions/
│           └── <session-id>/
│               ├── session.json
│               ├── messages.jsonl   # 历史会话流事件日志 (NDJSON)
│               └── terminals/       # 终端日志
│                   └── <terminal-id>.log
├── api-agents/                      # API Agent 会话数据
│   └── <agent-id>/
│       └── sessions/
│           └── <session-id>/
│               ├── session.json     # 会话状态（modelId, allowedToolKinds）
│               └── history.jsonl    # 对话历史 (NDJSON ModelMessage)
└── ilink/                           # 微信 iLink 数据
    ├── credentials.json             # 登录凭证（加密存储）
    ├── cursor.json                  # 消息游标
    └── active-session.json          # 当前活跃会话 ID
```

`settings.json` 字段：

- `agents`: 自定义的 Agent 列表，支持 `StdioAgentInfo` 和 `ApiAgentInfo` 两种类型
- `mcpServers`: MCP Server 列表，支持 `StdioMcpServerInfo` 和 `HttpMcpServerInfo` 两种类型
- `theme`: UI 主题配置（`themeMode`: `"light" | "dark" | "system"`）
- `i18n`: 应用语言配置（`language`: `"en"` | `"zh-CN"`）

`project.json` 字段：

- `id`: 项目 ID（cwd 的 SHA1 哈希）
- `title`: 项目名称
- `cwd`: 项目工作目录
- `createdAt` / `updatedAt`: 毫秒级时间戳

`session.json` 字段（Stdio Agent 会话）：

- `id`: 会话 ID（格式：`<agent_id>:<resume_id>`）
- `title`: 会话标题
- `agent_id`: 会话使用的 Agent ID
- `resume_id`: 底层 ACP 服务的真实会话 ID
- `project_id`: 所属项目 ID
- `cwd`: 会话工作目录
- `mcp_servers`: 启用的 MCP Server ID 列表
- `permission_mode`: 权限模式（`"ask"` 或 `"allow-all"`）
- `models`: 模型配置缓存
- `modes`: 模式配置缓存
- `initialize_info`: Agent 初始化信息缓存
- `created_at` / `updated_at`: 毫秒级时间戳

# 项目结构

## 源码目录总览

```
fello/
├── src/
│   ├── server/                       # 独立 Node.js 服务器入口
│   │   └── main.ts                   # 无 Electron 版本，纯 Node 启动 backend + WEBUI
│   ├── agents/                       # Agent 会话逻辑（框架无关，主进程使用）
│   │   ├── openai-compatible-agent.ts    # OpenAI 兼容 API Agent 实现（ACP Agent 接口）
│   │   ├── session-state.ts              # 会话状态创建（ACP tools + MCP tools + 权限记忆）
│   │   ├── storage.ts                    # API Agent 会话持久化（session.json + history.jsonl）
│   │   ├── acp-client-tools.ts           # ACP 客户端工具集工厂
│   │   ├── mcp-tools.ts                  # MCP 会话工具集工厂
│   │   ├── agent-client-proxy.ts         # ACP Client 能力代理
│   │   ├── subagent-tool.ts              # 子代理工具与执行协调
│   │   ├── image-tools.ts                # 图片输入与相关工具处理
│   │   ├── permission.ts                 # 权限记忆系统（"始终允许"）
│   │   ├── system-prompts.ts            # 基础系统提示词
│   │   └── utils.ts                     # ContentBlock 转换工具
│   │
│   ├── backend/                      # Node.js 后端逻辑与系统能力
│   │   ├── backend.ts                # IPC 总入口：工厂模块实例化、组装 backendHandlers
│   │   ├── types.ts                  # 共享类型（BackendContext, SendEventFn, EventListener）
│   │   ├── bridge-connect.ts          # Agent Bridge 连接管理（ensureBridge/rekeyBridge/killBridge/killBridgesByAgent/clearAll/setBroadcast）
│   │   ├── ask-user.ts               # askUser 通用机制（请求/响应/超时/路由注册）
│   │   ├── share-to-user.ts          # shareToUser 文件分享（iLink 媒体队列）
│   │   ├── terminal.ts               # PTY 终端管理（创建/销毁/resize/输出）
│   │   ├── inference.ts              # 无头一次性推理原语（供 automation 使用）
│   │   ├── serve-file.ts             # 安全文件服务（路径穿越防护、MIME 检测）
│   │   ├── session/                  # 会话生命周期模块
│   │   │   ├── index.ts              # 会话管理（new/load/sendPrompt/cancel/delete）
│   │   │   ├── mcp-config.ts         # MCP Server 配置构建（按 features 注入内置 MCP）
│   │   │   └── notifications.ts      # 通知合并、广播、iLink 转发、tool_call 状态追踪
│   │   ├── project/                  # 项目管理模块
│   │   │   ├── index.ts              # 项目 CRUD + 组合 filesystem/git
│   │   │   ├── filesystem.ts         # 文件系统操作（搜索/读写/目录遍历）
│   │   │   └── git.ts                # Git 状态查询与 HEAD 文件读取
│   │   ├── search/                   # 搜索模块
│   │   │   ├── index.ts              # 搜索入口 + Socket 路由注册
│   │   │   ├── ripgrep.ts            # 基于 ripgrep worker 的代码搜索
│   │   │   └── file-outline.ts       # 基于 tree-sitter WASM 的文件大纲
│   │   ├── automation/               # 自动化任务计划模块
│   │   │   ├── index.ts              # 调度器 + 执行器 + Schedule/Task CRUD（工厂函数）
│   │   │   └── store.ts              # 文件持久化层（Schedule/Task CRUD，基于 ~/.fello/automations/）
│   │   ├── agent/                    # Agent 连接与进程管理
│   │   │   ├── agent-bridge.ts           # Agent 连接封装（类型路由、生命周期管理）
│   │   │   ├── agent-terminal-manager.ts # Agent 专属终端进程管理
│   │   │   ├── base-agent.ts             # AgentProcess 统一接口
│   │   │   ├── stdio-agent.ts            # Stdio Agent 进程 spawn（child_process）
│   │   │   ├── openai-compatible-api-agent.ts # API Agent 进程内启动
│   │   │   └── resolve-agent-info.ts     # Agent 配置解析（Stdio/API 类型校验）
│   │   ├── storage/                  # 持久化管理模块
│   │   │   ├── index.ts              # 统一入口：组合设置与项目/会话 CRUD + 消息/终端日志
│   │   │   ├── constant.ts           # 共享路径常量（FELLO_DIR, SOCKETS_DIR, PROJECTS_DIR, TEMP_DIR）
│   │   │   ├── settings.ts           # 全局设置读写（agents/mcpServers/theme/i18n/ilink/snippets）
│   │   │   └── project-session.ts    # 项目与会话元数据 CRUD + 内存缓存
│   │   ├── file-routes.ts            # 统一文件 URL 路由（project/share/automation 三种类型）
│   │   ├── utils.ts                  # 后端工具函数（如 toPosixPath、resolveSafePath）
│   │   ├── watcher.ts                # 文件系统监控（@parcel/watcher 封装）
│   │   ├── webui.ts                  # WebUI WebSocket 与 HTTP 服务端实现
│   │   ├── skills.ts                 # Skills 目录扫描、skills.sh 市场集成、路由注册
│   │   ├── memory.ts                 # 项目级持久记忆（语义查询/存储 + memo 事务管理）
│   │   ├── image-generation.ts       # 图片生成模块（OpenAI 兼容 API）
│   │   ├── toolbox.ts                # 通用工具箱（编码/哈希/时间/UUID/随机数/图片处理/截图）
│   │   ├── socket-server.ts          # 本地 Socket HTTP 服务器 + 跨平台路径生成
│   │   ├── i18n.ts                   # 后端多语言初始化
│   │   ├── locales/                  # 后端多语言 JSON 字典
│   │   │   ├── en.json
│   │   │   └── zh-CN.json
│   │   └── ilink/                    # 微信 iLink 集成
│   │       ├── index.ts              # iLink 模块工厂（状态管理、命令路由、消息转发）
│   │       ├── ilink-bridge.ts       # iLink 连接管理、QR 登录、消息收发
│   │       ├── ilink-client.ts       # iLink REST API 客户端
│   │       └── ilink-crypto.ts       # iLink 加密工具
│   │
│   ├── electron/                     # Electron 主进程
│   │   ├── main.ts                   # 应用入口、窗口生命周期、系统菜单、全屏管理
│   │   ├── updater.ts                # 自动更新逻辑
│   │   └── env.ts                    # 环境变量配置
│   │
│   ├── scripts/                      # 构建脚本入口（preload + MCP 子进程 + Worker 子进程）
│   │   ├── electron-preload/
│   │   │   └── preload.ts            # contextBridge 暴露 window.fello.invoke/on/off
│   │   ├── mcp-skills/
│   │   │   └── server.ts             # Skills MCP server
│   │   ├── mcp-ask-user/
│   │   │   └── server.ts             # Ask User MCP server
│   │   ├── mcp-search/
│   │   │   └── server.ts             # Search MCP server（search/rg/file_outline）
│   │   ├── mcp-share-to-user/
│   │   │   └── server.ts             # Share-to-User MCP server
│   │   ├── mcp-memory/
│   │   │   └── server.ts             # Memory MCP server（memory_query/memory_store）
│   │   ├── mcp-memo/
│   │   │   └── server.ts             # Memo MCP server（事务性记忆条目管理）
│   │   ├── mcp-image-generation/
│   │   │   └── server.ts             # Image Generation MCP server
│   │   ├── mcp-toolbox/
│   │   │   └── server.ts             # Toolbox MCP server（编码/哈希/时间/UUID/图片处理/截图）
│   │   ├── worker-ripgrep/
│   │   │   └── worker.ts             # Ripgrep Worker 子进程
│   │   └── worker-file-outline/
│   │       └── worker.ts             # File Outline Worker 子进程（tree-sitter WASM）
│   │
│   ├── shared/                       # 前后端共享类型与常量
│   │   ├── schema.ts                 # 主渲染通信协议（请求/事件类型）与持久化接口定义
│   │   ├── constants.ts              # 共享常量（Feature 列表、i18n key 映射等）
│   │   └── zod/                      # 共享 Zod schema
│   │       ├── mcp-ask-user-schema.ts
│   │       ├── mcp-skills-schema.ts
│   │       ├── mcp-search-schema.ts       # Search MCP 工具请求与响应
│   │       ├── mcp-share-to-user-schema.ts # Share-to-User MCP 请求与响应
│   │       ├── mcp-memory-schema.ts       # Memory MCP 工具请求与响应
│   │       ├── mcp-memo-schema.ts         # Memo MCP 工具请求与响应
│   │       ├── mcp-image-generation-schema.ts # Image Generation MCP 请求与响应
│   │       ├── mcp-toolbox-schema.ts      # Toolbox MCP 工具请求与响应
│   │       ├── worker-ripgrep-schema.ts    # Ripgrep Worker IPC 数据结构
│   │       └── worker-file-outline-schema.ts # File Outline Worker IPC 数据结构
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
│       │   ├── clipboard.ts              # 剪贴板工具（HTTP fallback + 粘贴检测）
│       │   ├── session-state-reducer.ts  # ACP 事件解析器，将 SessionUpdate 转换为 ChatMessage
│       │   ├── session-selectors.ts      # Zustand 细粒度选择器 Hooks（避免不必要的重渲染）
│       │   ├── shiki-preload.ts          # Shiki 代码高亮预加载（@pierre/diffs 内置）
│       │   ├── chat-message.ts           # 多态消息类型定义与 ContentBlock 鉴别器
│       │   ├── file-url.ts              # 文件 URL 解析（Electron/WebUI 环境适配）
│       │   ├── regexp.ts                 # 正则表达式工具
│       │   ├── terminal-manager.ts       # 终端输出管理器
│       │   └── utils.ts                  # cn()、formatSessionTime 等工具函数
│       │
│       ├── components/
│       │   ├── automation/           # 自动化任务管理页面
│       │   │   ├── automation.tsx        # 计划列表页（创建/编辑/删除/触发）
│       │   │   ├── common/
│       │   │   │   ├── cron-editor.tsx       # Cron 表达式编辑器（含预设）
│       │   │   │   └── setting-dialog.tsx    # 计划配置弹窗（Agent/Prompt/Features/MCP）
│       │   │   ├── schedule/
│       │   │   │   └── schedule.tsx          # 计划详情页（含可调整大小的任务历史面板）
│       │   │   └── task/
│       │   │       ├── task.tsx              # 任务详情视图
│       │   │       ├── file-panel/
│       │   │       │   └── file-panel.tsx    # 任务文件列表面板
│       │   │       └── file-detail/
│       │   │           ├── file-detail.tsx       # 任务文件详情入口（按类型分发）
│       │   │           ├── file-types.ts         # 文件类型判断
│       │   │           ├── code-detail/          # 代码文件预览
│       │   │           ├── markdown-detail/      # Markdown 预览
│       │   │           ├── html-detail/          # HTML 预览
│       │   │           ├── image-detail/         # 图片预览
│       │   │           ├── pdf-detail/           # PDF 预览
│       │   │           ├── docx-detail/          # DOCX 预览
│       │   │           ├── xlsx-detail/          # Excel 预览
│       │   │           └── pptx-detail/          # PPTX 预览
│       │   ├── chat-bubbles/          # 各类消息气泡（独立顶级目录）
│       │   │   ├── agent-bubble.tsx
│       │   │   ├── subagent-bubble.tsx
│       │   │   ├── user-bubble.tsx
│       │   │   ├── system-bubble.tsx
│       │   │   ├── tool-bubble.tsx
│       │   │   ├── thinking-bubble.tsx
│       │   │   ├── plan-bubble.tsx
│       │   │   ├── message-bubble.tsx
│       │   │   └── base-bubble.tsx
│       │   ├── session/              # 会话主工作区相关组件
│       │   │   ├── chat/             # 聊天核心区域
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
│       │   │       │   ├── file-detail.tsx    # 文件详情入口 (根据文件类型分发到子目录)
│       │   │       │   ├── file-types.ts      # 文件类型判断工具
│       │   │       │   ├── common/            # 共享组件与 Hook
│       │   │       │   │   ├── use-file.ts        # 文件加载 Hook
│       │   │       │   │   ├── loading-state.tsx  # 加载状态组件
│       │   │       │   │   └── file-view-tabs.tsx # 文件视图标签切换
│       │   │       │   ├── code-detail/       # 代码文件预览
│       │   │       │   │   ├── code-detail.tsx    # 代码高亮展示
│       │   │       │   │   ├── search-bar.tsx     # 文件搜索条
│       │   │       │   │   └── use-file-search.ts # 文件搜索 Hook
│       │   │       │   ├── image-detail/      # 图片预览
│       │   │       │   │   └── image-detail.tsx
│       │   │       │   ├── markdown-detail/   # Markdown 富文本预览
│       │   │       │   │   └── markdown-detail.tsx
│       │   │       │   ├── pdf-detail/        # PDF 文档预览
│       │   │       │   │   └── pdf-detail.tsx
│       │   │       │   ├── docx-detail/       # DOCX 文档预览
│       │   │       │   │   └── docx-detail.tsx
│       │   │       │   ├── xlsx-detail/       # Excel 文档预览
│       │   │       │   │   └── xlsx-detail.tsx
│       │   │       │   ├── pptx-detail/       # PPTX 演示文稿预览
│       │   │       │   │   └── pptx-detail.tsx
│       │   │       │   ├── html-detail/       # HTML 预览（含沙盒 iframe）
│       │   │       │   │   └── html-detail.tsx
│       │   │       │   └── fallback-detail/   # 不支持类型的降级展示
│       │   │       │       └── fallback-detail.tsx
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
│       │   │   │   ├── settings-mcp-http-dialog.tsx     # HTTP MCP 配置弹窗
│       │   │   │   └── settings-mcp-sse-dialog.tsx      # SSE MCP 配置弹窗
│       │   │   ├── webui/
│       │   │   │   └── settings-webui.tsx           # WebUI 配置页面
│       │   │   ├── ilink/
│       │   │   │   └── settings-ilink.tsx           # 微信 iLink 配置页面
│       │   │   └── snippets/
│       │   │       ├── settings-snippets.tsx        # Snippets 管理页面
│       │   │       └── settings-snippet-dialog.tsx  # Snippet 编辑弹窗
│       │   │   ├── memory/
│       │   │   │   └── settings-memory.tsx          # 项目记忆管理页面
│       │   │   └── image-generation/
│       │   │       └── settings-image-generation.tsx # 图片生成 Provider 配置页面
│       │   ├── skills/               # Skills 管理页面
│       │   │   ├── skills-layout.tsx     # Skills 页侧边导航布局
│       │   │   ├── installed/
│       │   │   │   └── skills-installed.tsx  # 已安装 Skills 列表
│       │   │   └── skills-sh/
│       │   │       └── skills-skills-sh.tsx   # skills.sh 市场浏览与安装
│       │   ├── global/               # 全局浮层与菜单
│       │   │   ├── error-boundary.tsx           # 全局错误边界与异常提示
│       │   │   └── global-text-context-menu.tsx # 文本选中全局右键菜单
│       │   ├── providers/            # 全局上下文 Provider
│       │   │   ├── message.tsx       # 全局消息/Toast 提示管理
│       │   │   └── theme.tsx         # 基于 next-themes 的主题控制
│       │   ├── welcome/              # 欢迎页面
│       │   │   ├── welcome.tsx
│       │   │   ├── welcome.css
│       │   │   └── particle-background.tsx  # 粒子动画背景
│       │   ├── common/               # 通用业务组件
│       │   │   ├── agent-terminal-output.tsx    # Agent 终端输出渲染
│       │   │   ├── code-view.tsx               # 代码高亮展示（@pierre/diffs）
│       │   │   ├── code-compare-view.tsx        # 代码 Diff 对比视图（@pierre/diffs）
│       │   │   ├── file-icon.tsx               # 文件图标组件（按扩展名匹配图标）
│       │   │   ├── image-view.tsx              # 图片预览
│       │   │   ├── stream-markdown.tsx         # 流式 Markdown 渲染
│       │   │   ├── pdf-view.tsx                # PDF 文档预览
│       │   │   ├── docx-view.tsx               # DOCX 文档预览
│       │   │   ├── xlsx-view.tsx               # Excel 文档预览
│       │   │   ├── pptx-view.tsx               # PPTX 演示文稿预览
│       │   │   ├── use-search-highlight.ts     # 搜索高亮 Hook
│       │   │   └── pdf-worker-wrapper.ts       # PDF Worker 封装
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
│   ├── prepare-mac-icon.sh           # macOS 图标生成脚本
│   ├── prepare-npm-package.mjs       # npm 包打包脚本（生成 npm-package/ 目录）
│   └── download-tree-sitter-wasm.mjs # 下载 Search MCP 使用的 grammar WASM
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
- 工厂模式设计：`backend.ts` 创建 `BackendContext`（sendEvent + onEvent + storage），按层级实例化各 `createXxxModule()` 工厂：
  - `session/` — 会话生命周期（new/load/sendPrompt/cancel/delete）、通知广播、MCP 配置
  - `bridge-connect.ts` — Agent Bridge 连接管理（生命周期、状态广播、权限路由）
  - `ask-user.ts` — askUser 通用请求/响应/超时机制
  - `share-to-user.ts` — shareToUser 文件分享
  - `terminal.ts` — PTY 终端创建/销毁/resize
  - `ilink/index.ts` — iLink 微信连接、状态、命令路由与消息转发
  - `project/` — 项目 CRUD + 文件搜索/读写 + Git 状态
  - `search/` — ripgrep 搜索 + file-outline
  - `inference.ts` — 无头推理原语（供 automation 使用）
  - `automation/` — 定时任务调度与执行
  - `serve-file.ts` — 安全文件服务（路径穿越防护）
- 负责 Agent 进程与会话生命周期管理（`agent/agent-bridge.ts`）
- Agent 进程 spawner：Stdio（child_process）和 API（in-process）
- Agent 配置解析：`agent/resolve-agent-info.ts`
- Agent 终端管理：`agent/agent-terminal-manager.ts`
- iLink 微信集成：连接管理、消息收发
- Skills 系统：目录扫描、skills.sh 市场集成、路由注册（`registerSkillsRoute`、`buildSkillsMcpServer`）
- 本地 Socket Server：`socket-server.ts`（`generateSocketPath()` 在 Unix-like 系统生成 socket 文件，在 Windows 生成命名管道）
- 通过 `src/shared/schema.ts` 保持主渲染层 API 契约稳定

### `src/electron`

- Electron 应用生命周期与窗口管理
- 系统菜单、Dock 集成、系统对话框、Finder 定位等原生能力
- 注册由 `src/backend` 提供的 IPC 处理器
- `src/scripts/electron-preload/preload.ts` 负责安全地将 IPC 能力暴露给渲染进程

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
├── sockets/                         # Unix-like 系统的 MCP IPC socket 文件
├── temp/                            # 临时文件目录
├── automations/                     # 自动化任务数据
│   └── <schedule-id>/
│       ├── schedule.json            # 计划配置
│       └── tasks/
│           └── <task-id>/
│               ├── task.json        # 任务元数据（状态、时间、错误信息）
│               └── ...              # 任务产出文件（Agent 执行生成）
├── projects/                        # 项目数据（Stdio Agent 会话）
│   └── <project-id>/
│       ├── project.json
│       ├── memory.json               # 项目级跨会话持久记忆
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
│               ├── session.json     # 会话状态（modelId, allowedToolKinds, contextUsedTokens）
│               └── history.jsonl    # 对话历史 (NDJSON ModelMessage)
└── ilink/                           # 微信 iLink 数据
    ├── credentials.json             # 登录凭证（加密存储）
    ├── cursor.json                  # 消息游标
    └── active-session.json          # 当前活跃会话 ID
```

`settings.json` 的持久化字段：

- `agents`: 以 Agent ID 为键的配置对象，支持 Stdio 与 OpenAI-compatible API 两种类型；对象内保存 `order`，读取为 IPC `SettingsInfo` 时转换为数组
- `mcpServers`: 以 MCP Server ID 为键的配置对象，支持 Stdio、HTTP 和 SSE 三种类型；对象内保存 `order`
- `theme`: UI 主题配置（`theme_mode`: `"light" | "dark" | "system"`）
- `i18n`: 应用语言配置（`language`: string）
- `fileWatcher`: 文件监听配置（`enabled`: boolean）
- `ilink`: iLink 相关设置（`useOriginalImage`: `boolean`）
- `editor`: 编辑器设置（`name`: `string`，如 `"code"`、`"cursor"`）
- `sound`: 音效设置（`volume`: `number`、`muted`: `boolean`、`theme`: `"soft" | "crisp"`）
- `snippets`: Snippets 列表，每项包含 `id`、`title`、`content` 字段
- `imageGeneration`: 图片生成 Provider 列表，每项包含 `id`、`name`、`provider`、`baseUrl`、`apiKey`、`model`、`active` 等字段

`project.json` 字段：

- `id`: 项目 ID（cwd 的 SHA1 哈希）
- `title`: 项目名称
- `cwd`: 项目工作目录
- `created_at`: 毫秒级时间戳

`session.json` 字段（API Agent 会话）：

- `modelId`: 当前使用的模型 ID
- `allowedToolKinds`: 已允许的工具权限列表
- `contextUsedTokens`: 上下文窗口已用 Token 数（可选，持久化后恢复用）

`session.json` 字段（Stdio Agent 会话）：

- `id`: 会话 ID（格式：`<agent_id>:<resume_id>`）
- `title`: 会话标题
- `agent_id`: 会话使用的 Agent ID
- `resume_id`: 底层 ACP 服务的真实会话 ID
- `project_id`: 所属项目 ID
- `cwd`: 会话工作目录
- `mcp_servers`: 启用的 MCP Server ID 列表
- `features`: 启用的 feature 列表
- `permission_mode`: 权限模式（`"ask"` 或 `"allow-all"`）
- `models`: 模型配置缓存
- `modes`: 模式配置缓存
- `thought_levels`: 思考级别配置缓存
- `initialize_info`: Agent 初始化信息缓存
- `created_at` / `updated_at`: 毫秒级时间戳

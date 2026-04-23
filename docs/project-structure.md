# 项目结构

## 源码目录总览

```
fello/
├── src/
│   ├── backend/                      # Node.js 后端逻辑与系统能力
│   │   ├── backend.ts                # IPC handlers 注册、文件/终端 API 实现
│   │   ├── acp-bridge.ts             # ACP 连接封装（spawn/initialize/session/model）
│   │   ├── agent-terminal-manager.ts # Agent 专属终端进程管理
│   │   ├── utils.ts                  # 后端工具函数（如 toPosixPath、resolveSafePath）
│   │   ├── watcher.ts                # 文件系统监控（chokidar 封装）
│   │   ├── webui.ts                  # WebUI WebSocket 与 HTTP 服务端实现
│   │   └── storage.ts                # 项目/会话元数据持久化（project.json / session.json）
│   │
│   ├── electron/                     # Electron 主进程 + preload
│   │   ├── main.ts                   # 应用入口、窗口生命周期、系统菜单
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
│       ├── store.ts                  # Zustand store（按 session 分桶）
│       ├── i18n.ts                   # i18next 多语言配置初始化
│       │
│       ├── locales/                  # 多语言 JSON 字典文件
│       │   ├── en.json
│       │   └── zh-CN.json
│       │
│       ├── lib/
│       │   ├── session-state-reducer.ts      # ACP 事件解析器，将 SessionUpdate 转换为 ChatMessage 并推入 store
│       │   ├── chat-message.ts       # 多态消息类型定义与 ContentBlock 鉴别器
│       │   ├── remark-filepath.ts    # Markdown 文件路径转换为可点击链接的 remark 插件
│       │   └── utils.ts              # cn()、formatSessionTime 等工具函数
│       │
│       ├── components/
│           ├── session/              # 会话主工作区相关组件
│           │   ├── chat/             # 聊天核心区域与气泡组件
│           │   │   ├── bubbles/      # 各类角色消息气泡 (user/agent/system/tool 等)
│           │   │   ├── chat.tsx      # 聊天主容器
│           │   │   ├── chat-area.tsx # 消息流渲染与滚动控制
│           │   │   ├── chat-input.tsx# 底部输入框 (文件拖拽、提及、发送)
│           │   │   └── chat-timeline.tsx # 聊天时间线导航
│           │   ├── session-view.tsx  # 主工作区布局 (左 Chat，右 Files/Terminal)
│           │   ├── panel.tsx         # 通用面板组件容器
│           │   ├── file-panel/       # 文件面板目录
│           │   │   ├── file-panel.tsx    # 文件树、重命名、拖拽移动等
│           │   │   └── file-preview.tsx  # 文件内容与图片预览
│           │   └── terminal-panel/   # 终端面板目录
│           │       └── terminal-panel.tsx# 多终端标签与内容区
│           ├── layout/               # 整体布局组件
│           │   └── sidebar.tsx       # 左侧边栏 (项目与会话列表管理)
│           ├── settings/             # 设置相关页面组件
│           │   ├── settings-layout.tsx   # 设置页侧边导航布局
│           │   ├── settings-general.tsx  # 通用设置
│           │   ├── settings-agents.tsx   # Agents 配置页面
│           │   └── settings-webui.tsx    # WebUI 配置页面
│           ├── global/               # 全局浮层与菜单
│           │   ├── global-text-context-menu.tsx # 文本选中全局右键菜单
│           │   └── permission-dialog.tsx        # 权限确认弹层
│           ├── providers/            # 全局上下文 Provider
│           │   ├── message.tsx       # 全局消息/Toast 提示管理
│           │   └── theme.tsx         # 基于 next-themes 的主题控制
│           ├── welcome/              # 欢迎页面
│           │   └── welcome.tsx
│           ├── common/               # 通用业务组件 (stream-markdown, code-view, image-view 等)
│           ├── content-blocks/       # 多模态消息内容渲染组件 (text, image, audio 等)
│           └── ui/                   # shadcn/base-ui 基础组件
│               ├── badge.tsx
│               ├── button.tsx
│               ├── card.tsx
│               ├── context-menu.tsx
│               ├── dialog.tsx
│               ├── dropdown-menu.tsx
│               ├── hover-card.tsx
│               ├── input.tsx
│               ├── resizable.tsx
│               ├── scroll-area.tsx
│               ├── select.tsx
│               ├── separator.tsx
│               ├── sheet.tsx
│               ├── sonner.tsx
│               ├── switch.tsx
│               ├── tabs.tsx
│               └── tooltip.tsx
│
├── icons/                            # 应用图标资源
│   ├── icon.iconset/                 # macOS 多分辨率 iconset
│   └── fello_icon.png
├── docs/                             # 项目文档
├── .kiro/steering/                   # Kiro steering 规则
├── components.json                   # shadcn 生成配置
├── electron.vite.config.ts           # electron-vite 主配置
├── tsconfig.json                     # renderer TS 配置
├── tsconfig.node.json                # main/preload TS 配置
├── .oxfmtrc.json                     # 格式化配置
├── .oxlintrc.json                    # 静态检查配置
└── package.json
```

## 目录职责细化

### `src/backend`

- 面向系统能力的底层实现：文件系统、终端 PTY
- 负责 ACP 子进程与会话生命周期管理 (`acp-bridge.ts`)
- 通过 `src/shared/schema.ts` 保持主渲染层 API 契约稳定，并负责路径标准化 (`toPosixPath`)
- 管理项目与会话的本地持久化 (`storage.ts`)

### `src/electron`

- Electron 应用生命周期与窗口管理
- 系统菜单、Dock 集成、系统对话框、Finder 定位等原生能力
- 注册由 `src/backend` 提供的 IPC 处理器
- `preload.ts` 负责安全地将 IPC 能力暴露给渲染进程

### `src/mainview`

- 纯前端视图与状态管理，依赖 `window.fello` 调用主进程能力
- 事件订阅统一在 `backend.ts`，避免组件直接绑定 Electron API
- 对于只存在于 Electron 桌面端的原生交互功能（如使用访达打开、移动至废纸篓），需要封装在 `electron.ts` 中，并且组件中需要通过 `isWebUI` 变量对对应的触发 UI 元素进行隐藏，以兼容 WebUI 远端协作模式
- 页面逻辑围绕“项目 + 会话”展开，使用 `react-router-dom` 统一管理页面路由（`/` 欢迎页、`/session-view/:sessionId` 会话页、`/settings` 设置页等）。
- 聊天状态仍以 sessionId 隔离

## 数据目录（运行时）

```
~/.fello/
├── settings.json
└── projects/
    └── <project-id>/
        ├── project.json
        └── sessions/
            └── <session-id>/
                ├── session.json
                └── messages.jsonl  # 历史会话流事件日志 (NDJSON)
```

`settings.json` 字段：

- `agents`: 自定义的 Agent 列表，包含 `id` 和 `command`
- `theme`: UI 主题配置（如 `theme_mode`）
- `language`: 应用语言配置（如 `en` 或 `zh-CN`）

`project.json` 字段：

- `id`: 项目 ID
- `title`: 项目名称
- `cwd`: 项目工作目录
- `createdAt` / `updatedAt`: 秒级时间戳

`session.json` 字段：

- `id`: 会话 ID（格式：`<agent_id>:<resume_id>`）
- `title`: 会话标题
- `agent_id`: 会话使用的 Agent ID
- `resume_id`: 底层 ACP 服务的真实会话 ID
- `project_id`: 所属项目 ID
- `created_at` / `updated_at`: 秒级时间戳

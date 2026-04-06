# 项目结构

## 源码目录总览

```
fello/
├── src/
│   ├── backend/                      # Node.js 后端逻辑与系统能力
│   │   ├── backend.ts                # IPC handlers 注册、文件/终端 API 实现
│   │   ├── acp-bridge.ts             # ACP 连接封装（spawn/initialize/session/model）
│   │   ├── ipc-schema.ts             # 主渲染通信协议（请求/事件类型）
│   │   └── storage.ts                # 项目/会话元数据持久化（project.json / session.json）
│   │
│   ├── electron/                     # Electron 主进程 + preload
│   │   ├── main.ts                   # 应用入口、窗口生命周期、系统菜单
│   │   └── preload.ts                # contextBridge 暴露 window.fello.invoke/on/off
│   │
│   └── mainview/                     # Renderer（React SPA）
│       ├── App.tsx                   # 根组件，订阅全局事件，挂载 MessageProvider
│       ├── main.tsx                  # React 挂载入口
│       ├── index.css                 # 全局样式与主题变量
│       ├── index.html                # renderer HTML 模板
│       ├── backend.ts                # request + subscribe 封装
│       ├── global.d.ts               # window.fello 类型声明
│       ├── store.ts                  # Zustand store（按 session 分桶）
│       ├── i18n.ts                   # i18next 多语言配置初始化
│       │
│       ├── locales/                  # 多语言 JSON 字典文件
│       │   ├── en.json
│       │   └── zh-CN.json
│       │
│       ├── lib/
│       │   ├── process-event.ts      # ACP 事件解析与流式收尾
│       │   ├── remark-filepath.ts    # Markdown 文件路径转换为可点击链接的 remark 插件
│       │   └── utils.ts              # cn()、formatSessionTime 等工具函数
│       │
│       └── components/
│           ├── session-view.tsx      # 主工作区（左 Chat，右 Files/Terminal）
│           ├── settings-agents-dialog.tsx# 全局设置弹窗（配置 Agent 等）
│           ├── sidebar.tsx           # 项目分组侧边栏与项目/会话操作
│           ├── chat.tsx              # Chat 容器 + 权限浮层挂载
│           ├── chat-area.tsx         # 消息渲染与滚动控制
│           ├── chat-input.tsx        # 输入、提及、模型切换、发送控制
│           ├── message-bubble.tsx    # 根据 role 分发到对应 bubble
│           ├── file-panel.tsx        # 文件树、拖拽、右键菜单、导入
│           ├── terminal-panel.tsx    # 多终端页签（xterm + node-pty）
│           ├── permission-dialog.tsx # 工具权限请求弹层
│           ├── message.tsx           # 全局对话框与 Toast 队列 (MessageProvider)
│           ├── theme-provider.tsx    # 主题切换上下文
│           ├── bubbles/              # 各类消息气泡实现
│           │   ├── user-bubble.tsx
│           │   ├── agent-bubble.tsx
│           │   ├── thinking-bubble.tsx
│           │   ├── tool-bubble.tsx
│           │   └── path-link.tsx         # 提取的绝对路径链接渲染组件
│           └── ui/                   # shadcn/base-ui 基础组件
│               ├── badge.tsx
│               ├── button.tsx
│               ├── card.tsx
│               ├── context-menu.tsx
│               ├── dialog.tsx
│               ├── dropdown-menu.tsx
│               ├── input.tsx
│               ├── resizable.tsx
│               ├── scroll-area.tsx
│               ├── select.tsx
│               ├── separator.tsx
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
- 通过 `ipc-schema.ts` 保持主渲染层 API 契约稳定
- 管理项目与会话的本地持久化 (`storage.ts`)

### `src/electron`

- Electron 应用生命周期与窗口管理
- 系统菜单、Dock 集成、系统对话框、Finder 定位等原生能力
- 注册由 `src/backend` 提供的 IPC 处理器
- `preload.ts` 负责安全地将 IPC 能力暴露给渲染进程

### `src/mainview`

- 纯前端视图与状态管理，依赖 `window.fello` 调用主进程能力
- 事件订阅统一在 `backend.ts`，避免组件直接绑定 Electron API
- 页面逻辑围绕“项目 + 会话”展开，聊天状态仍以 sessionId 隔离

## 数据目录（运行时）

```
~/.fello/
├── settings.json
└── projects/
    └── <project-id>/
        ├── project.json
        └── sessions/
            └── <session-id>/
                └── session.json
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

- `id`: 会话 ID
- `title`: 会话标题（默认 "New Chat"，首轮消息后自动截断生成）
- `cwd`: 会话工作目录
- `agentCommand`: 连接 agent 的命令（默认 `kiro-cli acp`）
- `createdAt` / `updatedAt`: 秒级时间戳

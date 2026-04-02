# 项目结构

```
fello/
├── src/
│   ├── electron/                   # Electron 主进程
│   │   ├── main.ts                 # 入口，BrowserWindow，IPC handlers，进程管理
│   │   ├── preload.ts              # preload，向 renderer 暴露受限 IPC API
│   │   ├── acp-bridge.ts           # ACP 连接封装（spawn、initialize、session 管理）
│   │   ├── storage.ts              # Session 元数据持久化（meta.json）
│   │   └── ipc-schema.ts           # Electron IPC 类型定义（main ↔ renderer）
│   │
│   └── mainview/                   # Renderer 渲染进程（React SPA）
│       ├── App.tsx                 # 根组件，事件监听，布局
│       ├── main.tsx                # React 入口
│       ├── index.html              # HTML 模板
│       ├── index.css               # 全局样式，shadcn CSS 变量
│       ├── backend.ts              # Renderer 侧通信封装（request + subscribe）
│       ├── global.d.ts             # window.fello 类型声明
│       ├── store.ts                # Zustand store（全局状态）
│       │
│       ├── lib/
│       │   ├── process-event.ts    # 事件处理核心（processEvent/flushStreaming）
│       │   └── utils.ts            # cn() 工具函数
│       │
│       └── components/
│           ├── session-view.tsx     # 主视图（resizable split-view: chat + file-tree）
│           ├── sidebar.tsx          # 会话列表侧边栏
│           ├── chat.tsx             # Chat 容器（chat-area + chat-input）
│           ├── chat-area.tsx        # 消息列表 + 流式渲染
│           ├── chat-input.tsx       # 输入框 + 项目目录切换 + 模型选择 + token 用量
│           ├── message-bubble.tsx   # 消息气泡（user/assistant/tool）
│           ├── tool-call-indicator.tsx  # 实时 tool call 指示器
│           ├── permission-dialog.tsx    # 权限请求对话框
│           ├── file-tree.tsx        # 工作空间文件树
│           └── ui/                  # shadcn 生成的基础组件
│               ├── button.tsx
│               ├── badge.tsx
│               ├── card.tsx
│               ├── context-menu.tsx
│               ├── dialog.tsx
│               ├── dropdown-menu.tsx
│               ├── input.tsx
│               ├── scroll-area.tsx
│               ├── resizable.tsx
│               ├── select.tsx
│               ├── separator.tsx
│               └── tooltip.tsx
│
├── icons/                          # 应用图标
│   ├── icon.iconset/               # macOS iconset（16~1024px + @2x）
│   └── fello_icon.png              # 原始图标文件
├── docs/                           # 项目文档
├── .kiro/steering/                 # Kiro steering 规则
├── components.json                 # shadcn 配置
├── electron.vite.config.ts         # electron-vite 配置（main / preload / renderer）
├── tsconfig.json                   # Renderer TypeScript 配置
├── tsconfig.node.json              # Electron 主进程 TypeScript 配置
├── .oxfmtrc.json                   # oxfmt 配置
├── .oxlintrc.json                  # oxlint 配置
└── package.json
```

## 数据目录

```
~/.fello/
└── sessions/
    └── <session-id>/
        └── meta.json               # { id, title, cwd, agentCommand, createdAt, updatedAt }
```

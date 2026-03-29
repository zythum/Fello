# 项目结构

```
cowork/
├── src/
│   ├── bun/                        # Bun 主进程
│   │   ├── index.ts                # 入口，RPC handlers，窗口创建，进程管理
│   │   ├── acp-bridge.ts           # ACP 连接封装（spawn、initialize、session 管理）
│   │   ├── storage.ts               # Session 元数据持久化（meta.json）
│   │   └── rpc-schema.ts           # Electrobun RPC 类型定义（bun ↔ webview）
│   │
│   └── mainview/                   # Webview 渲染进程（React SPA）
│       ├── App.tsx                 # 根组件，事件监听，布局
│       ├── main.tsx                # React 入口
│       ├── index.html              # HTML 模板
│       ├── index.css               # 全局样式，shadcn CSS 变量
│       ├── rpc.ts                  # Webview 侧 RPC 封装
│       ├── store.ts                # Zustand store（全局状态）
│       │
│       ├── lib/
│       │   ├── process-event.ts    # 事件处理核心（processEvent/flushStreaming）
│       │   └── utils.ts            # cn() 工具函数
│       │
│       └── components/
│           ├── session-view.tsx     # 主视图（header + chat/welcome/loading）
│           ├── sidebar.tsx          # 会话列表侧边栏
│           ├── chat-area.tsx        # 消息列表 + 流式渲染
│           ├── chat-input.tsx       # 输入框 + 模型选择 + token 用量
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
│               ├── select.tsx
│               ├── separator.tsx
│               └── tooltip.tsx
│
├── docs/                           # 项目文档
├── .kiro/steering/                 # Kiro steering 规则
├── components.json                 # shadcn 配置
├── electrobun.config.ts            # Electrobun 构建配置
├── vite.config.ts                  # Vite 配置
├── tsconfig.json                   # TypeScript 配置
├── .prettierrc                     # Prettier 配置（2 空格）
├── .prettierignore                 # 忽略 shadcn ui 组件
└── package.json
```

## 数据目录

```
~/.cowork/
└── sessions/
    └── <session-id>/
        └── meta.json               # { id, title, cwd, agentCommand, createdAt, updatedAt }
```

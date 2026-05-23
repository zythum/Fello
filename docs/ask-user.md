# Ask User — 架构文档

## 概述

**Ask User** 是 Fello 中让 Agent 通过 MCP 工具主动向用户提问、获取输入的机制。它替代了传统的权限请求通道，成为一个通用的"用户交互通道"——既可用于权限审批，也可用于意图确认、方案选择、澄清需求等场景。

---

## 整体架构

```
                    Agent 进程 (ACP 协议)

  ┌──────────────────────────────────────────────────┐
  │  Agent 通过 MCP Client 调用 ask_user tool         │
  └────────────────────┬─────────────────────────────┘
                       ↕ stdio (MCP 协议)
  ┌────────────────────┴─────────────────────────────┐
  │          mcp-ask-user/server.ts                    │
  │  (ELECTRON_RUN_AS_NODE 独立进程)                   │
  │                                                    │
  │  工具注册: ask_user                                │
  │  后端通信: HTTP POST /ask-user/ask over Unix Socket│
  └────────────────────┬─────────────────────────────┘
                       │ (参见 docs/socket-server.md)
                       ▼
  ┌──────────────────────────────────────────────────┐
  │            Main Process Backend                    │
  │                                                    │
  │  ┌──────────────────┐                              │
  │  │   askUser() 函数  │                              │
  │  │                   │                              │
  │  │  • 发送 IPC 事件  │                              │
  │  │  • 等待前端响应    │                              │
  │  │  • 超时机制(5min)  │                              │
  │  └────────┬──────────┘                              │
  └───────────┼────────────────────────────────────────┘
              │ IPC (contextBridge)
              ▼
  ┌──────────────────────────────────────────────────┐
  │          Electron Renderer (mainview/)             │
  │                                                    │
  │  ┌──────────────────────────────────────────────┐ │
  │  │               AskUserDialog                   │ │
  │  │  • 显示标题/描述                              │ │
  │  │  • 选项列表 + "其他"输入                       │ │
  │  │  • 排队/动画管理                              │ │
  │  └──────────────────────────────────────────────┘ │
  └──────────────────────────────────────────────────┘
```

> Socket Server 的详细架构请参考 [`docs/socket-server.md`](./socket-server.md)。

---

## 分层详解

### 1. MCP 层 — `src/scripts/mcp-ask-user/server.ts`

**职责：** 向 Agent 注册 `ask_user` 工具，将 Agent 的调用通过 Unix Socket 转发到主进程。

**注册的工具：**

| 属性 | 值 |
|---|---|
| 工具名 | `ask_user` |
| 通信方式 | stdio (MCP 标准传输层) |
| 后端通信 | HTTP POST over Unix Domain Socket（路由 `/ask-user/ask`） |
| 输入校验 | Zod schema（含 title, description, options, allowCustomInput） |

**工作流：**
1. Agent 调用 `ask_user` tool
2. MCP Server 将 `input` 通过 HTTP POST `/ask-user/ask` 发送到 Unix Socket
3. 等待 Backend 返回 `{ value, reason }`
4. 格式化为 MCP 文本响应返回给 Agent

**与 Backend 的 schema 一致性：** 两边均使用 `src/shared/zod/mcp-ask-user-schema.ts` 中定义的 schema。

---

### 2. Backend 层

#### 2.1 askUser 核心函数 — `backend.ts`

`askUser()` 是统一的用户询问入口，目前有两种触发路径：

| 触发源 | 通路 |
|---|---|
| Agent 通过 MCP ask_user tool | Socket Server → askUser()（详见 [socket-server.md](./socket-server.md)） |
| Agent 权限请求 (permissionRequest) | 直接调用 askUser() |

**流程：**
1. 生成唯一 `askUserId`（UUID）
2. 构建 `AskUserRequest` 对象
3. 通过 IPC 发送 `ask-user-request` 事件到前端
4. 如果活跃 WeChat session，同步转发给微信用户
5. 返回 Promise，等待用户响应或超时（5 分钟）
6. 用户响应后 resolve Promise，返回 `{ value, reason }`

#### 2.2 Schema 校验 — `src/shared/zod/mcp-ask-user-schema.ts`

**请求 Schema (askUserAskRequestSchema)：**

```
{
  title: string;           // 问题的简要标题
  description: string;     // 详细描述
  options: Array<{         // 选项列表（至少1个）
    value: string;
    label: string;
    priority: "high" | "medium" | "low";
  }>;
  allowCustomInput?: boolean;  // 默认 true
}
```

**响应 Schema (askUserAskRespondSchema)：**

```
{
  value: string | null;   // 选中选项的 value，或 null
  reason?: string;        // 原因（timeout, no_client, 或自定义文本）
}
```

---

### 3. 前端层 (mainview)

#### 3.1 事件流

**接收（Backend → Frontend）：**

| 事件 | 载荷 | 说明 |
|---|---|---|
| `ask-user-request` | `AskUserRequest` | 后端推送新的询问请求 |
| `ask-user-response` | `AskUserResponse` | 后端通知请求已被响应 |

**发送（Frontend → Backend）：**

| IPC 调用 | 参数 | 说明 |
|---|---|---|
| `respondAskUser` | `{ sessionId, askUserId, value, reason? }` | 用户选择选项或提交自定义回复 |

#### 3.2 状态管理 — `store.ts`

每个 session 维护一个 `askUserRequests: AskUserRequest[]` 队列：

| 操作 | 说明 |
|---|---|
| `ask-user-request` 事件 | 追加到队列尾部 |
| `ask-user-response` 事件 | 从队列中移除对应 askUserId 的请求 |
| `getPendingAskUserRequests` | 窗口重连后恢复 pending 请求 |

#### 3.3 UI 组件 — `chat-ask-user-dialog.tsx`

**组件结构：**

```
AskUserDialog
  ├── 标题 (title + HelpCircle 图标)
  ├── 描述 (pre > code, JSON→YAML 自动格式化)
  └── AskUserOptions
        ├── 选项列表 (点击 → respondAskUser)
        │    每个选项: 序号 | label | priority 标签
        │    危险选项: 红色样式 (danger)
        ├── "其他"按钮 → 切换到输入模式 (allowCustomInput=true)
        └── 输入模式 (Input + Submit, 可返回选项模式)
```

**特性：**
- **排队机制：** 多个 askUser 请求依次展示，完成后自动播放下一个
- **入场/出场动画：** Tailwind transition 实现平滑过渡
- **双模式：** 选项模式（预定义选项）和输入模式（自由文本）
- **描述格式化：** JSON 描述自动转为 YAML 展示
- **危险选项：** 支持 `danger` 标记（红色样式，如拒绝权限）
- **快捷键：** Enter 提交自定义输入

---

## 数据流全景

### 正向流（Agent → 用户）

```
Agent (MCP Client)
  │ 调用 ask_user tool
  ▼
MCP Ask-User Server (子进程)
  │ HTTP POST /ask-user/ask (Unix Socket)
  │ (参见 docs/socket-server.md)
  ▼
askUser() 函数
  │ sendEvent("ask-user-request", request)
  ▼
IPC Bridge (contextBridge)
  │
  ├──► Renderer: store 追加到 askUserRequests 队列
  │     └──► AskUserDialog 渲染 UI
  │
  └──► WeChat (iLink): 转发为 Markdown 文本
```

### 反向流（用户 → Agent）

```
用户点击选项 / 提交输入
  │ backend.request.respondAskUser({ sessionId, askUserId, value })
  ▼
IPC Bridge → Backend
  │ pendingAskUserRequests.get(askUserId) → resolve(value)
  ▼
askUser() Promise resolved
  │
  ├──► Socket Server: 发送响应回 MCP 子进程
  │     └──► MCP Server: 格式化为 MCP 文本响应
  │           └──► Agent 收到 tool call 结果
  │
  └──► sendEvent("ask-user-response") → UI 移除请求
```

---

## 关键设计决策

### Schema 共享策略

Zod schema 在 `src/shared/zod/mcp-ask-user-schema.ts` 中定义一次，Backend 直接 import。MCP Server 侧的 `registerTool` 需要 inline schema（SDK 要求），但内容保持一致。这种"定义一次 + 手动同步"的取舍避免了跨进程依赖的复杂度。

---

## 相关文件清单

| 文件 | 层 | 职责 |
|---|---|---|
| `src/scripts/mcp-ask-user/server.ts` | MCP | ask_user MCP tool 注册 & Socket 转发 |
| `src/backend/backend.ts` | Backend | `askUser()` 核心逻辑 |
| `src/backend/socket-server.ts` | Backend | Unix Domain Socket HTTP 服务器（详见 [socket-server.md](./socket-server.md)） |
| `src/shared/zod/mcp-ask-user-schema.ts` | Shared | ask-user Zod schema 定义（请求 + 响应） |
| `src/shared/schema.ts` | Shared | TypeScript 接口定义 |
| `src/backend/storage.ts` | Backend | `SOCKETS_DIR` 常量 |
| `src/mainview/store.ts` | Frontend | askUser 请求队列状态管理 |
| `src/mainview/backend.ts` | Frontend | IPC 桥接 |
| `src/mainview/components/session/chat/chat-ask-user-dialog.tsx` | Frontend | UI 对话框组件 |
| `electron.vite.config.ts` | Build | MCP server 构建入口 |

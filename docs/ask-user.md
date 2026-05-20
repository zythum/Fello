# Ask User — 架构文档

## 概述

**Ask User** 是 Fello 中让 Agent 通过 MCP 工具主动向用户提问、获取输入的机制。它替代了传统的权限请求通道，成为一个通用的"用户交互通道"——既可用于权限审批，也可用于意图确认、方案选择、澄清需求等场景。

---

## 整体架构

```

                        Electron Main Process

  ┌─────────────────────────────────────────────────────────────────┐
  │                         Backend (backend.ts)                    │
  │                                                                 │
  │  ┌──────────────────┐          ┌──────────────────────┐        │
  │  │   askUser() 函数  │◄────────│  SocketServer         │        │
  │  │                   │         │  (per session)        │        │
  │  │  • 发送 IPC 事件  │         │  路由: POST /ask-user │        │
  │  │  • 等待前端响应    │         │                      │        │
  │  │  • 超时机制(5min)  │         └──────────┬───────────┘        │
  │  └────────┬──────────┘                    │                     │
  │           │                   共享 Zod Schema 校验              │
  │           │           (src/shared/zod/ask-user-mcp-schema.ts)    │
  │           │                               │                     │
  │           ▼                               ▼                     │
  │  ┌─────────────────────────────────────────────────────────┐   │
  │  │            Electron IPC (contextBridge)                  │   │
  │  │  事件: ask-user-request / ask-user-response              │   │
  │  └────────────────────┬────────────────────────────────────┘   │
  └───────────────────────┼────────────────────────────────────────┘
                          │
  ┌───────────────────────┼────────────────────────────────────────┐
  │           Electron Renderer (mainview/)                        │
  │  ┌────────────────────┴──────────────────────────────────┐    │
  │  │                    App (App.tsx)                       │    │
  │  │  ┌─────────────────────────────────────────────────┐  │    │
  │  │  │               Chat (chat.tsx)                   │  │    │
  │  │  │  ┌───────────────────────────────────────────┐  │  │    │
  │  │  │  │     AskUserDialog                          │  │  │    │
  │  │  │  │  • 显示标题/描述                            │  │  │    │
  │  │  │  │  • 选项列表 + "其他"输入                     │  │  │    │
  │  │  │  │  • 排队/动画管理                            │  │  │    │
  │  │  │  └───────────────────────────────────────────┘  │  │    │
  │  │  └─────────────────────────────────────────────────┘  │    │
  │  └───────────────────────────────────────────────────────┘    │
  └────────────────────────────────────────────────────────────────┘

                    MCP 子进程 (独立 Node.js 进程)

  ┌─────────────────────────────────────────────────────────────────┐
  │              mcp-ask-user/server.ts                             │
  │  • 注册 ask_user MCP tool                                       │
  │  • 通过 stdio 与 Agent (MCP Client) 通信                        │
  │  • 通过 Unix Socket HTTP POST 调用 Backend                      │
  │                             ↕ stdio (MCP 协议)                  │
  │              Agent 进程 (ACP 协议)                               │
  │  • 通过 MCP Client 调用 ask_user tool                            │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 分层详解

### 1. MCP 层 — `src/scripts/mcp-ask-user/server.ts`

**职责：** 向 Agent 注册 `ask_user` 工具，将 Agent 的调用通过 Unix Socket 转发到主进程。

**注册的工具：**

| 属性 | 值 |
|---|---|
| 工具名 | `ask_user` |
| 通信方式 | stdio (MCP 标准传输层) |
| 后端通信 | HTTP POST over Unix Domain Socket |
| 输入校验 | Zod schema（含 title, description, options, allowCustomInput） |

**工作流：**
1. Agent 调用 `ask_user` tool
2. MCP Server 将 `input` 直接通过 HTTP POST `/ask-user` 发送到 Unix Socket
3. 等待 Backend 返回 `{ value, reason }`
4. 格式化为 MCP 文本响应返回给 Agent

**与 Backend 的 schema 一致性：** 两边均使用 `src/shared/zod/ask-user-mcp-schema.ts` 中定义的 schema。

---

### 2. Backend 层

#### 2.1 Socket Server — `src/backend/socket-server.ts`

**职责：** 轻量级 Unix Domain Socket HTTP 服务器，作为 MCP 子进程与主进程的 IPC 桥梁。

| 功能 | 说明 |
|---|---|
| 启动 | `startSocketServer(socketPath)` — 创建 HTTP server 监听指定 socket 文件 |
| 停止 | `stop()` — 关闭 server 并删除 socket 文件 |
| 路由注册 | `registry(path, handler)` — 注册 POST 路由处理器 |
| 健康检查 | `GET /health` → `{ ok: true }` |
| 生命周期 | 每个 session 独立一个 server，在 session 创建时启动，删除时停止 |

#### 2.2 Session Socket 管理 — `backend.ts`

```
sessionSocketServers = Map<sessionId, SocketServer>

createSessionSocketServer(sessionId, { socketPath })  → 创建/复用
stopSessionSocketServer(sessionId)                     → 停止并清理
```

**生命周期绑定：**

| 事件 | 动作 |
|---|---|
| `newSession` | 生成 socket 路径 → 构建 MCP 配置 → 创建 socket server |
| `loadSession` (配置变更) | stop 旧 server → 重载 session → 创建新 server |
| `loadSession` (新加载) | 创建 socket server |
| `sendPrompt` (懒加载) | 创建 socket server |
| `deleteSession` | stop socket server |
| `clearBackend` (退出) | stop 所有 socket servers |

#### 2.3 askUser 核心函数 — `backend.ts`

`askUser()` 是统一的用户询问入口，目前有两种触发路径：

| 触发源 | 通路 |
|---|---|
| Agent 通过 MCP ask_user tool | Socket Server → askUser() |
| Agent 权限请求 (permissionRequest) | 直接调用 askUser() |

**流程：**
1. 生成唯一 `askUserId`（UUID）
2. 构建 `AskUserRequest` 对象
3. 通过 IPC 发送 `ask-user-request` 事件到前端
4. 如果活跃 WeChat session，同步转发给微信用户
5. 返回 Promise，等待用户响应或超时（5 分钟）
6. 用户响应后 resolve Promise，返回 `{ value, reason }`

#### 2.4 Schema 校验 — `src/shared/zod/ask-user-mcp-schema.ts`

**请求 Schema (askUserRequestSchema)：**

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

**响应 Schema (askUserRespondSchema)：**

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
  │ HTTP POST /ask-user (Unix Socket)
  ▼
Socket Server (主进程)
  │ askUserRequestSchema.parse(payload)
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

### 为什么用 Unix Socket 而不是直接调用？

MCP 子进程与主进程是独立的 Node.js 进程。Unix Domain Socket 相比其他 IPC 方式的优势：

| 方式 | 优点 | 缺点 |
|---|---|---|
| Unix Socket | 性能好、支持双向、可加健康检查 | 需管理 socket 文件生命周期 |
| TCP loopback | 简单 | 有网络栈开销，需选端口防冲突 |
| stdio 回传 | 无需额外机制 | 单向、难扩展 |
| 共享内存 | 高性能 | 复杂、易出错 |

Socket 文件放在 `~/.fello/sockets/`，路径含随机 UUID，防止其他本地进程意外访问。

### 为什么每个 Session 一个 Socket Server？

每个 session 的 MCP 配置中嵌入了 ask-user socket 路径（作为 Agent 启动 MCP Server 的参数）。如果多个 session 共用同一个 socket，当某个 session 销毁时无法安全关闭。Session 级隔离确保：
- 独立生命周期（创建/销毁不影响其他 session）
- 独立路由注册（未来可扩展更多 per-session 路由）
- 意外崩溃只影响单个 session

### Schema 共享策略

Zod schema 在 `src/shared/zod/ask-user-mcp-schema.ts` 中定义一次，Backend 直接 import。MCP Server 侧的 `registerTool` 需要 inline schema（SDK 要求），但内容保持一致。这种"定义一次 + 手动同步"的取舍避免了跨进程依赖的复杂度。

---

## 相关文件清单

| 文件 | 层 | 职责 |
|---|---|---|
| `src/scripts/mcp-ask-user/server.ts` | MCP | MCP tool 注册 & Socket 转发 |
| `src/backend/backend.ts` | Backend | `askUser()` 核心逻辑 + Socket 生命周期管理 |
| `src/backend/socket-server.ts` | Backend | Unix Domain Socket HTTP 服务器 |
| `src/shared/zod/ask-user-mcp-schema.ts` | Shared | Zod schema 定义（请求 + 响应） |
| `src/shared/schema.ts` | Shared | TypeScript 接口定义 |
| `src/backend/storage.ts` | Backend | `SOCKETS_DIR` 常量 |
| `src/mainview/store.ts` | Frontend | askUser 请求队列状态管理 |
| `src/mainview/backend.ts` | Frontend | IPC 桥接 |
| `src/mainview/components/session/chat/chat-ask-user-dialog.tsx` | Frontend | UI 对话框组件 |
| `electron.vite.config.ts` | Build | MCP server 构建入口 |

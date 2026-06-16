# Socket Server — Unix Domain Socket IPC

## 概述

**Socket Server** 是 Fello 中 MCP 子进程与主进程（Backend）之间的 IPC 桥梁。它基于 Unix Domain Socket HTTP 协议，每个会话（Session）独立一个实例，用于 MCP 工具的回调通信。

目前有两个 MCP 工具集通过 Socket Server 与主进程通信：

| MCP Server | 工具 | Socket 路由 |
|---|---|---|
| `mcp-ask-user` | `ask_user` | `ask-user/ask` |
| `mcp-skills` | `list_skills`、`activate_skill` | `skills/catalog`、`skills/detail` |

---

## 整体架构

```
                    MCP 子进程 (独立 Node.js 进程)

  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐
  │         mcp-ask-user/server.ts   │  │         mcp-skills/server.ts     │
  │  ┌─────────────────────────────┐ │  │  ┌─────────────────────────────┐ │
  │  │  HTTP POST /ask-user/ask    │ │  │  │  HTTP POST /skills/catalog  │ │
  │  │  HTTP POST /skills/detail   │ │  │  │  HTTP POST /skills/detail   │ │
  │  └──────────┬──────────────────┘ │  │  └──────────┬──────────────────┘ │
  └─────────────┼────────────────────┘  └─────────────┼────────────────────┘
                │ HTTP POST over Unix Socket           │ HTTP POST
                ▼                                      ▼
  ┌────────────────────────────────────────────────────────────┐
  │              Main Process SocketServer                      │
  │  (每个 session 独立实例，监听独立的 socket 文件)              │
  │                                                             │
  │  路由表:                                                     │
  │    POST /ask-user/ask   → askUser()                         │
  │    POST /skills/catalog → getSkillsCatalog()                 │
  │    POST /skills/detail  → skill detail lookup                │
  │    GET  /health         → { ok: true }                      │
  └─────────────────────────────────────────────────────────────┘
```

---

## 为什么用 Unix Socket 而不是直接调用？

MCP 子进程与主进程是独立的 Node.js 进程。Unix Domain Socket 相比其他 IPC 方式的优势：

| 方式 | 优点 | 缺点 |
|---|---|---|
| **Unix Socket** | 性能好、支持双向、可加健康检查 | 需管理 socket 文件生命周期 |
| TCP loopback | 简单 | 有网络栈开销，需选端口防冲突 |
| stdio 回传 | 无需额外机制 | 单向、难扩展 |
| 共享内存 | 高性能 | 复杂、易出错 |

Socket 文件放在 `~/.fello/sockets/`，路径含随机 UUID，防止其他本地进程意外访问。

---

## 为什么每个 Session 一个 Socket Server？

每个 session 的 MCP 配置中嵌入了 ask-user/skills socket 路径（作为 Agent 启动 MCP Server 的参数）。如果多个 session 共用同一个 socket，当某个 session 销毁时无法安全关闭。Session 级隔离确保：

- 独立生命周期（创建/销毁不影响其他 session）
- 独立路由注册（未来可扩展更多 per-session 路由）
- 意外崩溃只影响单个 session

---

## Socket Server API

### `src/backend/socket-server.ts`

轻量级 Unix Domain Socket HTTP 服务器。

| 功能 | 说明 |
|---|---|
| `startSocketServer(socketPath)` | 创建 HTTP server 监听指定 socket 文件，返回 `SocketServer` 实例 |
| `ss.stop()` | 关闭 server 并删除 socket 文件 |
| `ss.registry(path, handler)` | 注册 POST 路由处理器 |
| `generateSocketPath(key)` | 生成 socket 文件路径（Windows 命名管道 / Unix socket），含时间戳 |
| `GET /health` | 健康检查 → `{ ok: true }` |

### Session Socket 管理 — `session.ts`

```
sessionSocketServers = Map<sessionId, SocketServer>

createSessionSocketServer(sessionId, { socketPath, project })  → 创建/复用
stopSessionSocketServer(sessionId)                              → 停止并清理
```

**注册的路由：**

| 路由 | 功能 | 所属 feature |
|------|------|-------------|
| `ask-user/ask` | Agent 向用户提问 | `ask_user` |
| `skills/catalog` | 获取 Skills 目录列表 | `skills` |
| `skills/detail` | 获取指定 Skill 的详细信息 | `skills` |

**生命周期绑定：**

| 事件 | 动作 |
|---|---|
| `newSession` | 生成 socket 路径 → 构建 MCP 配置 → 创建 socket server |
| `loadSession` (配置变更) | stop 旧 server → 重载 session → 创建新 server |
| `loadSession` (新加载) | 创建 socket server |
| `sendPrompt` (懒加载) | 创建 socket server |
| `deleteSession` | stop socket server |
| `clearBackend` (退出) | stop 所有 socket servers |

---

## Socket 通信协议

MCP 子进程通过 HTTP POST 向 Socket Server 发送请求，Socket Server 处理后返回 JSON 响应。

### 请求格式

```
POST /<route> HTTP/1.1
Content-Type: application/json
Content-Length: <length>

<JSON body>
```

### 响应格式

```
HTTP/1.1 200 OK
Content-Type: application/json

<JSON response>
```

错误时返回：

```
HTTP/1.1 4xx/5xx
Content-Type: application/json

{ "error": "error message" }
```

### MCP 子进程侧的 HTTP 客户端

两个 MCP Server（`mcp-ask-user` 和 `mcp-skills`）使用相同的 `postToSocket()` 函数：

```typescript
function postToSocket(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options: http.RequestOptions = {
      socketPath,            // Unix socket 文件路径
      path,                  // 路由路径，如 /ask-user/ask
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      // 解析响应 JSON
    });
    req.write(data);
    req.end();
  });
}
```

---

## 相关文件清单

| 文件 | 职责 |
|---|---|
| `src/backend/socket-server.ts` | Unix Domain Socket HTTP 服务器实现 + `generateSocketPath()` |
| `src/backend/session.ts` | Socket 生命周期管理（创建/复用/停止） |
| `src/backend/skills.ts` | `registerSkillsRoute()` / `buildSkillsMcpServer()` |
| `src/backend/ask-user.ts` | `registerAskUserRoute()` / `buildAskUserMcpServer()` |
| `src/scripts/mcp-ask-user/server.ts` | ask-user MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-skills/server.ts` | skills MCP 客户端，使用 Socket Server |
| `src/backend/storage.ts` | `SOCKETS_DIR` 常量（socket 文件存放目录） |

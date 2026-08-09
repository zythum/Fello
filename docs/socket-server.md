# Socket Server — Local Socket HTTP IPC

## 概述

**Socket Server** 是 Fello 中 MCP 子进程与主进程（Backend）之间的 IPC 桥梁。它在 Unix-like 系统上使用 Unix Domain Socket、在 Windows 上使用命名管道承载 HTTP，并按调用生命周期创建独立实例：常规会话由 `src/backend/session/index.ts` 为每个 Session 管理一个 Socket Server；`InferenceModule` 和 Memory 内部 Memo inference 则使用执行期临时 Socket Server。

### 常规 Session Socket

| MCP Server | 工具 | Socket 路由 |
|---|---|---|
| `mcp-ask-user` | `ask_user` | `ask-user/ask` |
| `mcp-skills` | `list_skills`、`activate_skill` | `skills/catalog`、`skills/detail` |
| `mcp-search` | `search`、`rg`、`file_outline` | `search/search`、`search/rg`、`search/file_outline` |
| `mcp-share-to-user` | `share_to_user` | `share-to-user/share` |
| `mcp-memory` | `memory_query`、`memory_store` | `memory/query`、`memory/store` |
| `mcp-image-generation` | `image_generation` | `image-generation/generate` |
| `mcp-toolbox` | 编码解码、哈希、时间、UUID、随机值、图片处理、QR 码生成工具 | `toolbox/*`（始终加载） |

`toolbox/*` 汇总 17 条 Session Socket 路由：`toolbox/base64-encode`、`toolbox/base64-decode`、`toolbox/url-encode`、`toolbox/url-decode`、`toolbox/hash`、`toolbox/time`、`toolbox/uuid`、`toolbox/short-id`、`toolbox/random`、`toolbox/rand-int`、`toolbox/choice`、`toolbox/shuffle`、`toolbox/image-metadata`、`toolbox/image-thumbnail`、`toolbox/image-resize`、`toolbox/image-convert`、`toolbox/image-qrcode`。

### 临时 Memo Socket

Memory 的 query/store inference 每次单独创建临时 Memo Socket，不注册到 Session Socket：

| MCP Server | 工具 | Socket 路由 |
|---|---|---|
| `mcp-memo` | `memo_get_current`、`memo_touch` | `memo/read`、`memo/touch` |
| `mcp-memo --writable` | `memo_get_current`、`memo_add`、`memo_delete`、`memo_set_weight` | `memo/read`、`memo/add`、`memo/delete`、`memo/set-weight` |

路由处理器始终挂载到临时 Socket Server；`mcp-memo` 的启动模式决定 Agent 实际可见的工具。临时 server 在该次 inference 结束后关闭。

### Headless Inference Socket

`src/backend/inference.ts` 为 Automation 和内部推理创建执行期 Socket Server。该路径始终注册 Toolbox，并按 `features` 可选注册 Skills 与 Search；`ask_user` 和 `share_to_user` 在 headless 模式下明确排除。

---

## 整体架构

```
  常规会话 MCP 子进程                         Memory 内部 mcp-memo
  ask-user / skills / search /              query 或 writable 模式
  share-to-user / memory /
  image-generation / toolbox
              │                                      │
              │ HTTP POST over Unix Socket            │ HTTP POST over Unix Socket
              ▼                                      ▼
  ┌──────────────────────────────┐       ┌──────────────────────────────┐
  │ Session SocketServer         │       │ 临时 Memo SocketServer       │
  │ 每个 Session 独立实例         │       │ 每次 Memo inference 独立实例  │
  │                              │       │                              │
  │ ask-user/*                   │       │ memo/read                    │
  │ skills/*                     │       │ memo/touch                   │
  │ search/*                     │       │ memo/add                     │
  │ share-to-user/*              │       │ memo/delete                  │
  │ memory/query, memory/store   │       │ memo/set-weight              │
  │ image-generation/*           │       │                              │
  │ toolbox/*                    │       │ GET /health                  │
  │ GET /health                  │       └──────────────────────────────┘
  └──────────────────────────────┘
```

---

## 为什么使用本地 Socket 而不是直接调用？

MCP 子进程与主进程是独立的 Node.js 进程。本地 Socket/命名管道相比其他 IPC 方式的优势：

| 方式 | 优点 | 缺点 |
|---|---|---|
| **Unix Socket / Windows 命名管道** | 性能好、支持双向、可加健康检查 | Unix-like 系统需管理 socket 文件生命周期 |
| TCP loopback | 简单 | 有网络栈开销，需选端口防冲突 |
| stdio 回传 | 无需额外机制 | 单向、难扩展 |
| 共享内存 | 高性能 | 复杂、易出错 |

Unix-like 系统的 socket 文件放在 `~/.fello/sockets/`；Windows 使用 `\\.\pipe\fello-*` 命名管道。生成路径包含调用方 key 与时间戳。

---

## 为什么常规会话采用每个 Session 一个 Socket Server？

每个常规 session 的 MCP 配置中嵌入了 socket 路径（作为 Agent 启动各内置 MCP Server 的参数）。如果多个 session 共用同一个 socket，当某个 session 销毁时无法安全关闭。Session 级隔离确保：

- 独立生命周期（创建/销毁不影响其他 session）
- 独立路由注册（未来可扩展更多 per-session 路由）
- 意外崩溃只影响单个 session

---

## Socket Server API

### `src/backend/socket-server.ts`

轻量级本地 Socket HTTP 服务器。

| 功能 | 说明 |
|---|---|
| `startSocketServer(socketPath)` | 创建 HTTP server 监听指定 socket 文件，返回 `SocketServer` 实例 |
| `ss.stop()` | 关闭 server 并删除 socket 文件 |
| `ss.registry(path, handler)` | 注册 POST 路由处理器 |
| `generateSocketPath(key)` | 生成 Windows 命名管道或 Unix socket 文件路径，含时间戳 |
| `GET /health` | 健康检查 → `{ ok: true }` |

### Session Socket 管理 — `session/index.ts`

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
| `search/search` | 代码搜索（ripgrep） | `search` |
| `search/rg` | 原始 ripgrep 搜索 | `search` |
| `search/file_outline` | 文件大纲（tree-sitter） | `search` |
| `share-to-user/share` | 文件分享给用户 | `share_to_user` |
| `memory/query` | 项目记忆语义检索 | `memory` |
| `memory/store` | 项目记忆存储 | `memory` |
| `image-generation/generate` | 文本生成图片 | `image_generation` |
| `toolbox/*` | 17 条编码/哈希/时间/UUID/随机值/图片处理/QR 码工具路由 | 始终加载 |

**生命周期绑定：**

| 事件 | 动作 |
|---|---|
| `newSession` | 生成 socket 路径 → 构建 MCP 配置 → 创建 socket server |
| `loadSession` (配置变更) | stop 旧 server → 重载 session → 创建新 server |
| `loadSession` (新加载) | 创建 socket server |
| `sendPrompt` (懒加载) | 创建 socket server |
| `deleteSession` | stop socket server |
| `clearSession()`（backend 清理/退出） | stop 所有 Session Socket Servers |

### 临时 Memo Socket — `memory.ts`

`runMemoAgent()` 为每次 Memory query/store 创建新的 socket 路径和 `SocketServer`，在内存 draft 上注册 `memo/read`、`memo/touch`、`memo/add`、`memo/delete`、`memo/set-weight`。它只服务于该次内部 Memo inference，并在 `finally` 中停止 server、删除临时工作目录；这些路由不进入 `sessionSocketServers`。

---

## Socket 通信协议

MCP 子进程通过本地 socket 上的 HTTP POST 向 Socket Server 发送请求，Socket Server 处理后返回 JSON 响应。

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

各内置 MCP 子进程使用同类 `postToSocket()` HTTP 客户端，将工具调用转发到启动参数指定的 socket：

```typescript
function postToSocket(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options: http.RequestOptions = {
      socketPath,            // Unix socket 路径或 Windows 命名管道
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
| `src/backend/socket-server.ts` | 本地 Socket HTTP 服务器实现 + `generateSocketPath()` |
| `src/backend/session/index.ts` | Socket 生命周期管理（创建/复用/停止） |
| `src/backend/skills.ts` | `registerSkillsRoute()` / `buildSkillsMcpServer()` |
| `src/backend/ask-user.ts` | `registerAskUserRoute()` / `buildAskUserMcpServer()` |
| `src/backend/search/index.ts` | `registerSearchRoute()` / `buildSearchMcpServer()` |
| `src/backend/share-to-user.ts` | `registerShareToUserRoute()` / `buildShareToUserMcpServer()` |
| `src/backend/memory.ts` | Memory 路由注册 + Memo 路由注册 + MCP Server 构建 |
| `src/backend/image-generation.ts` | Image Generation 路由注册 + MCP Server 构建 |
| `src/backend/toolbox.ts` | Toolbox 路由注册 + MCP Server 构建 |
| `src/scripts/mcp-ask-user/server.ts` | ask-user MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-skills/server.ts` | skills MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-search/server.ts` | search MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-share-to-user/server.ts` | share-to-user MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-memory/server.ts` | memory MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-memo/server.ts` | memo MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-image-generation/server.ts` | image-generation MCP 客户端，使用 Socket Server |
| `src/scripts/mcp-toolbox/server.ts` | toolbox MCP 客户端，使用 Socket Server |
| `src/backend/storage/constant.ts` | `SOCKETS_DIR` 常量（Unix-like 系统的 socket 文件目录） |

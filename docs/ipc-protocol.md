# IPC 协议参考

## 概述

Fello 的 IPC（进程间通信）协议定义在 `src/shared/schema.ts` 中，是 **Renderer（前端）** 与 **Main（后端）** 之间的唯一通信契约。协议分为两种模式：

- **请求-响应（Request/Response）**：前端主动调用，后端返回结果
- **推送事件（Event）**：后端主动推送，前端订阅监听

两种模式在传输层上统一封装，前端无需关心底层是 Electron IPC 还是 WebSocket。

## 类型定义

### `FelloIPCSchema` — 协议总入口

```typescript
type FelloIPCSchema = {
  requests: FelloIPCRequests;  // 所有请求-响应定义
  events: FelloIPCEvents;      // 所有推送事件定义
};
```

### `FelloIPCRequests` — 请求-响应

每个请求方法遵循统一的签名模式：

```typescript
方法名: {
  params: { ... } | void;      // 参数类型
  response: { ... } | void;    // 返回值类型
};
```

示例：

```typescript
sendPrompt: {
  params: {
    sessionId: string;
    contents: ContentBlock[];
  };
  response: { stopReason: string };
};
```

### `FelloIPCEvents` — 推送事件

每个事件定义事件名与载荷类型：

```typescript
"事件名": { ... payload ... } | void;
```

示例：

```typescript
"session-update": {
  sessionId: string;
  notification: SessionNotificationFelloExt;
};
```

## 完整方法列表

### 系统与设置

| 方法 | params | response | 说明 |
|---|---|---|---|
| `getSettings` | `void` | `SettingsInfo` | 获取全局设置 |
| `updateSettings` | `Partial<SettingsInfo>` | `void` | 更新全局设置 |
| `getPlatform` | `void` | `string` | 获取当前操作系统平台 |

### WebUI

| 方法 | params | response | 说明 |
|---|---|---|---|
| `startWebUIServer` | `{ port?, token? }` | `WebUIStatus` | 启动 WebUI 服务 |
| `stopWebUIServer` | `void` | `WebUIStatus` | 停止 WebUI 服务 |
| `getWebUIStatus` | `void` | `WebUIStatus` | 获取当前 WebUI 状态 |

### Skills

| 方法 | params | response | 说明 |
|---|---|---|---|
| `getSkillsCatalog` | `{ all?, projectId? }` | `SkillInfo[]` | 获取已安装 Skills |
| `readSkillFile` | `{ skillId, projectId? }` | `string` | 读取 SKILL.md 内容 |
| `getSkillFileSystemFilePath` | `{ skillId, projectId? }` | `string` | 获取 SKILL.md 系统路径 |
| `uninstallSkill` | `{ skillId, projectId? }` | `void` | 卸载 Skill |
| `searchSkillsFromSkillsSh` | `{ query }` | `Array<...>` | 搜索 skills.sh 市场 |
| `installSkillFromSkillsSh` | `{ source, slug }` | `void` | 从 skills.sh 安装 |

### 项目与会话管理

| 方法 | params | response | 说明 |
|---|---|---|---|
| `listSessions` | `void` | `SessionInfo[]` | 获取所有会话列表 |
| `listProjects` | `void` | `ProjectInfo[]` | 获取所有项目列表 |
| `addProject` | `string` (cwd) | `ProjectInfo` | 添加项目 |
| `renameProject` | `{ projectId, title }` | `void` | 重命名项目 |
| `deleteProject` | `string` (projectId) | `void` | 删除项目 |
| `deleteSession` | `string` (sessionId) | `void` | 删除会话 |
| `updateSession` | `{ sessionId, title?, mcpServers?, features? }` | `void` | 更新会话属性（标题 / MCP / features） |

### 会话交互

| 方法 | params | response | 说明 |
|---|---|---|---|
| `newSession` | `{ projectId, agentId, mcpServers?, features?, permissionMode? }` | `{ sessionId, initializeInfo, models, modes }` | 创建新会话 |
| `loadSession` | `{ sessionId }` | `{ sessionId, initializeInfo, models, modes }` | 恢复已有关会话 |
| `getSessionHistory` | `{ sessionId }` | `{ messages }` | 获取会话历史消息 |
| `sendPrompt` | `{ sessionId, contents }` | `{ stopReason, usage? }` | 发送用户 Prompt |
| `cancelPrompt` | `{ sessionId }` | `void` | 取消当前生成 |
| `respondAskUser` | `{ sessionId, askUserId, value, reason? }` | `void` | 响应 askUser 请求 |
| `getPendingAskUserRequests` | `{ sessionId }` | `AskUserRequest[]` | 获取 pending 的 askUser 请求 |
| `changeWorkDir` | `{ sessionId }` | `{ ok, cwd }` | 更改会话工作目录 |

### 模型与模式

| 方法 | params | response | 说明 |
|---|---|---|---|
| `getModels` | `{ sessionId }` | `SessionModelState \| null` | 获取可用模型列表 |
| `setModel` | `{ sessionId, modelId }` | `void` | 切换模型 |
| `getModes` | `{ sessionId }` | `SessionModeState \| null` | 获取可用模式列表 |
| `setMode` | `{ sessionId, modeId }` | `void` | 切换模式 |

### 文件系统

| 方法 | params | response | 说明 |
|---|---|---|---|
| `searchFiles` | `{ projectId, query? }` | `Array<{ id, filename, isFolder }>` | 搜索项目文件 |
| `readDir` | `{ projectId, relativePath? }` | `Array<{ id, name, isFolder }>` | 读取目录内容 |
| `readFile` | `{ projectId, relativePath, encoding? }` | `string` | 读取文件内容 |
| `getFileInfo` | `{ projectId, relativePath }` | `{ size, isFile, isBinary } \| null` | 获取文件元信息 |
| `createFile` | `{ projectId, relativePath, isFolder }` | `void` | 新建文件/文件夹 |
| `deleteFile` | `{ projectId, relativePath }` | `void` | 删除文件/文件夹 |
| `renameFile` | `{ projectId, oldRelativePath, newRelativePath }` | `void` | 重命名 |
| `moveFile` | `{ projectId, oldRelativePath, newRelativePath }` | `void` | 移动 |
| `writeExternalFile` | `{ projectId, fileName, base64, destRelativeDir? }` | `void` | 写入外部文件 |
| `copyFileToWorkspace` | `{ projectId, sourcePath, destDir? }` | `{ success, destPath }` | 复制文件到工作区 |
| `readUrlAsDataUrl` | `{ url, mimeType? }` | `string` | 读取 URL 为 DataURL |
| `getSystemFilePath` | `{ projectId, path, isAbsolute? }` | `string` | 获取系统真实路径 |
| `getGitStatus` | `{ projectId, cwd? }` | `{ branch, files } \| null` | 获取 Git 状态 |
| `readGitHeadFile` | `{ projectId, relativePath, encoding? }` | `string` | 读取 Git HEAD 文件 |

### 终端

| 方法 | params | response | 说明 |
|---|---|---|---|
| `createTerminal` | `{ projectId, cwd?, cols?, rows?, clientId? }` | `{ terminalId }` | 创建终端实例 |
| `writeTerminal` | `{ terminalId, data }` | `{ ok }` | 向终端写入数据 |
| `killTerminal` | `{ terminalId }` | `{ terminalId? }` | 销毁终端 |
| `killTerminalsByClient` | `{ clientId }` | `{ terminalIds }` | 批量销毁客户端终端 |
| `resizeTerminal` | `{ terminalId, cols, rows }` | `{ ok }` | 调整终端尺寸 |
| `getAgentTerminalOutput` | `{ sessionId, terminalId }` | `string` | 获取 Agent 专属终端输出 |
| `registerClient` | `{ clientId }` | `void` | 注册客户端标识 |

### iLink 微信

| 方法 | params | response | 说明 |
|---|---|---|---|
| `getIlinkStatus` | `void` | `{ connected, userId?, accountId?, qrcodeUrl?, error? }` | 获取连接状态 |
| `startIlinkLogin` | `void` | `{ qrcode, qrcodeImgUrl }` | 开始扫码登录 |
| `pollIlinkQrcode` | `{ qrcode }` | `{ status }` | 轮询扫码状态 |
| `stopIlink` | `void` | `void` | 断开连接 |
| `setActiveIlinkSession` | `{ sessionId }` | `void` | 设置活跃微信会话 |
| `getActiveIlinkSession` | `void` | `{ sessionId: string \| null }` | 获取当前活跃会话 |

## 完整事件列表

| 事件名 | payload | 说明 |
|---|---|---|
| `session-changed` | `{ session: SessionInfo }` | 会话元数据变更（标题、模型等） |
| `session-update` | `{ sessionId, notification }` | 会话流式事件（消息、工具调用等） |
| `ask-user-request` | `AskUserRequest` | Agent 发起 askUser 请求 |
| `ask-user-response` | `AskUserResponse` | askUser 请求已响应 |
| `terminal-output` | `{ terminalId, data }` | 终端输出数据 |
| `terminal-exit` | `{ terminalId, exitCode }` | 终端进程退出 |
| `agent-terminal-output` | `{ sessionId, terminalId, data }` | Agent 专属终端输出 |
| `webui-status-changed` | `{ status }` | WebUI 服务状态变更 |
| `ilink-status-changed` | `{ status }` | iLink 连接状态变更 |
| `ilink-active-session-changed` | `{ sessionId: string \| null }` | iLink 活跃会话变更 |
| `projects-changed` | `void` | 项目列表变更（新增/删除/重命名） |
| `sessions-changed` | `void` | 会话列表变更 |
| `fs-changed` | `{ projectId, changes }` | 文件系统变更 |

## 前后端调用链路

### Electron 模式

```
Renderer (React)
  └─ request.sendPrompt({ sessionId, contents })   // 类型安全的 Proxy 调用
      └─ invokeIPC("sendPrompt", params)
          └─ window.fello.invoke("sendPrompt", params)   // contextBridge
              └─ ipcMain.handle("sendPrompt", handler)   // Electron IPC
                  └─ backendHandlers.sendPrompt()         // 实际业务逻辑
```

### WebUI 模式

```
Renderer (Browser)
  └─ request.sendPrompt({ sessionId, contents })
      └─ invokeIPC("sendPrompt", params)
          └─ WebSocket.send({ type: "request", id, channel: "sendPrompt", params })
              └─ Main WS Server → 解析请求 → backendHandlers.sendPrompt()
                  └─ WebSocket.send({ type: "response", id, response })
```

### 事件推送（两种模式一致）

```
Main Process
  └─ sendEvent("session-update", { sessionId, notification })
      ├─ broadcastWebUIEvent("session-update", payload)   // WebUI WebSocket
      └─ BrowserWindow.webContents.send("session-update", payload)  // Electron IPC

Renderer
  └─ subscribe.on("session-update", handler)  // 统一的事件订阅 API
```

## 前端调用方式

前端通过 `src/mainview/backend.ts` 暴露的 `request` 和 `subscribe` 进行 IPC 通信：

```typescript
import { request, subscribe } from "../../backend";

// 请求-响应
const settings = await request.getSettings();
await request.sendPrompt({ sessionId, contents: [{ type: "text", text: "hello" }] });

// 事件订阅
const unsubscribe = subscribe.on("session-update", ({ sessionId, notification }) => {
  // 处理流式更新
});
```

`request` 是一个 `Proxy` 对象，所有方法名自动映射为 IPC channel 名，类型由 `FelloIPCSchema` 自动推导。

## 添加一个新的 IPC 方法

以添加一个"获取系统运行时间"的方法为例：

### 1. 在 `schema.ts` 的 `FelloIPCRequests` 添加类型

```typescript
export type FelloIPCRequests = {
  // ... 已有方法

  /** 获取系统运行时间 */
  getUptime: {
    params: void;
    response: { seconds: number };
  };
};
```

### 2. 在 `backend.ts` 的 `backendHandlers` 添加实现

```typescript
export const backendHandlers: { [K in keyof FelloIPCSchema["requests"]]: ... } = {
  // ... 已有 handlers

  async getUptime() {
    return { seconds: process.uptime() };
  },
};
```

### 3. 在前端调用

```typescript
import { request } from "../../backend";

const { seconds } = await request.getUptime();
```

### 添加一个新的事件

### 1. 在 `schema.ts` 的 `FelloIPCEvents` 添加类型

```typescript
export type FelloIPCEvents = {
  // ... 已有事件

  /** 系统电量变更 */
  "battery-changed": { level: number; charging: boolean };
};
```

### 2. 在后端触发事件

```typescript
sendEvent("battery-changed", { level: 85, charging: true });
```

### 3. 在前端订阅

```typescript
import { subscribe } from "../../backend";

subscribe.on("battery-changed", ({ level, charging }) => {
  console.log(`Battery: ${level}%${charging ? " (charging)" : ""}`);
});
```

> 注意：新事件需要在 `backend.ts` 底部的 `bridge.on(...)` 调用中注册，以确保 Electron 模式下的事件能正确桥接到前端的 `emit`。

```typescript
// backend.ts
bridge.on("battery-changed", (payload) => emit("battery-changed", payload));
```

## 关键设计原则

1. **类型安全第一**：所有 IPC 方法的参数和返回值类型都在 `schema.ts` 中集中定义，前后端共享同一份类型
2. **参数永远具名对象**：即使只有一个参数也使用 `{ key: value }` 对象形式，方便未来扩展
3. **事件名 kebab-case**：事件名统一使用连字符风格（如 `session-update`、`fs-changed`）
4. **方法名 camelCase**：请求方法名统一使用小驼峰（如 `sendPrompt`、`getSettings`）
5. **所有 IPC 走统一通道**：不允许组件直接访问 `window.fello.invoke`，必须通过 `request` 封装
6. **带 fallback 的默认值**：前端 `t()` 调用始终提供默认值，确保 key 缺失时不崩溃

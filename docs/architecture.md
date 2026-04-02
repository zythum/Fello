# 架构设计

## 整体架构

```
┌─────────────────────────────────────────────────┐
│                   Electron App                  │
│                                                 │
│  ┌──────────────┐    IPC     ┌───────────────┐ │
│  │   Renderer    │◄────────►│ Main Process   │ │
│  │  (React SPA)  │           │   (Node.js)   │ │
│  └──────────────┘           └──────┬────────┘ │
│                                     │ stdio    │
│                              ┌──────▼────────┐ │
│                              │  kiro-cli acp │ │
│                              │ (ACP Server)  │ │
│                              └───────────────┘ │
└─────────────────────────────────────────────────┘
```

## 进程模型

- Main Process（`src/electron/`）：Electron 主进程，管理 ACP 连接、文件操作（含外部拖拽复制）、菜单、对话框与 session 元数据
- Renderer（`src/mainview/`）：React SPA，通过 preload 暴露的受限 IPC API 与主进程通信
- kiro-cli acp：单个 ACP server 进程，通过 stdin/stdout 的 NDJSON 流通信，管理所有 session

应用全局只启动一个 `kiro-cli acp` 进程（`ACPBridge` 单例），所有 session 的创建（`newSession`）、恢复（`loadSession`）、对话（`prompt`）均复用同一个 ACP 连接。`ACPBridge` 内部通过 `Map<sessionId, ModelState>` 维护各 session 的模型状态。

### 窗口生命周期（macOS）

采用标准 macOS 应用行为：关闭主窗口时进程不退出，应用继续驻留在 Dock。点击 Dock 图标时通过 Electron 的 `activate` 事件重新创建主窗口。通过 `window-all-closed` 分支保留 macOS 常驻行为。

## 通信链路

1. Renderer ←→ Main：Electron IPC（`ipcMain.handle` / `ipcRenderer.invoke`）+ preload `contextBridge`
2. Main ←→ kiro-cli：ACP SDK 的 `ClientSideConnection`，基于 NDJSON over stdio
3. 事件流：ACP session updates → Main 转发 → Renderer `backend.ts` 内置事件系统 → `processEvent` → Zustand store

## 数据流

```
ACP Event → onSessionUpdate → webContents.send() → backend.emit() → subscribe.on() → processEvent() → Zustand Store → React UI
```

恢复会话时，通过 ACP `loadSession` 重放历史，复用同一条 `onSessionUpdate` 链路还原 UI：

```
resetSessionState → resumeChat → loadSession → ACP server 重放 → onSessionUpdate × N → processEvent → Store → UI
```

### 持久化

会话历史完全由 ACP server 管理，客户端不存储事件日志。
本地仅通过 `storage.ts` 维护 session 元数据（`meta.json`），包含 id、title、cwd、创建/更新时间等。

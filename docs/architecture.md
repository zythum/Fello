# 架构设计

## 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Electrobun App                  │
│                                                  │
│  ┌──────────────┐    RPC     ┌────────────────┐ │
│  │   Webview     │◄────────►│   Bun Process   │ │
│  │  (React SPA)  │           │  (Main Process) │ │
│  └──────────────┘           └───────┬─────────┘ │
│                                      │ stdio     │
│                              ┌───────▼─────────┐ │
│                              │  kiro-cli acp   │ │
│                              │  (ACP Server)   │ │
│                              └─────────────────┘ │
└─────────────────────────────────────────────────┘
```

## 进程模型

- Bun Process（`src/bun/`）：主进程，管理 ACP 连接、文件操作、数据持久化
- Webview（`src/mainview/`）：渲染进程，React SPA，通过 Electrobun RPC 与主进程通信
- kiro-cli acp：单个 ACP server 进程，通过 stdin/stdout 的 NDJSON 流通信，管理所有 session

应用全局只启动一个 `kiro-cli acp` 进程（`ACPBridge` 单例），所有 session 的创建（`newSession`）、恢复（`loadSession`）、对话（`prompt`）均复用同一个 ACP 连接。`ACPBridge` 内部通过 `Map<sessionId, ModelState>` 维护各 session 的模型状态。

## 通信链路

1. Webview ←→ Bun：Electrobun 的 typed RPC（`BrowserView.defineRPC` / `Electroview.defineRPC`）
2. Bun ←→ kiro-cli：ACP SDK 的 `ClientSideConnection`，基于 NDJSON over stdio
3. 事件流：ACP session updates → Bun 转发 → Webview `backend.ts` 内置事件系统 → processEvent → Zustand store

## 数据流

```
ACP Event → onSessionUpdate → RPC → backend.emit() → subscribe.on() → processEvent() → Zustand Store → React UI
```

恢复会话时，通过 ACP `loadSession` 重放历史，复用同一条 `onSessionUpdate` 链路还原 UI：

```
resumeChat → loadSession → ACP server 重放 → onSessionUpdate × N → processEvent → Store → UI
```

### 持久化

会话历史完全由 ACP server 管理，客户端不存储事件日志。
本地仅通过 `storage.ts` 维护 session 元数据（`meta.json`），包含 id、title、cwd、创建/更新时间等。

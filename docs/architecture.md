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
- kiro-cli acp：外部 ACP server 进程，通过 stdin/stdout 的 NDJSON 流通信

## 通信链路

1. Webview ←→ Bun：Electrobun 的 typed RPC（`BrowserView.defineRPC` / `Electroview.defineRPC`）
2. Bun ←→ kiro-cli：ACP SDK 的 `ClientSideConnection`，基于 NDJSON over stdio
3. 事件流：ACP session updates → Bun 转发 → Webview CustomEvent → processEvent → Zustand store

## 数据流

```
ACP Event → onSessionUpdate → RPC → CustomEvent → processEvent() → Zustand Store → React UI
                                                        ↓
                                                   saveEvent() → JSONL 持久化
```

恢复会话时反向：

```
JSONL → getEvents() → replayEvents() → processEvent() × N → flushStreaming() → Store → UI
```

`processEvent` 是唯一的事件处理函数，实时流和历史回放共用，保证行为一致。

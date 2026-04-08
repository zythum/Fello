# 架构设计

## 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Electron Desktop App                      │
│                                                                      │
│  ┌─────────────────────────────┐          ┌───────────────────────┐ │
│  │ Renderer (React + Vite)     │  IPC     │ Main Process (Node.js)│ │
│  │ - Sidebar / Chat / FilePanel│ ◄──────► │ - IPC handlers         │ │
│  │ - TerminalPanel (xterm.js)  │          │ - ACPBridge lifecycle  │ │
│  │ - Zustand session store     │          │ - FS / Dialog / Menu   │ │
│  └─────────────────────────────┘          │ - WebUI Server (ws)    │ │
│                 ▲                         └───────────┬───────────┘ │
│                 │ WebSocket (WebUI Mode)              │ NDJSON over │
│  ┌──────────────▼──────────────┐                      │ stdio       │
│  │ Remote Browser (WebUI)      │            ┌─────────▼───────────┐ │
│  │ - App.tsx / backend.ts      │            │ kiro-cli acp        │ │
│  └─────────────────────────────┘            │ (ACP Server process)│ │
│                                             └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

## 进程与模块职责

### Main Process（`src/electron/` & `src/backend/`）

- **`src/electron/main.ts`**：窗口创建、应用菜单、Electron 原生 IPC 注册、系统对话框
- **`src/electron/preload.ts`**：通过 `contextBridge` 暴露类型安全的 `window.fello.invoke/on/off`
- **`src/backend/backend.ts`**：核心后端业务逻辑、文件系统能力、终端 PTY 管理、WebUI WebSocket 服务端
- **`src/backend/acp-bridge.ts`**：`kiro-cli acp` 子进程生命周期与 ACP SDK 连接封装
- **`src/backend/ipc-schema.ts`**：主进程与渲染进程请求/事件的统一契约
- **`src/backend/storage.ts`**：持久化管理，包括 `~/.fello/settings.json`（全局配置）、`~/.fello/projects/` 下的项目与会话元数据（详见 [数据存储设计与结构](./storage.md)）

### Renderer（`src/mainview/`）

- `App.tsx`：全局事件订阅、MessageProvider (全局对话框与 Toast 队列管理)、主布局
- `store.ts`：Zustand 全局 store，按 session 维护聊天状态与 UI 状态
- `lib/process-event.ts`：ACP 事件归一处理（消息、tool、usage）+ 流式收尾
- `backend.ts`：IPC 客户端封装，支持在 Electron 环境下使用 `bridge.invoke`，在 WebUI 环境下通过 WebSocket 连接到主进程
- 组件层：
  - `sidebar.tsx`：项目分组会话列表、会话切换、项目/会话重命名与删除
  - `chat.tsx`：聊天区容器 + 权限对话框
  - `file-panel.tsx`：文件树、重命名、拖拽移动、外部文件夹导入
  - `terminal-panel.tsx`：多终端标签、输出订阅、窗口 resize 自适配

### ACP Server（`kiro-cli acp`）

- 通过标准输入输出与客户端进行 NDJSON RPC 通信
- 管理会话历史与重放，客户端依赖 `loadSession` 恢复完整上下文

## 核心设计决策

### 1) 单 Bridge、单 ACP 进程复用

应用全局只维护一个 `ACPBridge` 实例。所有会话操作都复用同一连接：

- 新建会话：`newSession`
- 恢复会话：`loadSession`
- 发送消息：`prompt`
- 取消生成：`cancel`

`ACPBridge` 通过 `Map<sessionId, SessionModelState>` 与 `Map<sessionId, SessionModeState>` 维护模型与模式状态缓存，避免会话切换时反复拉取。

### 2) 事件驱动的 UI 渲染

所有 ACP 增量事件统一经过同一链路进入 Zustand，再由 React 渲染：

```
ACP sessionUpdate
  → main.safeSend("session-update")
  → renderer/backend.emit()
  → processEvent(sessionId, update)
  → useAppStore(sessionStates)
  → ChatArea / Bubble 组件更新
```

这种设计保证了实时流式更新与历史重放的处理逻辑一致。

### 3) 会话隔离与全局状态

`store.ts` 使用 `Map<sessionId, SessionState>` 管理每个会话隔离的：

- messages
- usage token 统计
- permission 请求队列
- activeToolCalls
- isStreaming

全局共享状态则直接挂载于 store 根层级：

- `configuredAgents`：用户在设置中自定义的可用 Agent 及启动命令
- `theme`：UI 主题配置（深色、浅色、跟随系统）
- `language`：应用语言配置（英语、简体中文）
- `availableModels` / `currentModelId`：当前连接环境可用的模型及所选模型
- `availableModes` / `currentModeId`：当前连接环境可用的模式及所选模式

切换会话时只切换 `activeSessionId`，避免跨会话状态污染，同时全局状态会自动同步为当前会话的模型与模式。

### 4) 主进程统一托管系统能力

敏感或系统相关能力全部由主进程执行：

- 文件树读取、创建、删除、重命名、移动
- 系统对话框（选择目录）
- 原生右键菜单
- Finder 定位
- PTY 终端创建/输入/销毁/resize

渲染层只发起受限 RPC，不直接接触 Node API。

## 关键数据流

### A. 新建会话

```
Renderer: addProject(pickWorkDir)
  → Main: storage.addProject(project.json)
  → Renderer: 在项目下触发 newSession
  → Main: ensureBridge(cwd)
  → ACP: newSession
  → Main: storage.createSession(session.json)
  → Renderer: 刷新 sessions + 进入 active session
```

### B. 恢复会话

```
Renderer: resetSessionState(sessionId)
  → Main: resumeChat(sessionId, cwd)
  → ACP: loadSession (服务端重放历史)
  → session-update 持续推送
  → processEvent 重建消息/工具/usage 状态
```

### C. 发送消息（流式）

```
ChatInput submit
  → 立即写入本地 user message + isStreaming=true
  → Main: sendMessage
  → ACP: prompt
  → session-update chunk 持续到达
  → processEvent appendToLastMessage / updateToolCall
  → flushStreaming 收尾，结束 streaming 状态
```

### D. 权限请求

```
ACP requestPermission
  → Main: pendingPermissions.set(toolCallId, resolver)
  → Renderer: 显示 PermissionDialog
  → 用户选择 optionId
  → Main: resolve pending permission
  → ACP 继续执行 tool
```

### E. 终端输出链路

```
Renderer: createTerminal(sessionId, cwd)
  → Main: node-pty spawn shell
  → Main event: terminal-output / terminal-exit
  → Renderer subscribe 更新 xterm 实例
  → 用户输入 onData → writeTerminal 回传 PTY
```

## 生命周期与退出策略

- 启动：`app.whenReady()` 后设置菜单、Dock 图标、创建主窗口
- 开发模式：附加 renderer console 与 did-fail-load 诊断日志
- macOS 行为：关闭窗口不退出进程，`activate` 时重建窗口
- 退出：`before-quit` 同步清理 ACP 进程组与所有 PTY 终端

## 持久化边界

- 客户端本地保存项目元数据与会话元数据
- 聊天历史与事件日志不落盘，由 ACP 服务端负责持有与重放
- 删除项目时删除对应 `~/.fello/projects/<project-id>/` 目录（包含其所有会话）

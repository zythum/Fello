# 编码规范

## 格式化

- 缩进：2 空格，无 Tab
- 格式化工具：oxfmt
- 运行格式化：`npm run format`

## 文件命名

- 组件文件：kebab-case（`chat-input.tsx`、`file-tree.tsx`）
- shadcn 组件：保持 shadcn CLI 生成的原始命名
- 工具函数：kebab-case（`process-event.ts`、`utils.ts`）
- Electron 侧模块：kebab-case（`acp-bridge.ts`、`ipc-schema.ts`）

## 组件规范

- 函数组件，named export
- 状态管理统一使用 Zustand store（`useAppStore`）
- 样式使用 shadcn 语义化 CSS 变量（`bg-background`、`text-foreground`、`border-border` 等）
- 图标使用 Lucide React
- 组件变体使用 class-variance-authority（CVA）
- 优先使用 shadcn 组件，避免手写可被 shadcn 组件替代的 UI 元素，以减少样式问题并保持视觉统一

## 事件处理

- ACP 事件统一通过 `processEvent()` 处理（`src/mainview/lib/process-event.ts`）
- 实时流和历史回放共用同一个处理函数，保证行为一致
- 恢复会话前需先清空对应 session 的本地状态，避免 `loadSession` 回放历史时与旧消息叠加

## IPC 通信

- 类型定义在 `src/electron/ipc-schema.ts`（`FelloIPCSchema`）
- Main 侧：`ipcMain.handle(...)`
- Renderer 侧：`window.fello.invoke(...)` + `backend.ts` 封装
- 事件推送：`webContents.send(...)` → `window.fello.on(...)`

## ACP Bridge

- 应用全局复用单个 `ACPBridge` 实例
- 模型状态按 session 维度存储在 `Map<sessionId, SessionModelState>`
- 切换 session 不重建 ACP server，恢复会话时复用同一连接
- 应用退出时对 bridge 执行 disconnect / killSync
- JSON-RPC 通信日志：`[ACP ←]`（收到）/ `[ACP →]`（发送）

## UI 语言

- App UI 中所有面向用户的文字必须使用英语

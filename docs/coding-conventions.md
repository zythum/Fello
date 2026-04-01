# 编码规范

## 格式化

- 缩进：2 空格，无 Tab
- 格式化工具：Prettier
- shadcn 生成的 `ui/` 目录不参与 Prettier 格式化（`.prettierignore`）
- 运行格式化：`bun run format`

## 文件命名

- 组件文件：kebab-case（`chat-input.tsx`、`file-tree.tsx`）
- shadcn 组件：保持 shadcn CLI 生成的原始命名
- 工具函数：kebab-case（`process-event.ts`、`utils.ts`）
- Bun 侧模块：kebab-case（`acp-bridge.ts`、`rpc-schema.ts`）

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
- 事件持久化直接存储 ACP 原始结构（过滤 `rawOutput`）

## RPC 通信

- 类型定义在 `src/bun/rpc-schema.ts`（`FelloRPCSchema`）
- Bun 侧：`BrowserView.defineRPC<FelloRPCSchema>()`
- Webview 侧：`Electroview.defineRPC<FelloRPCSchema>()`
- 超时设置：`Infinity`（ACP 操作时间不可预测）

## ACP Bridge

- 每个 session 独立的 `ACPBridge` 实例，存储在 `Map<sessionId, ACPBridge>`
- 切换 session 不断开旧连接
- 应用退出时遍历所有 bridge 执行 disconnect
- JSON-RPC 通信日志：`[ACP ←]`（收到）/ `[ACP →]`（发送）

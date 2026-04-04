# 编码规范

## 基础格式

- 缩进统一 2 空格，禁止 Tab
- 使用 `oxfmt` 进行格式化，命令：`npm run format`
- 提交前至少通过 `npm run lint` 与 `npm run typecheck`

## 命名与文件组织

- 文件名统一 kebab-case（如 `chat-input.tsx`、`acp-bridge.ts`）
- React 组件文件以功能命名，按页面结构放入 `components/`
- 消息气泡按角色拆分到 `components/bubbles/`
- UI primitives 保持 `components/ui/`，避免跨目录重复实现

## React 组件约定

- 优先使用函数组件与具名导出
- 组件职责保持单一：容器组件负责数据流，展示组件负责渲染
- 复杂交互使用 `useCallback`/`useMemo`/`useRef` 控制重渲染与副作用
- 涉及订阅（事件、监听器）必须在 `useEffect` 中成对注册/清理

## 状态管理约定（Zustand）

- 全局状态统一走 `useAppStore`
- 与会话相关的状态必须按 `sessionId` 隔离在 `sessionStates` 中
- 不在组件中散落维护重复业务状态，优先通过 store mutator 更新
- 流式消息结束时统一调用 `flushStreaming` 收尾，保证消息状态一致

## 事件处理约定（ACP）

- ACP 更新事件统一进入 `processEvent(sessionId, event)`
- 历史回放与实时流式共用同一处理逻辑，避免行为分叉
- 切换/恢复会话前先 `resetSessionState`，避免历史与旧状态混叠
- tool call 状态更新必须同时同步到 `activeToolCalls` 与 `messages`

## IPC 约定

- 所有主渲染请求/事件类型定义集中在 `src/electron/ipc-schema.ts`
- 主进程通过 `ipcMain.handle` 提供请求式 API
- 渲染层只通过 `window.fello.invoke/on/off` 与主进程交互
- 渲染业务组件应使用 `backend.ts` 的 `request/subscribe`，不直接触达 `window.fello`

## Electron 与系统能力边界

- 文件系统、终端、系统对话框、原生菜单必须在主进程执行
- 渲染进程禁止直接访问 Node 能力，依赖 preload 暴露的受限 API
- 退出流程需要清理 ACP 子进程与 PTY，避免僵尸进程

## UI 与样式约定

- 优先复用现有 shadcn/base-ui 组件，不重复造轮子
- 统一使用语义化 token 类名（如 `bg-background`、`text-foreground`）
- 图标统一使用 `lucide-react`
- 所有用户可见文本必须支持多语言（使用 `react-i18next` 的 `t()` 函数），并且在 `locales/` 目录下维护对应的翻译文件。默认语言环境提供英文（`en.json`）和简体中文（`zh-CN.json`）。

## 错误处理约定

- 异常信息尽量标准化为可读 message，再反馈给 UI
- 关键异步流程应有 `try/catch/finally`，避免 loading 状态悬挂
- 面向用户的错误优先进入全局错误队列或系统消息，不静默吞错

# 编码规范

## 基础格式

- 缩进统一 2 空格，禁止 Tab
- 使用 `oxfmt` 进行格式化，命令：`npm run format`
- 提交前至少通过 `npm run lint` 与 `npm run typecheck`

## 命名与文件组织

- 文件名统一 kebab-case（如 `chat-input.tsx`、`acp-bridge.ts`）
- React 组件文件以功能命名，按页面结构放入 `components/` 对应的模块目录下（如 `session/`、`session/chat/`、`settings/` 等）
- 消息气泡按角色拆分到 `components/session/chat/bubbles/`
- 多模态消息内容块按类型拆分到 `components/content-blocks/`
- UI primitives 保持 `components/ui/`，避免跨目录重复实现

## TypeScript 约定

- 优先使用 `unknown` 而非 `any`，强制在使用前进行类型检查
- 优先使用 `satisfies` 操作符而非类型断言（`as`），以保留精确的类型推导并确保类型兼容性
- 避免过度使用类型断言，尽量让 TS 自动推导类型

## React 组件约定

- 优先使用函数组件与具名导出
- 组件职责保持单一：容器组件负责数据流，展示组件负责渲染
- 复杂交互使用 `useCallback`/`useMemo`/`useRef` 控制重渲染与副作用
- 涉及订阅（事件、监听器）必须在 `useEffect` 中成对注册/清理

## 状态管理约定（Zustand）

- 全局状态统一走 `useAppStore`
- 与会话相关的状态必须按 `sessionId` 隔离在 `sessionStates` 中
- 不在组件中散落维护重复业务状态，优先通过 store mutator 更新
- 流式消息结束时统一调用 `reduceFlushStreaming` 收尾，保证消息状态一致

## 事件处理约定（ACP）

- **协议遵循**：所有功能开发必须遵循 ACP（Agent Client Protocol）协议规范（基于 `@agentclientprotocol/sdk`）。如果发现功能需求与 ACP 协议冲突，必须提出质疑并进行讨论，禁止强行绕过或违背协议。
- **ID 映射规范**：与底层 ACP 服务（Agent 进程）交互时，必须使用 `session.resumeId` 而非 `session.id`。由于 ACP 接口声明中常将参数命名为 `sessionId`，极易与 Fello 自身的 `session.id` 混淆。牢记规则：**ACP 侧的 `sessionId` === Fello 侧的 `session.resumeId`**。
- ACP 更新事件统一进入 `reduceSessionUpdate(currentState, update)`，主进程在接收到这些事件时，会先通过 `appendSessionMessage` 持久化到 `messages.jsonl` 文件。
- 历史回放由 Fello 主进程直接读取本地日志驱动，不再依赖服务端提供历史，回放和实时流式事件共用同一 Reducer 处理逻辑，避免行为分叉。
- 切换/恢复会话前先 `resetSessionState`，避免历史与旧状态混叠
- tool call 状态更新必须同时同步到 `activeToolCalls` 与 `messages`

## IPC 约定

- 所有主渲染请求/事件类型定义集中在 `src/shared/schema.ts`
- 路径处理：为了保证跨平台（特别是 Windows）的一致性，除 `getSystemFilePath` 接口专门用于返回操作系统原生路径格式外，其他所有 IPC 接口的输入和输出（如 `searchFiles`, `readDir`, `fs-changed` 等）涉及的项目内相对路径，均必须统一使用 POSIX 风格路径（即正斜杠 `/` 分隔）。
- 主进程通过 `ipcMain.handle` 注册由 `src/backend` 提供的请求式 API
- 渲染层只通过 `window.fello.invoke/on/off` 与主进程交互
- 渲染业务组件应使用 `src/mainview/backend.ts` 的 `request/subscribe`，不直接触达 `window.fello`

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
- 全局未捕获组件渲染异常统一由 `ErrorBoundary` 组件拦截并提供用户友好的反馈界面
- 面向用户的提示与交互（Alert/Confirm/Prompt/Toast）必须统一通过 `useMessage` Hook 调起，避免直接使用原生或散落的 Dialog 组件
- 关键异步流程应有 `try/catch/finally`，避免 loading 状态悬挂
- 面向用户的错误优先通过 `useMessage` 的 `toast.error` 等方式提示，不静默吞错

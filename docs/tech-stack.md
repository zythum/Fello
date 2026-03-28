# 技术选型

## 运行时与框架

| 层级     | 技术            | 说明                                   |
| -------- | --------------- | -------------------------------------- |
| 运行时   | Bun             | 替代 Node.js，内置 SQLite、更快的启动  |
| 桌面框架 | Electrobun 1.16 | 基于 Bun 的桌面应用框架，类似 Electron |
| 前端框架 | React 19        | UI 渲染                                |
| 构建工具 | Vite 8          | HMR 开发、生产构建                     |

## UI 与样式

| 技术                     | 说明                                    |
| ------------------------ | --------------------------------------- |
| Tailwind CSS 4           | 原子化 CSS，`@import "tailwindcss"`     |
| shadcn/ui (Base UI)      | 组件库，基于 `@base-ui/react`，非 Radix |
| Lucide React             | 图标库                                  |
| class-variance-authority | 组件变体管理                            |
| tailwind-merge + clsx    | 类名合并工具（`cn()` 函数）             |

## 状态管理

| 技术    | 说明                     |
| ------- | ------------------------ |
| Zustand | 轻量状态管理，单一 store |

## ACP 通信

| 技术                     | 说明                 |
| ------------------------ | -------------------- |
| @agentclientprotocol/sdk | ACP 客户端 SDK       |
| NDJSON over stdio        | 与 kiro-cli 的传输层 |

## 数据持久化

| 技术       | 说明                               |
| ---------- | ---------------------------------- |
| JSONL 文件 | 事件日志，与 ACP 协议结构一致      |
| JSON 文件  | 会话元数据（meta.json）            |
| 存储位置   | `~/.cowork/sessions/<session-id>/` |

## Markdown 渲染

| 技术             | 说明               |
| ---------------- | ------------------ |
| Streamdown       | 流式 Markdown 渲染 |
| @streamdown/code | 代码块高亮插件     |

## 代码质量

| 技术       | 说明                   |
| ---------- | ---------------------- |
| TypeScript | 全量类型检查           |
| Prettier   | 代码格式化，2 空格缩进 |

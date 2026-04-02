# 技术选型

## 运行时与框架

| 层级     | 技术            | 说明                                   |
| -------- | --------------- | -------------------------------------- |
| 运行时   | Node.js         | Electron 主进程运行时                  |
| 桌面框架 | Electron 37     | 桌面应用容器                           |
| 前端框架 | React 19        | UI 渲染                                |
| 构建工具 | electron-vite 5 | 统一构建 main、preload、renderer       |
| Renderer | Vite 7          | HMR 开发、生产构建                     |

## UI 与样式

| 技术                     | 说明                                    |
| ------------------------ | --------------------------------------- |
| Tailwind CSS 4           | 原子化 CSS，`@import "tailwindcss"`     |
| shadcn/ui (Base UI)      | 组件库，基于 `@base-ui/react`，非 Radix |
| react-resizable-panels   | 可拖拽调整宽度的分栏面板                |
| react-mentions           | 输入框 mention 支持，用于文件/文件夹引用 |
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
| JSON 文件  | 会话元数据（meta.json）            |
| ACP 重放   | 历史事件由 ACP server 重放恢复     |
| 存储位置   | `~/.fello/sessions/<session-id>/` |

## Markdown 渲染

| 技术             | 说明               |
| ---------------- | ------------------ |
| Streamdown       | 流式 Markdown 渲染 |
| @streamdown/code | 代码块高亮插件     |

## 代码质量

| 技术       | 说明                   |
| ---------- | ---------------------- |
| TypeScript | 全量类型检查           |
| oxfmt      | 代码格式化             |
| oxlint     | 静态检查               |

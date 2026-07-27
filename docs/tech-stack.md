# 技术选型

## 运行时与应用框架

| 层级 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 桌面容器 | Electron | ^37.2.0 | 承载桌面窗口、菜单、系统能力调用 |
| 主进程运行时 | Node.js | 跟随 Electron | 执行 Agent、FS、PTY、IPC handlers |
| 前端框架 | React / React DOM | ^19.2.7 | Renderer UI 构建 |
| 构建工具 | electron-vite | ^5.0.0 | 一体化构建 main/preload/renderer |
| Renderer Bundler | Vite | ^7.1.9 | 开发 HMR 与生产构建 |
| 语言 | TypeScript | ^5.9.3 | 主渲染全链路类型系统 |

## AI / LLM 集成

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| @agentclientprotocol/sdk | ^1.2.1 | ACP 客户端 SDK，负责 Agent 通信协议 |
| @ai-sdk/openai-compatible | ^3.0.12 | OpenAI 兼容 API 客户端（Vercel AI SDK） |
| ai | ^7.0.31 | Vercel AI SDK，streamText/generateText 驱动 API Agent |
| @modelcontextprotocol/sdk | ^1.29.0 | MCP SDK，负责与 Model Context Protocol 服务通信 |
| @ai-sdk/mcp | ^2.0.15 | AI SDK MCP 集成，将 MCP 工具转换为 AI SDK tools |

## 协议与进程通信

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| NDJSON over stdio | - | 主进程与 Stdio Agent 的传输层 |
| NDJSON over Streams | - | 主进程与 API Agent（进程内）的传输层 |
| Electron IPC | 内置 | `ipcMain.handle` + `ipcRenderer.invoke` 请求响应 |
| contextBridge | 内置 | preload 暴露受限 API，隔离渲染层权限 |
| WebSocket | 内置 | WebUI 远程访问时的 IPC 降级传输层 |

## UI 与交互层

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| Tailwind CSS | ^4.3.3 | 原子化样式体系 |
| react-router-dom | ^7.18.1 | 客户端路由控制 (HashRouter) |
| @base-ui/react | ^1.6.0 | 基础无样式交互 primitives（shadcn 基座） |
| shadcn | ^4.13.1 | 项目内 UI 基础组件生成与组合 |
| Lucide React | ^1.25.0 | 图标系统 |
| i18next + react-i18next | ^26.3.6 / ^17.0.10 | 前端多语言 (i18n) 解决方案 |
| react-resizable-panels | ^4.12.2 | 主视图左右分栏可拖拽布局 |
| react-mentions | ^4.4.10 | 输入框文件提及（`#` 触发） |
| @dnd-kit/core + sortable | ^6.3.1 / ^10.0.0 | 文件树拖拽排序 |
| class-variance-authority | ^0.7.1 | 组件变体管理 |
| clsx + tailwind-merge | ^2.1.1 / ^3.6.0 | className 拼接与冲突消解 |
| tw-animate-css | ^1.4.0 | 动画样式工具 |
| sonner | ^2.0.7 | Toast 消息提示组件 |
| next-themes | ^0.4.6 | 主题切换与感知 |

## 终端与开发工作区能力

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| node-pty | ^1.1.0 | 主进程 PTY 创建、输入输出、resize |
| @xterm/xterm | ^6.0.0 | Renderer 终端渲染 |
| @xterm/addon-fit | ^0.11.0 | xterm 自适应容器尺寸 |
| @xterm/addon-web-links | ^0.12.0 | xterm 链接识别 |
| @parcel/watcher | ^2.6.0 | 文件系统监控 |
| Fuse.js | ^7.5.0 | 文件提及模糊搜索（`searchFiles`） |

## 状态管理与数据组织

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| Zustand | ^5.0.14 | 全局 store，按 session 分桶维护消息/usage/tool 状态 |
| JSON 文件持久化 | - | 本地保存会话元数据与历史（NDJSON） |
| ACP session replay | - | 历史事件可由本地文件或 Agent 服务端重放恢复 |
| es-toolkit | ^1.49.0 | 通用工具函数库 |
| zod | ^4.4.3 | 运行时类型校验 |

## Markdown 与代码展示

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| streamdown | ^2.5.0 | 流式 Markdown 渲染 |
| @streamdown/code | ^1.1.1 | 代码高亮扩展 |
| @streamdown/cjk | ^1.0.3 | CJK 中日韩字符优化扩展 |
| @streamdown/math | ^1.0.2 | 数学公式扩展 |
| @streamdown/mermaid | ^1.0.2 | Mermaid 图表扩展 |
| @pierre/diffs | ^1.2.12 | 代码 Diff 双栏/单栏对比视图 + 代码高亮（内置 shiki） |
| remark-breaks | ^4.0.0 | Markdown 换行支持 |

## 文档预览

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| @silurus/ooxml | ^0.72.2 | Office 文档预览（DOCX/PPTX/XLSX）统一渲染库 |
| pdfjs-dist | ^6.1.200 | PDF 文档预览渲染 |

## 工程质量与规范执行

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| oxlint | ^1.74.0 | 静态检查 |
| oxfmt | ^0.59.0 | 代码格式化 |
| TypeScript tsc | ^5.9.3 | 双配置类型检查（renderer + node） |
| electron-builder | ^26.0.12 | 应用打包与分发 |
| electron-updater | ^6.8.9 | 自动更新支持 |
| mime-types | ^3.0.2 | MIME 类型检测 |
| yaml | ^2.9.0 | YAML 解析 |

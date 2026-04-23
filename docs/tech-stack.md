# 技术选型

## 运行时与应用框架

| 层级 | 技术 | 版本 | 说明 |
| --- | --- | --- | --- |
| 桌面容器 | Electron | ^37.2.0 | 承载桌面窗口、菜单、系统能力调用 |
| 主进程运行时 | Node.js | 跟随 Electron | 执行 ACP、FS、PTY、IPC handlers |
| 前端框架 | React / React DOM | ^19.2.5 | Renderer UI 构建 |
| 构建工具 | electron-vite | ^5.0.0 | 一体化构建 main/preload/renderer |
| Renderer Bundler | Vite | ^7.1.9 | 开发 HMR 与生产构建 |
| 语言 | TypeScript | ^5.9.3 | 主渲染全链路类型系统 |

## 协议与进程通信

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| @agentclientprotocol/sdk | ^0.19.0 | ACP 客户端 SDK，负责 initialize/newSession/loadSession/prompt |
| @modelcontextprotocol/sdk | ^1.29.0 | MCP SDK，负责与 Model Context Protocol 服务通信 |
| NDJSON over stdio | - | 主进程与 `kiro-cli acp` 的传输层 |
| Electron IPC | 内置 | `ipcMain.handle` + `ipcRenderer.invoke` 请求响应 |
| contextBridge | 内置 | preload 暴露受限 API，隔离渲染层权限 |
| WebSocket | 内置 | WebUI 远程访问时的 IPC 降级传输层 |

## UI 与交互层

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| Tailwind CSS | ^4.2.2 | 原子化样式体系 |
| react-router-dom | ^7.14.1 | 客户端路由控制 (HashRouter) |
| @base-ui/react | ^1.4.0 | 基础无样式交互 primitives（shadcn 基座） |
| shadcn | ^4.1.2 | 项目内 UI 基础组件生成与组合 |
| Lucide React | ^1.8.0 | 图标系统 |
| i18next + react-i18next | - | 前端多语言 (i18n) 解决方案 |
| react-resizable-panels | ^4.10.0 | 主视图左右分栏可拖拽布局 |
| react-mentions | ^4.4.10 | 输入框文件提及（`#` 触发） |
| class-variance-authority | ^0.7.1 | 组件变体管理 |
| clsx + tailwind-merge | ^2.1.1 / ^3.5.0 | className 拼接与冲突消解 |
| tw-animate-css | ^1.4.0 | 动画样式工具 |
| sonner | ^2.0.1 | Toast 消息提示组件 |
| next-themes | ^0.4.4 | 主题切换与感知 |

## 终端与开发工作区能力

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| node-pty | ^1.1.0 | 主进程 PTY 创建、输入输出、resize |
| @xterm/xterm | ^6.0.0 | Renderer 终端渲染 |
| @xterm/addon-fit | ^0.11.0 | xterm 自适应容器尺寸 |
| Fuse.js | ^7.1.0 | 文件提及模糊搜索（`searchFiles`） |

## 状态管理与数据组织

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| Zustand | ^5.0.12 | 全局 store，按 session 分桶维护消息/usage/tool 状态 |
| JSON 文件持久化 | - | 本地仅保存 session 元数据（meta.json） |
| ACP session replay | - | 历史事件由 ACP 服务端重放恢复 |

## Markdown 与代码展示

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| streamdown | ^2.5.0 | 流式 Markdown 渲染 |
| @streamdown/code | ^1.1.1 | 代码高亮扩展 |
| @streamdown/cjk | ^1.0.3 | CJK 中日韩字符优化扩展 |
| @streamdown/math | ^1.0.2 | 数学公式扩展 |
| @streamdown/mermaid | ^1.0.2 | Mermaid 图表扩展 |
| react-diff-viewer-continued | ^4.2.0 | 代码 Diff 双栏/单栏对比视图 |
| shiki | ^1.0.0 | 代码高亮底层引擎，通过 `shiki-highlighter.ts` 统一管理 |

## 工程质量与规范执行

| 技术 | 版本 | 说明 |
| --- | --- | --- |
| oxlint | ^1.60.0 | 静态检查 |
| oxfmt | ^0.45.0 | 代码格式化 |
| TypeScript tsc | ^5.9.3 | 双配置类型检查（renderer + node） |

# Fello 项目简介

Fello 是一个基于 ACP（Agent Client Protocol）的桌面 AI 协作客户端。它以 Electron 作为桌面容器，支持两种类型的 Agent 连接：本地 Stdio 命令行 Agent（通过 ACP 协议，如 `kiro-cli acp`）和远程 OpenAI 兼容 API Agent。在一个应用内整合了对话、工具调用、权限决策、文件树、终端面板、Skills 管理以及微信 iLink 移动端交互。

## 产品定位

- 面向本地开发工作流的桌面端 AI 协作工具
- 强调"会话上下文 + 工作目录 + 文件/终端联动"
- 使用 ACP 作为统一协议层，兼容 agent 的流式事件与权限模型
- 支持远程 API Agent（OpenAI 兼容），扩展 LLM 选择范围

## 功能清单

### Agent 类型

- **Stdio Agent**：通过本地命令行进程启动（如 `kiro-cli acp`），使用 ACP SDK 通过 NDJSON stdio 通信
- **API Agent**：通过 HTTP 连接 OpenAI 兼容 API（如任何兼容 `/v1/chat/completions` 的服务），在进程内运行，支持流式文本、推理和文件内容。可配置 `contextWindowTokens` 指定上下文窗口大小（默认 128K），用于用量展示

### 会话与连接

- 项目分组：以工作目录为项目，项目下管理多个 chat session
- 新建会话：在项目下创建新 session，支持选择 Agent 类型、MCP Server 和权限模式
- 恢复会话：从侧边栏会话列表恢复，ACP 服务端重放历史事件
- 重命名/删除：支持项目与会话的重命名、删除操作
- 连接状态：切换会话时显示连接中状态，异常信息通过 Toast 提示
- 会话时间戳：在侧边栏和聊天标题处显示会话的最后更新时间
- 自动标题生成：API Agent 会话首次发送消息时自动生成简短的会话标题

### 对话体验

- 流式渲染：实时显示 assistant chunk 与 thinking/reasoning chunk
- 工具调用可视化：在消息流中插入 tool 状态与结果
- Plan 展示：支持显示 Agent 生成的执行计划气泡
- 文件路径交互：在用户和助手消息中自动解析绝对文件路径，点击可直接在 Finder 中定位打开
- 中断能力：支持手动 `cancelPrompt`
- 超时兜底：30 秒无事件时自动结束 streaming 并注入系统提示
- 全局交互：提供统一的文本右键上下文菜单，支持剪切、复制、粘贴和全选操作
- Token 用量追踪：每轮对话结束时在输入区上方展示该轮 token 用量（输入/输出/总计/思考/缓存），并在会话头部以进度条直观显示上下文窗口占用比例

### 权限交互

- 当 agent 请求权限时弹出 `Permission Required` 对话框
- 选项由 agent 下发，前端直接回传 `optionId`
- 支持"始终允许"（Always Allow）：用户可将某类工具权限记忆化，后续同类请求自动批准，持久化到会话状态中
- 会话内支持权限请求队列，逐个处理
- 权限模式切换：支持 `ask`（每次询问）和 `allow-all`（全部允许）两种模式

### 文件工作区

- 文件树浏览（分层加载 + 目录优先排序），位于右侧面板的 **Files** 标签页
- 新建文件/文件夹、重命名、删除（回收站或永久删除）
- 支持内部拖拽移动与多选批量移动
- 支持外部文件/文件夹拖入并落盘
- 支持原生右键菜单与 Finder 定位
- 文件内容预览（支持图片渲染、Markdown 富文本渲染、代码高亮渲染与双栏 Diff 对比），在右侧面板中点击文件后以详情视图呈现
- 文件详情视图支持关闭按钮，与聊天区域同处左侧弹性布局
- 文件外部修改检测：通过文件系统监听（@parcel/watcher）实时检测已打开文件的外部变更，在右上角浮动显示蓝色提示条并附带一键刷新按钮

### 终端能力

- 位于右侧面板的 **Terminal** 标签页，以垂直列表展示所有终端
- 每个项目可创建多个终端，支持在列表中创建、切换和关闭
- 选中终端后以终端详情视图展示（全尺寸 xterm.js），支持窗口 resize 自动适配
- 基于 `node-pty` + `xterm`，支持实时输入输出
- 支持由 Agent 发起的独立终端任务执行与输出捕获
- 支持终端日志持久化，会话休眠或恢复时自动保存与读取输出记录
- 支持终端 resize 与进程退出状态反馈
- 会话删除或应用退出时自动清理终端资源

### 会话界面布局

- 采用三栏 `ResizablePanelGroup` 可拖拽弹性结构：
  - **左栏（弹性）**：聊天区域（含会话头部），可内嵌详情视图（文件预览或终端详情）
  - **右栏（固定像素）**：带标签的面板，在 Files 和 Terminal 标签页之间切换
- 左侧聊天区域与详情视图共享一组内嵌 ResizablePanel，支持拖拽调节宽度
- 当窗口宽度小于 1000px 且详情视图打开时，自动隐藏聊天区域以节省空间
- 会话头部（ChatHeader）已提取为独立组件，包含 Agent Badge、会话标题、项目路径、时间戳、MCP 服务器切换、刷新菜单和用量按钮（UsageButton，展示上下文窗口进度条和上轮 Token 明细）

### 模型、模式与扩展

- 动态配置 Agent：支持在应用设置中添加、修改、删除多个 Agent（Stdio 或 API 类型），使用 ID 作为唯一标识。API Agent 支持配置 `contextWindowTokens`（上下文窗口大小），保存设置时自动校验为正整数
- MCP 服务器：支持在设置中配置 Model Context Protocol (MCP) 服务器（Stdio 和 HTTP 两种类型），并在会话菜单中随时启停，为 Agent 动态扩展能力
- Skills 系统：浏览和安装来自 skills.sh 市场的 Skills，支持用户级和项目级作用域（fello/agents/claude 三个 scope）
- 动态配置界面与交互：支持在应用设置中修改全局主题（Theme）和语言（Language）
- Snippets：支持在设置中管理自定义文本片段（Snippets），可在聊天输入中快速引用
- 从 Agent 读取可用模型列表，这些配置被持久化并隔离在每个独立会话（Session）的元数据中，切换会话时 UI 无缝更新
- 支持在下拉菜单中显示模型信息
- 支持在会话运行中随时切换模型，并通过 `session-changed` 事件进行细粒度的原子级 UI 更新
- 在输入区显示 token 统计（input/output/total/think）

### WebUI 远程访问

- 在设置中可开启 WebUI 服务，支持自定义端口和 Token
- 允许在局域网内的浏览器中远程访问和使用 Fello 的完整功能
- 远程环境通过 WebSocket 与桌面端的主进程进行 IPC 交互
- Web 端支持所有桌面端功能，包括文件操作、终端交互、新建项目和会话

### 微信 iLink 集成

- 在设置中配置微信 iLink 连接，通过扫码登录
- 支持在微信中接收消息并自动转发到 Fello，可设置活跃会话进行回复
- 消息支持长文本自动分段发送（微信 2000 字符限制）
- 支持"正在输入"状态指示
- 登录凭证和游标状态持久化存储

## 用户交互流程（简版）

1. 点击 Add Project，选择工作目录
2. 在项目下点击 New Chat，选择 Agent 类型并创建 session，建立连接
3. 输入消息，接收流式响应/工具事件
4. 如遇权限请求，在弹窗中选择策略（可勾选"始终允许"）
5. 通过右侧面板的 **Files** 标签浏览文件树，点击文件在详情视图预览；切换到 **Terminal** 标签创建和使用终端
6. 可选：开启 WebUI 远程访问或连接微信 iLink

## 数据与安全边界

- 本地保存：项目与会话元数据（`~/.fello/projects/` 下）、全局配置文件（`~/.fello/settings.json`）、API Agent 会话状态（`~/.fello/api-agents/` 下）、iLink 凭证（`~/.fello/ilink/` 下）
- 完整对话事件日志（在会话目录下的 `messages.jsonl` 或 `history.jsonl` 文件中）
- 渲染进程无 Node 直连能力，系统能力均通过受限 IPC 进入主进程

## 运行环境

- Node.js（Electron 主进程运行时）
- Electron（桌面容器）
- React + Vite（渲染层）
- ACP Server：`kiro-cli acp`（Stdio Agent）
- OpenAI 兼容 API 服务（API Agent）
- 数据目录：`~/.fello/`

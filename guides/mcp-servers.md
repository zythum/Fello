# MCP 服务器配置

> 🔧 **MCP（Model Context Protocol）** 让你的 Agent 获得额外的工具能力。通过配置 MCP 服务器，Agent 可以访问数据库、调用 API、操作文件系统等——无需修改 Agent 本身。

## 什么是 MCP

MCP 是一种标准化协议，让 AI Agent 能够动态发现和调用外部工具。Fello 作为 MCP 客户端，可以连接多个 MCP 服务器，将它们提供的工具注入到 Agent 的能力集中。

---

## MCP 服务器类型

| 类型 | 工作方式 | 适用场景 | 示例 |
|------|---------|---------|------|
| **Stdio** | Fello 启动本地子进程，通过 stdin/stdout 通信 | 本地工具、CLI 封装 | 文件搜索、Git 操作 |
| **HTTP** | 通过 HTTP/SSE 连接远程服务 | 远程服务、团队共享工具 | 数据库查询、API 网关 |

---

## 添加 MCP 服务器

1. 打开 Fello → **Settings**
2. 找到 **MCP Servers** 区域
3. 点击 **Add MCP Server**
4. 选择类型（Stdio 或 HTTP）并填写配置

### Stdio 类型配置

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `filesystem` | 服务器唯一标识，仅支持字母、数字、下划线和连字符 |
| **Command** | `npx` | 启动 MCP 服务器的可执行命令 |
| **Arguments** | `@modelcontextprotocol/server-filesystem /path/to/dir` | （可选）传递给命令的参数，以空格分隔 |
| **Env vars (JSON)** | `{"NODE_ENV": "production"}` | （可选）环境变量，JSON 对象格式 |


### HTTP 类型配置

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `remote-tools` | 服务器唯一标识，仅支持字母、数字、下划线和连字符 |
| **URL** | `http://localhost:3001/sse` | MCP 服务器的 HTTP/SSE 端点地址 |
| **Headers (JSON)** | `{"Authorization": "Bearer xxx"}` | （可选）自定义请求头，JSON 对象格式 |



---

## 在会话中启停 MCP 服务器

MCP 服务器可以在会话进行中随时启停，无需重建会话：

1. 在对话界面顶部，点击右侧的 **⚙️ 设置按钮**
2. 在弹出的面板中，找到 **MCP Servers** 区域
3. 通过开关启用或禁用需要的 MCP 服务器
4. 点击 **「重启会话」** 使修改生效，Agent 将获得或失去对应的工具能力

> 💡 **提示：** 不同会话可以启用不同的 MCP 服务器组合。例如，代码开发会话启用 Git 工具，数据分析会话启用数据库工具。

---

## 常用 MCP 服务器推荐

### Exa: Web search, built for AI agents

用于网络搜索。如果使用 API Agent，默认没有网络搜索工具，不配置 Agent 无法去网上冲浪。

| 字段 | 值 |
|------|-----|
| **类型** | HTTP |
| **ID** | `exa` |
| **URL** | `https://mcp.exa.ai/mcp` |

---

### Chrome DevTools: 浏览器调试与自动化

让 Agent 能够连接 Chrome 浏览器进行页面检查、DOM 操作、网络分析和性能调试。

| 字段 | 值 |
|------|-----|
| **类型** | Stdio |
| **ID** | `chrome-devtools` |
| **Command** | `npx` |
| **Arguments** | `-y chrome-devtools-mcp@latest --no-usage-statistics` |

---

### Computer Use: 桌面操控

让 Agent 能够像人一样操作你的电脑——移动鼠标、点击、输入文字、截取屏幕。

| 字段 | 值 |
|------|-----|
| **类型** | Stdio |
| **ID** | `computer-use` |
| **Command** | `npx` |
| **Arguments** | `-y @github/computer-use-mcp@latest` |

---

### Figma: 设计稿读取与协作

让 Agent 能够读取 Figma 设计文件，提取设计 Token、组件信息、布局结构等。

| 字段 | 值 |
|------|-----|
| **类型** | Stdio |
| **ID** | `figma` |
| **Command** | `npx` |
| **Arguments** | `-y figma-developer-mcp --figma-api-key=YOUR_API_KEY --stdio` |

> 💡 **注意：** Figma MCP 需要你的 Figma Personal Access Token。前往 Figma → Settings → Personal access tokens 生成后替换 `YOUR_API_KEY`。

---

### 米家智能家居: IoT 设备控制

让 Agent 能够查询和控制你的小米智能家居设备（灯、空调、扫地机等）。

| 字段 | 值 |
|------|-----|
| **类型** | Stdio |
| **ID** | `mijia-api` |
| **Command** | `npx` |
| **Arguments** | `-y @zythum02/mijia-api@latest mcp` |

> 💡 **了解更多：** MCP 协议的完整规范和更多社区服务器，请参考 [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| MCP 服务器启动失败 | 检查命令路径是否正确，确保依赖已安装（如 npx 对应的包） |
| 工具列表为空 | 确认 MCP 服务器已在会话中启用，检查服务器日志 |
| HTTP 连接超时 | 检查 URL 是否可达，确认端口未被防火墙拦截 |

---

## 📖 相关文档

| 文档 | 关联说明 |
|------|---------|
| ← [Agent 配置与管理](./agents.md) | 先配置 Agent，再为其添加 MCP 工具 |
| → [Skills 技能](./skills.md) | Skills 和 MCP 都是扩展 Agent 能力的方式 |
| → [权限控制与安全](./permissions.md) | MCP 工具调用同样受权限系统管控 |

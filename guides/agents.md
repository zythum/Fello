# Agent 配置与管理

> 🧠 **本章介绍**如何在 Fello 中添加、配置和管理 AI Agent。Fello 支持本地 Stdio Agent 和远程 API Agent 两种类型，你可以根据需求自由组合。

## Agent 类型概览

| 类型 | 工作方式 | 适用场景 | 代表示例 |
|------|---------|---------|---------|
| **Stdio Agent** | 通过 ACP 协议启动本地子进程，NDJSON stdio 通信 | 隐私优先、离线可用 | `kiro-cli acp` |
| **API Agent** | 通过 HTTP 连接 OpenAI 兼容 API，进程内运行 | 使用云端大模型 | OpenAI / Claude / DeepSeek 等 |

---

## 添加 Stdio Agent

### 前置条件

确保你的系统已安装 Kiro CLI。通过以下命令一键安装（支持 macOS / Linux / Windows）：

```bash
curl -fsSL https://cli.kiro.dev/install | bash
```

更多安装方式请参考 → [Kiro CLI 官方页面](https://kiro.dev/cli/)

### 配置步骤

1. 打开 Fello → **Settings**（设置）
2. 找到 **Agents** 区域，点击 **Add Agent**
3. 选择类型：**Stdio**
4. 填写配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `kiro` | Agent 唯一标识，仅支持字母、数字、下划线和连字符 |
| **Command** | `kiro-cli` | 启动 Agent 的可执行命令（需在系统 PATH 中可找到） |
| **Args** | `acp` | （可选）传递给命令的参数，以空格分隔 |
| **Env vars** | `{"NODE_ENV": "production"}` | （可选）环境变量，JSON 对象格式 |



---

## 添加 API Agent

### 配置步骤

1. 打开 Fello → **Settings**（设置）
2. 找到 **Agents** 区域，点击 **Add Agent**
3. 选择类型：**API**
4. 填写配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `deepseek` | Agent 唯一标识，仅支持字母、数字、下划线和连字符 |
| **Provider** | `openai-compatible` | API 兼容协议类型（目前支持 OpenAI 兼容） |
| **Base URL** | `https://api.deepseek.com/v1` | API 服务地址，需兼容 `/chat/completions` 接口 |
| **API Key** | `sk-xxx...` | API 鉴权密钥 |
| **Headers (JSON)** | `{"X-Custom": "value"}` | （可选）额外的请求头，JSON 对象格式，如自定义鉴权头 |
| **Context Window** | `1000000` | （可选）上下文窗口大小（tokens），用于用量展示，默认 128000。大部分可以选 1m。（选错只影响数据统计） |

> 💡 **兼容性：** 任何兼容 OpenAI `/v1/chat/completions` 接口的服务都可以接入，包括 Azure OpenAI、本地 Ollama、vLLM 等。

### 常用 API 服务配置参考

| 服务 | Base URL | 常用模型 |
|------|---------|---------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` / `o3` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-reasoner` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| OpenRouter | `https://openrouter.ai/api/v1` | 按需选择多家模型 |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5` / `llama3` |

---

## 管理已有 Agent

### 编辑与删除

在 Settings → Agents 列表中，每个 Agent 条目支持：

- **编辑**：修改名称、命令、API 地址等配置
- **删除**：移除不再需要的 Agent
- **停用**：临时禁用某个 Agent，不影响配置

### 在会话中调整配置

会话创建后，Agent 不可更换（需新建会话选择其他 Agent）。但你可以在会话进行中通过顶部的 **⚙️ 设置按钮**实时调整：

- **Features 开关** — 启用或禁用「技能」「向我提问」等功能
- **MCP 服务器开关** — 按需启用或禁用已配置的 MCP 服务器
- **重启会话** — 应用以上修改并刷新会话状态

> 💡 **提示：** 修改 Features 或 MCP 开关后，需点击「重启会话」按钮使配置生效。

---

## 在会话中切换模型

部分 Agent 支持在会话中随时切换模型或工作模式，无需重建会话：

- **模型切换**：在输入框右下角的模型下拉菜单中，从 Agent 提供的可用模型列表中选择
- **模式切换**：在输入框左下角的模式下拉菜单中切换（如 Agent 支持多种工作模式）

> 💡 **注意：** 模型列表和模式列表由 Agent 动态提供。如果输入框底部未显示选择器，说明当前 Agent 不支持模型/模式切换（如 Stdio Agent 通常不提供此功能，模型由 Agent 内部决定）。

> 💡 **API Agent 的模型列表**从所配置的 API 服务动态获取。切换模型后，后续对话立即使用新模型，Token 统计也会实时更新。

---

## Token 用量监控

Fello 提供实时的 Token 用量追踪：

- **每轮统计**：每轮对话结束后，在输入区上方显示本轮 token 用量（输入/输出/思考/缓存）
- **上下文进度条**：会话头部以进度条直观显示上下文窗口占用比例



---

## 📖 相关文档

| 文档 | 关联说明 |
|------|---------|
| ← [快速开始](./quick-start.md) | 从这里来：第二步配置 Agent |
| → [MCP 服务器配置](./mcp-servers.md) | 为 Agent 扩展更多工具能力 |
| → [Skills 技能](./skills.md) | 安装技能包增强 Agent 专业能力 |
| → [权限控制与安全](./permissions.md) | 了解 Agent 操作的权限管理 |
| → [Kiro 作为 Agent](./agents-kiro.md) | 配置 Kiro Stdio Agent（ACP） |
| → [Kimi 作为 Agent](./agents-kimi.md) | 配置 Kimi API / Stdio Agent + Exa MCP |
| → [DeepSeek 作为 Agent](./agents-deepseek.md) | 配置 DeepSeek API Agent + Exa MCP |

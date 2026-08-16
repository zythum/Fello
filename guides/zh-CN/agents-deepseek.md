# DeepSeek 作为 Agent

> 💡 DeepSeek 提供兼容 OpenAI 的 API 服务，可作为 **API Agent** 接入 Fello。支持思考模式（reasoner）与非思考模式（chat）两种模型，满足不同场景需求。

## 前置条件

1. 前往 [DeepSeek 开放平台](https://platform.deepseek.com/) 注册账号
2. 在控制台中创建 API Key（`sk-...` 格式）
3. 充值或确认账户有足够余额

> ⚠️ **注意：** DeepSeek API 采用预充值模式，需先充值后方可使用。API Key 创建后请妥善保管，避免泄露。

## 配置步骤

打开 Fello → **Settings**（设置）→ **Agents**（智能体），点击 **Add API Agent**，填写如下配置：

| 字段 | 示例值 | 说明 |
|------|-------|------|
| **ID** | `deepseek` | 唯一标识 |
| **Provider** | `openai-compatible` | DeepSeek 兼容 OpenAI 协议 |
| **Base URL** | `https://api.deepseek.com/v1` | DeepSeek API 地址 |
| **API Key** | `sk-xxxxxxxx` | 开放平台创建的密钥 |

点击确认后即完成添加。新建会话时在模型下拉菜单中选择 `deepseek-chat`（非思考模式）或 `deepseek-reasoner`（思考模式）。

## 推荐：Exa MCP 搜索工具

为 Agent 提供网络搜索能力，以 HTTP MCP 方式接入：

| 字段 | 值 |
|------|-----|
| **ID** | `exa` |
| **Url** | `https://mcp.exa.ai/mcp` |
| **Headers** | `{}`（免费额度无需 API Key） |

> 详细配置请参考 [MCP 服务器配置](./mcp-servers.md)

## 常见问题

| 问题 | 解决方法 |
|------|---------|
| `401 Invalid API Key` | 检查 API Key 是否正确，或在 DeepSeek 平台重新生成 |
| `402 Insufficient Balance` | 账户余额不足，请前往 DeepSeek 开放平台充值 |
| 模型列表为空 | 确认 Base URL 为 `https://api.deepseek.com/v1` |

---

> 📖 [DeepSeek API 官方文档](https://api-docs.deepseek.com/)

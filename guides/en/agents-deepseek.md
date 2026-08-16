# DeepSeek as an Agent

> 💡 DeepSeek provides an OpenAI-compatible API service and can be connected to Fello as an **API Agent**. It supports both reasoning mode (reasoner) and non-reasoning mode (chat) models to suit different scenarios.

## Prerequisites

1. Sign up for an account at the [DeepSeek Platform](https://platform.deepseek.com/)
2. Create an API Key in the console (`sk-...` format)
3. Top up or confirm your account has sufficient balance

> ⚠️ **Note:** The DeepSeek API uses a prepaid model, so you need to top up before using it. Keep your API Key safe after creating it and avoid leaking it.

## Configuration Steps

Open Fello → **Settings** → **Agents**, click **Add API Agent**, and fill in the following configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `deepseek` | Unique identifier |
| **Provider** | `openai-compatible` | DeepSeek is compatible with the OpenAI protocol |
| **Base URL** | `https://api.deepseek.com/v1` | DeepSeek API address |
| **API Key** | `sk-xxxxxxxx` | The key created on the platform |

Click confirm to finish adding the agent. When starting a new session, select `deepseek-chat` (non-reasoning mode) or `deepseek-reasoner` (reasoning mode) from the model dropdown.

## Recommended: Exa MCP Search Tool

Gives the agent web search capability, connected via HTTP MCP:

| Field | Value |
|------|-----|
| **ID** | `exa` |
| **Url** | `https://mcp.exa.ai/mcp` |
| **Headers** | `{}` (no API Key needed for the free tier) |

> For detailed configuration, see [MCP Servers](./mcp-servers.md)

## FAQ / Common Issues

| Issue | Solution |
|------|---------|
| `401 Invalid API Key` | Check that the API Key is correct, or regenerate it on the DeepSeek platform |
| `402 Insufficient Balance` | Your account balance is insufficient; top up on the DeepSeek platform |
| Model list is empty | Make sure the Base URL is `https://api.deepseek.com/v1` |

---

> 📖 [DeepSeek API Official Docs](https://api-docs.deepseek.com/)

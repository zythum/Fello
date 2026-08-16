# Agent Configuration

> 🧠 **About this chapter** — How to add, configure, and manage AI Agents in Fello. Fello supports two types of Agents: local Stdio Agents and remote API Agents. You can combine them freely to suit your needs.

## Agent Types Overview

| Type | How It Works | Best For | Example |
|------|---------|---------|---------|
| **Stdio Agent** | Launches a local subprocess via the ACP protocol with NDJSON stdio communication | Privacy-first, offline use | `kiro-cli acp` |
| **API Agent** | Connects to an OpenAI-compatible API over HTTP, running in-process | Using cloud LLMs | OpenAI / Claude / DeepSeek, etc. |

---

## Adding a Stdio Agent

### Prerequisites

Make sure Kiro CLI is installed on your system. Install it with a single command (supports macOS / Linux / Windows):

```bash
curl -fsSL https://cli.kiro.dev/install | bash
```

For more installation options, see → [Kiro CLI Official Page](https://kiro.dev/cli/)

### Configuration Steps

1. Open Fello → **Settings**
2. Find the **Agents** section and click **Add Agent**
3. Select the type: **Stdio**
4. Fill in the configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `kiro` | Unique identifier for the Agent; only letters, numbers, underscores, and hyphens are allowed |
| **Command** | `kiro-cli` | The executable command that launches the Agent (must be available in your system PATH) |
| **Args** | `acp` | (Optional) Arguments passed to the command, separated by spaces |
| **Env vars** | `{"NODE_ENV": "production"}` | (Optional) Environment variables in JSON object format |



---

## Adding an API Agent

### Configuration Steps

1. Open Fello → **Settings**
2. Find the **Agents** section and click **Add Agent**
3. Select the type: **API**
4. Fill in the configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `deepseek` | Unique identifier for the Agent; only letters, numbers, underscores, and hyphens are allowed |
| **Provider** | `openai-compatible` | API compatibility protocol type (OpenAI-compatible is currently supported) |
| **Base URL** | `https://api.deepseek.com/v1` | The API service URL, must be compatible with the `/chat/completions` endpoint |
| **API Key** | `sk-xxx...` | The API key used for authentication |
| **Headers (JSON)** | `{"X-Custom": "value"}` | (Optional) Extra request headers in JSON object format, e.g. custom auth headers |
| **Context Window** | `1000000` | (Optional) Context window size (tokens), used for usage display; defaults to 128000. For most cases you can pick 1m. (A wrong value only affects usage statistics.) |

> 💡 **Compatibility:** Any service that implements the OpenAI `/v1/chat/completions` endpoint can be connected, including Azure OpenAI, local Ollama, vLLM, and more.

### Common API Service Configuration Reference

| Service | Base URL | Common Models |
|------|---------|---------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` / `o3` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-reasoner` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-sonnet-4-20250514` |
| OpenRouter | `https://openrouter.ai/api/v1` | Choose from multiple models on demand |
| Local Ollama | `http://localhost:11434/v1` | `qwen2.5` / `llama3` |

---

## Managing Existing Agents

### Editing and Deleting

In Settings → Agents, each Agent entry supports:

- **Edit**: modify the name, command, API URL, and other configuration
- **Delete**: remove an Agent you no longer need
- **Disable**: temporarily deactivate an Agent without losing its configuration

### Adjusting Configuration During a Session

Once a session is created, the Agent cannot be changed (create a new session to select a different Agent). However, you can adjust settings in real time during a session via the **⚙️ settings button** at the top:

- **Features toggle** — enable or disable features such as Skills and Ask User
- **MCP servers toggle** — enable or disable configured MCP servers as needed
- **Restart session** — apply the changes above and refresh the session state

> 💡 **Tip:** After changing Features or MCP toggles, click the **Restart Session** button to apply the configuration.

---

## Switching Models in a Session

Some Agents let you switch models or working modes at any time during a session without recreating it:

- **Switch model**: use the model dropdown at the bottom right of the input box to pick from the models provided by the Agent
- **Switch mode**: use the mode dropdown at the bottom left of the input box (if the Agent supports multiple working modes)

> 💡 **Note:** The model and mode lists are provided dynamically by the Agent. If no selector appears at the bottom of the input box, the current Agent does not support model/mode switching (Stdio Agents usually don't offer this; the model is decided internally by the Agent).

> 💡 **API Agent model list** is fetched dynamically from the configured API service. After switching models, subsequent messages immediately use the new model, and token statistics update in real time.

---

## Token Usage Monitoring

Fello provides real-time token usage tracking:

- **Per-round statistics**: after each round, the token usage for that round is shown above the input area (input/output/thinking/cache)
- **Context progress bar**: the session header shows the context window usage ratio as a progress bar



---

## 📖 Related Docs

| Doc | Related To |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: step 2, configure an Agent |
| → [MCP Servers](./mcp-servers.md) | Extend your Agent with more tool capabilities |
| → [Skills](./skills.md) | Install skill packs to enhance your Agent's capabilities |
| → [Permissions & Security](./permissions.md) | Learn about permission management for Agent actions |
| → [Kiro as an Agent](./agents-kiro.md) | Configure the Kiro Stdio Agent (ACP) |
| → [Kimi as an Agent](./agents-kimi.md) | Configure the Kimi API / Stdio Agent + Exa MCP |
| → [DeepSeek as an Agent](./agents-deepseek.md) | Configure the DeepSeek API Agent + Exa MCP |
| → [CodeBuddy as an Agent](./agents-codebuddy.md) | Configure the CodeBuddy Stdio Agent (ACP) + Agent Teams |

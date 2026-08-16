# Kimi as an Agent

> 💡 Kimi (Moonshot AI) can be connected in two ways: as an **API Agent** using the OpenAI-compatible endpoint, or as a **Stdio Agent** using kimi-cli's ACP protocol. The former works out of the box; the latter is a good fit for local-first use cases.

## Option 1: API Agent

### Prerequisites

Sign up on the Kimi open platform and create an API Key:

| Platform | Region |
|------|---------|
| [platform.kimi.com](https://platform.kimi.com/) | Mainland China |
| [platform.kimi.ai](https://platform.kimi.ai/) | Outside China |

> ⚠️ Accounts and API Keys on the two platforms are independent and cannot be mixed. Using the wrong one will result in a 401 error.

### Configuring the Base URL

Different services use different Base URLs:

| Service | Base URL | Description |
|------|---------|------|
| Standard API (CN) | `https://api.moonshot.cn/v1` | The API endpoint for platform.kimi.com |
| Standard API (Global) | `https://api.moonshot.ai/v1` | The API endpoint for platform.kimi.ai |
| Kimi Code Plan | `https://api.kimi.com/coding/v1` | For Kimi Code programming use; supports search and fetching services |

### Configuration Steps

Open Fello → **Settings** → **Agents**, click **Add API Agent**, and fill in the following configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `kimi` | Unique identifier |
| **Provider** | `openai-compatible` | Kimi is compatible with the OpenAI protocol |
| **Base URL** | Choose any address above as needed | The API service URL |
| **API Key** | `sk-xxxxxxxx` | The key for the corresponding platform |

Click confirm to finish. When creating a new session, pick the model you want from the model dropdown.

## Option 2: Stdio Agent (ACP)

### Installing kimi-cli

Open a terminal and run the following command to install it:

```bash
# One-line install for macOS / Linux
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

```powershell
# Windows PowerShell install
irm https://code.kimi.com/kimi-code/install.ps1 | iex
```

After installation, run `kimi-cli --version` to verify it works.

### Logging In

On first use, run `kimi-cli` to enter the interactive interface and type `/login` to complete authentication (supports Kimi Code OAuth or a Moonshot AI API Key).

### Configuration Steps

Open Fello → **Settings** → **Agents**, click **Add Stdio Agent**, and fill in the following configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `kimi` | Unique identifier |
| **Command** | `kimi-cli` | The executable command (must be in your system PATH) |
| **Args** | `acp` | Starts the ACP protocol service |

Click confirm to finish.

## Recommended: Exa MCP Search Tool

Add web search capability to your Agent via an HTTP MCP connection:

| Field | Value |
|------|-----|
| **ID** | `exa` |
| **Url** | `https://mcp.exa.ai/mcp` |
| **Headers** | `{}` (no API Key needed for the free tier) |

> For detailed configuration, see [MCP Servers](./mcp-servers.md)

## Common Issues

| Issue | Solution |
|------|---------|
| `401 Unauthorized` (API) | Check that the API Key matches the Base URL (CN: `moonshot.cn`, Global: `moonshot.ai`) |
| ACP reports authentication failure | Run `kimi-cli` in a terminal and type `/login` to sign in |
| `command not found: kimi-cli` | Make sure kimi-cli is installed and in your system PATH, then restart Fello |

---

> 📖 [Kimi Open Platform (CN)](https://platform.kimi.com/) · [Kimi Open Platform (Global)](https://platform.kimi.ai/) · [kimi-cli Docs](https://moonshotai.github.io/kimi-cli/)

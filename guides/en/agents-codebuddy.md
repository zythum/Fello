# CodeBuddy as an Agent

> 💡 CodeBuddy (Tencent Cloud Code Assistant) natively supports the ACP protocol and can be connected to Fello as a **Stdio Agent**. It runs as a local subprocess via `codebuddy --acp`, so your data never leaves your machine, and it supports multi-agent collaboration with Agent Teams.

## Install the CodeBuddy CLI

### Install via npm (Recommended)

Prerequisites: Node.js >= 18.20

```bash
npm install -g @tencent-ai/codebuddy-code
```

### Install via Homebrew (macOS / Linux)

No Node.js environment required:

```bash
brew install Tencent-CodeBuddy/tap/codebuddy-code
```

### Install the Native Binary (Beta)

```bash
# One-click install for macOS / Linux
curl -fsSL https://www.codebuddy.cn/cli/install.sh | bash
```

```powershell
# Install on Windows PowerShell
irm https://www.codebuddy.cn/cli/install.ps1 | iex
```

After installation, run `codebuddy --version` to verify it works.

> 💡 **Tip:** If you see `command not found`, check that the installation path is included in your system `PATH` (the native binary is installed to `~/.local/bin` by default).

## Log In to CodeBuddy

Run `codebuddy` for the first time to enter the interactive interface, then choose a login method to complete authentication:

| Login Methods | Use Case |
|---------|---------|
| **Chinese Site** | For users on the China site; authenticates through Tencent Cloud China (copilot.tencent.com) and supports mainstream domestic models |
| **International Site** | For users on the international site; authenticates through codebuddy.ai |
| **Enterprise Domain** | For enterprise editions / private deployments; enter the service address provided by your organization |
| **iOA** | For Tencent employees; authenticates through the iOA zero-trust system |

## Configure the CodeBuddy Agent in Fello

Open Fello → **Settings** → **Agents**, click **Add Stdio Agent**, and fill in the following configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `codebuddy` | Unique identifier |
| **Command** | `codebuddy` | Executable command (must be on the system PATH) |
| **Args** | `--acp` | Starts the ACP protocol service |

Click confirm, and CodeBuddy will appear in the agent list. Select **CodeBuddy** when starting a new session to begin chatting.

## FAQ / Common Issues

| Issue | Solution |
|------|---------|
| `command not found: codebuddy` | Make sure the CodeBuddy CLI is installed and on the system PATH, then restart Fello and try again |
| No response after launching | Run `codebuddy --acp` in a terminal to check whether it starts correctly and whether there are authentication issues |
| Authentication expired or not logged in | Run `codebuddy` in a terminal and complete the login authentication again |
| Wrong version due to multiple versions | Check for duplicate installs via npm and Homebrew, and keep only one |

---

> 📖 [CodeBuddy CLI Official Docs](https://www.codebuddy.ai/docs/cli/) · [ACP Integration Docs](https://www.codebuddy.ai/docs/cli/acp) · [Installation Guide](https://www.codebuddy.ai/docs/cli/installation)

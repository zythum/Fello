# Kiro as an Agent

> 💡 Kiro CLI can be connected to Fello as a **Stdio Agent**. It runs as a local subprocess via ACP (Agent Chat Protocol), so data never leaves your machine — ideal for privacy-first use cases.

## Installing Kiro CLI

Before configuring, make sure Kiro CLI is installed on your system. Open a terminal and run the following command to install it:

```bash
# One-line install for macOS / Linux
curl -fsSL https://cli.kiro.dev/install | bash
```

```powershell
# Windows 11 PowerShell install
irm "https://cli.kiro.dev/install.ps1" | iex
```

Other installation methods:

- **Homebrew** (macOS, community-maintained): `brew install --cask kiro-cli`
- **Ubuntu .deb**: `wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.deb` → `sudo dpkg -i kiro-cli.deb`

After installation, run `kiro-cli --version` to verify it works.

## Logging in to Kiro

Run the `kiro-cli login` command and follow Kiro's guided login flow:

> 🔗 [Authentication methods - Kiro CLI Docs](https://kiro.dev/docs/cli/authentication/)

## Configuring the Kiro Agent in Fello

Open Fello → **Settings** → **Agents**, click **Add Stdio Agent**, and fill in the following configuration:

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `kiro` | Unique identifier; only letters, numbers, underscores, and hyphens are allowed |
| **Command** | `kiro-cli` | The executable command (must be in your system PATH) |
| **Args** | `acp` | Starts the ACP protocol service |

Click confirm and Kiro will appear in your Agent list. Select **Kiro** when creating a new session to start chatting.

## How It Works

Fello communicates with Kiro CLI via **ACP (Agent Chat Protocol)**:

- Fello launches `kiro-cli acp` as a subprocess
- The two sides communicate over stdio using the NDJSON format
- Kiro runs as an independent Agent runtime with its own tool calling, model selection, and context management
- All data is processed locally and never passes through third-party servers

## Common Issues

| Issue | Solution |
|------|---------|
| `command not found: kiro-cli` | Make sure Kiro CLI is installed and in your system PATH, then restart Fello and try again |
| No response after startup | Run `kiro-cli acp` in a terminal to check whether it starts properly, and look for any authentication issues |
| Authentication expired | Run `kiro-cli auth login` in a terminal to re-authorize |

---

> 📖 [Kiro CLI Official Docs](https://kiro.dev/docs/cli/)

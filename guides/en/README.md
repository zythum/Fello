# Fello User Manual

> 🚀 **Fello** is a desktop AI collaboration client that seamlessly integrates local and cloud AI Agents into your daily development workflow. This manual helps you get started quickly and make the most of everything Fello has to offer.

[中文](./../zh-CN/README.md) | English

## 📖 Table of Contents

| Section | What's inside |
|---------|---------------|
| [Quick Start](./quick-start.md) | Download & install → configure your first Agent → start your first conversation, 5 minutes to get up and running |
| [Agent Configuration](./agents.md) | Add local Stdio Agents and API Agents, switch models, manage multiple Agents |
| → [Kiro as an Agent](./agents-kiro.md) | Configure the Kiro Stdio Agent (ACP) |
| → [Kimi as an Agent](./agents-kimi.md) | Configure the Kimi API / Stdio Agent + Exa MCP |
| → [CodeBuddy as an Agent](./agents-codebuddy.md) | Configure the CodeBuddy Stdio Agent (ACP) + Agent Teams |
| → [DeepSeek as an Agent](./agents-deepseek.md) | Configure the DeepSeek API Agent + Exa MCP |
| [MCP Servers](./mcp-servers.md) | Extend your Agent's tool capabilities by configuring Stdio and HTTP MCP servers |
| [File Workspace & Terminal](./file-workspace.md) | File browsing, editing, preview, diff comparison, and creating/using terminals |
| [WebUI Remote Access](./webui.md) | Use Fello's full feature set from a browser on your local network |
| [WeChat iLink](./wechat-ilink.md) | Connect Fello to WeChat and send/receive messages from the desktop |
| [Permissions & Security](./permissions.md) | Tool permission management, "Always Allow" memory, permission mode switching |
| [Skills](./skills.md) | Browse and install Skills to give your Agent specialized expertise |

---

## 🌟 What Fello Can Do

- 🧠 **Multiple Agent support** — Run local Stdio Agents (via the ACP protocol) or connect OpenAI-compatible APIs, and switch freely between conversations
- 🔧 **MCP server integration** — Dynamically configure MCP servers to give your Agent more tools
- 📁 **File workspace + terminal** — Browse, edit, and preview files right next to your AI conversation while running terminals, all in one synchronized panel
- 🌐 **WebUI remote access** — Use all of Fello's features from a browser on the same network
- 💬 **WeChat iLink** — Connect Fello to WeChat, send and receive messages from the desktop, always online
- 💡 **Permission control** — Granular tool permission management with "Always Allow" memory

---

## Download & Install

Download the latest version from the GitHub Releases page:

👉 [Fello Releases - GitHub](https://github.com/Zythum/fello/releases)

## 💻 Supported Platforms

| Platform | Desktop Client | WebUI Remote Access |
|----------|----------------|---------------------|
| macOS | ✅ Native support | ✅ Browser access |
| Windows | ✅ Native support | ✅ Browser access |
| Linux | ✅ Native support | ✅ Browser access |

> 💡 **Tip:** After installation, read the [Quick Start](./quick-start.md) section — your first AI conversation takes just 5 minutes.

---

## Deploy to a Server

Beyond the desktop client, Fello can also run as a headless server, with no graphical interface required — access the full feature set remotely from a browser.

### System Requirements

| Item | Requirement |
|------|-------------|
| OS | Linux / macOS / Windows (any system that supports Node.js) |
| Node.js | >= 20.x |
| Network | One open port for browser access (randomly assigned by default) |
| Display | ❌ Not required (headless) |

### Deploy via npm Package

> 🚀 The fastest way — one command to start the server.

```bash
# Run directly without installing (recommended)
npx @zythum02/fello-server --port 9090 --token mysecret

# Or install globally and run
npm install -g @zythum02/fello-server
fello-server -p 9090 -t mysecret
```

Once started, open this in your browser:

```
http://<server-ip>:9090/?token=mysecret
```

> 💡 **Arguments:**
> - `--port` / `-p`: listening port, randomly assigned by default
> - `--token` / `-t`: access key for WebUI authentication

### Deploy from Source

For scenarios where you need customization or secondary development:

```bash
# 1. Clone the repository
git clone https://github.com/Zythum/fello.git
cd fello

# 2. Install dependencies
npm install

# 3. Build the npm package
npm run pack:npm

# 4. Start the server
node npm-package/out/server/main.js --port 9090 --token mysecret
```

> 💡 **Notes:**
> - Use a process manager like `pm2` or `systemd` to keep the server running
> - Set a strong token in production
> - For HTTPS access, put an Nginx reverse proxy in front

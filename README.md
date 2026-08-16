# 🚀 Fello — Your AI Desktop Companion

> **Talk to your codebase. Let AI handle the heavy lifting.**

**English** · [**中文**](./README.zh-CN.md)

**Fello** is a desktop AI workspace built on the open [**Agent Client Protocol (ACP)**](https://agentclientprotocol.com/).
It's not tied to any single AI vendor — connect local agents (via ACP, e.g. `kiro-cli acp`) or any OpenAI-compatible API, and bring chat, files, terminal, diffs, project memory and MCP tools together in one native app.

![Fello Screenshot](screenshots/screenshot-theme.png)

[**⬇️ Download Fello**](https://github.com/Zythum/fello/releases)

---

## 📖 User Manual

🚀 [**Fello User Manual**](./guides/en/README.md) — Getting started, agent configuration, MCP setup, and more.

---

## What is Fello?

Most AI tools lock you into one model, one subscription, one way of working. Fello takes a different approach: instead of being yet another agent, it's an **agent-neutral desktop client** that lets you bring your own agents.

- 🧩 Built on the open ACP protocol — like LSP for language servers, but for AI agents
- 🔁 Bring your own agent: local Stdio agents or OpenAI-compatible APIs
- 📂 Work in a real workspace: files, terminal, and diffs alongside your chat

## Who is it for?

- **Developers** who want to switch between multiple agents freely
- **Privacy-conscious users** who want local-first AI
- **Teams** that need remote access or self-hosted deployment

---

## Why Fello?

- 🧩 **No Vendor Lock-in** — Connect any ACP-compatible agent or any OpenAI-compatible API, and switch freely between them per session. Your tools, your choice.

- 🔒 **Local-First & Private** — Run agents locally and keep your code and data on your machine. Nothing leaves your computer unless you choose a cloud API.

- 🖥️ **All-in-One Workspace** — Browse, edit, preview files, view diffs and run terminals side by side with your AI chat. One panel, fully synced.

- 🧠 **Persistent Project Memory** — Project conventions, preferences, decisions and corrections survive across sessions, with focused retrieval and transactional updates.

- 🛡️ **Granular Permission Control** — Approve every tool call or use "Always Allow" memory. Stay in control without repetitive confirmations.

- 🌐 **Remote Access & Self-Hosting** — Access Fello from any browser on your LAN, or deploy its headless server on your own machine. Full functionality, zero compromise.

- ⏰ **Automation** — Schedule AI tasks with cron expressions. Daily reports, periodic checks, or any recurring workflow — on autopilot.

- 💬 **WeChat iLink** — Bridge Fello to WeChat. Receive messages and reply right from your desktop.

- 🎨 **Beautiful & Modern UI** — Dark/light themes, tabbed panels, and smooth streaming chat.

---

## ⚡ Deep Integrations

Fello goes beyond basic connectivity — it ships **purpose-built optimizations** for Kiro and CodeBuddy, so you get a smoother experience out of the box.

**Kiro** ([guide](./guides/en/agents-kiro.md))

- 📊 **Live context usage** — see how much of your context window is in use in real time.
- ⌨️ **Slash commands** — Kiro's commands are detected and surfaced right in the chat UI.
- 🤖 **Sub-agent status** — Kiro's subagents appear as live sub-tasks with up-to-date status.

**CodeBuddy** ([guide](./guides/en/agents-codebuddy.md))

- 👥 **Agent Teams** — multi-agent collaboration with live member and sub-task status (in progress / completed / failed).
- 🔁 **Turn replay filtering** — CodeBuddy re-broadcasts the previous turn when a new prompt starts; Fello filters those replays automatically so your history stays clean.
- ⚙️ **Auto environment setup** — recommended runtime environment variables are injected automatically.

---

## Quick Start

1. **Download** Fello for macOS / Windows / Linux from [Releases](https://github.com/Zythum/fello/releases).
2. **Add an Agent** — a local Stdio agent (via ACP) or an OpenAI-compatible API. See the [Agent guide](./guides/en/agents.md).
3. **Start chatting** — create a project, open a session, and let AI handle the heavy lifting.

📖 Full guide: [Fello User Manual](./guides/en/README.md)

---

## 📱 Connect Anywhere

Fello isn't just a desktop app — reach your agents from WeChat or any browser on your network.

### 💬 WeChat iLink

Bridge Fello to WeChat: receive messages and reply right from your desktop, wherever you are.

1. Open Fello → **Settings** → **WeChat iLink**
2. Click **Connect** and scan the QR code with WeChat
3. Right-click a session in the sidebar → **Set as WeChat Active**

WeChat messages are routed into that session automatically, and the agent's replies are sent back to WeChat.

> 💡 Detailed walkthrough: [WeChat iLink guide](./guides/en/wechat-ilink.md)

### 🌐 WebUI Remote Access

Use the full Fello interface from any browser on your LAN — no installation needed on the client device.

1. Open Fello → **Settings** → **WebUI**
2. Toggle **Enable WebUI**, then set a port (auto-assigned by default) and a token
3. Open the displayed access URL in a browser on the same network

> 💡 Detailed walkthrough: [WebUI guide](./guides/en/webui.md)

---

## Platform Support

| Platform | Desktop App | WebUI Remote Access |
|----------|-------------|---------------------|
| macOS | ✅ | ✅ |
| Windows | ✅ | ✅ |
| Linux | ✅ | ✅ |
| Server (headless) | — | ✅ via browser through `@zythum02/fello-server` |

---

## Community & Support

- 📖 [User Manual](./guides/en/README.md)
- 🐛 [GitHub Issues](https://github.com/Zythum/fello/issues) — report bugs & request features
- 📜 [GPL-3.0-or-later](./LICENSE) — open source

---

## For Developers

Fello is open source. Want to build, customize, or contribute? See the [**Developer Guide**](./DEVELOPER.md).

---

**Built with ❤️ by [Zythum](https://github.com/Zythum)** · GPL-3.0-or-later

# Quick Start

> 💡 **Goal:** Install Fello and start your first AI conversation within 5 minutes.

## Step 1: Download & Install

Download the installer for your operating system from GitHub Releases:

👉 [Fello Releases - GitHub](https://github.com/Zythum/fello/releases)

| Platform | File format | How to install |
|----------|-------------|----------------|
| macOS | .dmg | Double-click to open, drag into Applications |
| Windows | .exe | Double-click to run the setup wizard |
| Linux | .AppImage / .deb | Make it executable and run, or install with dpkg |

---

## Step 2: Configure Your First Agent

Fello supports two types of Agents — pick the one that fits your needs:

### Local Stdio Agent (recommended)

> 💻 Runs a local command-line Agent over the ACP protocol. Data stays fully on your machine — private and secure.

### API Agent

> 💡 Connect to an OpenAI-compatible API service, with support for streaming text and reasoning. Requires an API address and key.

See → [Agent Configuration](./agents.md) for details.

---

## Step 3: Import a Project

> 💡 **Tip:** Work is organized around working directories. Your Agent will use that directory as context for file operations and code understanding.

Fello organizes your work around **working directories (project folders)**. Each project corresponds to a folder on disk, and your Agent uses that directory as context for file operations and code understanding.

### How to Add

- **Desktop client** — click the "Add Project" button at the bottom of the left sidebar and pick the target folder in the system file picker.
- **WebUI mode** — click "Add Project", then enter the absolute path on the server (e.g. `/home/user/my-project`) and confirm.

### Steps

1. Click the "+ Add Project" button in the left sidebar
2. Choose or enter your project folder path
3. Once added, a "New Session" dialog opens automatically
4. Select the Agent you want to use and confirm to start chatting

### Managing Projects

Once a project is added, you can do the following from the sidebar:

| Action | Description |
|--------|-------------|
| Rename | Right-click the project name and choose "Rename" to set a custom display name (the actual folder is unaffected) |
| Open in Finder / File Explorer | Jump straight to the folder's system location |
| Delete project | Remove the project from Fello (disk files are not deleted), along with all associated sessions |

> ✅ **Done!** After adding a project, it expands in the left sidebar where you can create multiple sessions, each with its own Agent and MCP configuration.

---

## Step 4: Start Your First Conversation

Once your project is added, you can start chatting with an AI Agent:

1. Click the "+ New Session" button next to the project, or use the dialog from the previous step
2. Select the **Agent** you want (e.g. Kiro or an API Agent you configured)
3. (Optional) Enable the **MCP servers** you need to give the Agent extra tools
4. (Optional) Set the **permission mode**: "Ask Every Time" is safer, "Always Allow" is smoother
5. (Optional) Toggle the **Features** options to control what the Agent can do in this session
6. Confirm to enter the conversation, then type your first message in the input box at the bottom
7. Press **Enter** to send — the Agent responds step by step in a stream

> 💡 **Try these prompts:**
> - "Help me look at the structure of this project" — get an overview
> - "What tech stack does this project use?" — grasp the technical details quickly
> - "Help me write a README" — let the Agent generate docs for you
> - "Find all TODO comments" — search the project for outstanding items

### Features

When creating a session, you can toggle what the Agent is allowed to do during that session:

| Feature | Description |
|---------|-------------|
| **Skills** | When enabled, the Agent can use installed skill packs (e.g. the lark skills) for more specialized domain expertise. When disabled, only basic conversation and tools are available. |
| **Ask User** | When enabled, the Agent can proactively ask you clarifying questions when information is insufficient — more precise conversations. When disabled, the Agent infers on its own without interrupting the flow. |

> 💡 **Both features are enabled by default.** We recommend keeping the defaults unless you have a specific reason to limit the Agent's capabilities.

During a conversation, the Agent may request to use tools (e.g. reading files, running commands). The first time, a **permission confirmation dialog** appears — choose "Allow" or "Always Allow" to remember the authorization.

---

## 📖 Related Docs

| Doc | What it covers |
|-----|----------------|
| → [Agent Configuration](./agents.md) | Details on configuring Stdio / API Agents |
| → [MCP Servers](./mcp-servers.md) | Extend the Agent with more tools |
| → [File Workspace & Terminal](./file-workspace.md) | Browse and edit project files, run terminal commands |
| → [WebUI Remote Access](./webui.md) | Use Fello remotely from a browser |
| → [WeChat iLink](./wechat-ilink.md) | Chat with your Agent from WeChat anytime |
| → [Skills](./skills.md) | Install specialized skill packs to enhance the Agent |
| → [Permissions & Security](./permissions.md) | How Agent operations are permission-controlled |

# WeChat iLink

> 💬 **WeChat iLink** lets you connect Fello to WeChat and send/receive WeChat messages right from the desktop. You can forward WeChat conversations to an AI Agent for processing, or reply to WeChat messages through Fello.

## Feature Overview

- 📥 **Receive messages** — WeChat messages sync to Fello in real time, viewable in one place on the desktop
- 📤 **Send replies** — Reply to WeChat messages directly from Fello, with long text auto-split into segments

---

## Connecting WeChat

### Setup Steps

1. Open Fello → **Settings**
2. Find the **WeChat iLink** section
3. Click **Connect**
4. Scan the QR code that pops up with WeChat
5. Confirm the login on your phone

> 💡 **Note:** The login credentials are stored persistently, and the connection is restored automatically the next time Fello starts. To disconnect, click Disconnect in Settings.

---

## How to Use

### Setting the Active Session

After connecting WeChat, you need to assign an AI session to handle incoming WeChat messages:

1. In the left sidebar, right-click a session
2. Select **"Set as WeChat Active Session"**
3. The session will show a WeChat icon, indicating it's bound
4. Incoming WeChat messages are automatically injected into that session, and the Agent's replies are sent via WeChat

> 💡 **Switching the active session:** You can right-click another session anytime to reassign it. Only one session is active at a time. To unbind, use the "Unset WeChat Active" option in the right-click menu.

### Sending & Receiving Messages

| Feature | Description |
|------|------|
| Receiving messages | WeChat messages sync in real time to Fello's active session |
| Replying | The Agent's replies are sent back to the other party automatically via WeChat |
| Long text splitting | Replies over 2000 characters are auto-split before sending (WeChat limit) |
| Typing status | The other party sees a "typing" status while the Agent is processing |

### WeChat `!` Commands

Messages starting with `!` or `！` sent in WeChat are treated as commands. A command **interrupts the current Agent execution** (cancels an ongoing response immediately), then performs the corresponding action:

| Command | Function | Description |
|------|------|------|
| `!s` | **Switch session** | Lists all sessions (grouped by project); reply with a number to switch to that session |
| `!n` | **New session** | Lists all projects; reply with a number to create a new session under that project and switch to it |
| `!m` | **Switch model** | Lists the models available in the current session; reply with a number to switch (API Agent only) |
| `!q` | **Quick phrase** | Lists configured Snippets; reply with a number to send the corresponding content to the Agent |
| `!` | **View status** | Shows the current active session info (title, project, Agent, Features, MCP status) |

> 💡 **Interaction:** After running `!s`, `!n`, `!m`, or `!q`, you get a numbered list; just reply with the corresponding **number** to complete the action. For example, send `!s` and reply `2` to switch to the 2nd session.

> ⚡ **Interruption:** Any `!` command first cancels an ongoing Agent response, then executes the command. So even if you just want to interrupt the Agent, send any `!` message (e.g. `!stop`).

---

## Typical Use Cases

> 💡 **Core value: as long as Fello is running, you can collaborate with AI through WeChat anytime, anywhere.**

- 🚶 **Mobile work** — Let the Agent handle work while you're on the go; your phone is your remote terminal
- 🤖 **24/7 assistant** — Run Fello on a server and wake the Agent anytime via WeChat to execute tasks
- 👥 **Share with others** — Let WeChat friends chat directly with your Agent without installing any software

---

## Notes

> ⚠️ **Notes:**
> - iLink uses the WeChat web protocol, and **some WeChat accounts may not support web login** (a WeChat restriction)
> - Long periods of inactivity may drop the connection; rescan the QR code in Settings to reconnect
> - Follow WeChat usage guidelines and avoid sending large volumes of messages frequently to prevent account restrictions
> - Login credentials are stored locally and the connection restores automatically after restarting Fello

---

## 📖 Related Docs

| Doc | Related Info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: an introduction to WeChat integration |
| → [WebUI Remote Access](./webui.md) | Another way to use Fello remotely (browser) |
| → [Permissions & Security](./permissions.md) | The iLink active session uses Allow All mode by default |

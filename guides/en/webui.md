# WebUI Remote Access

> 🌐 **WebUI Remote Access** lets you use the full power of Fello from any browser on the same local network — no client installation needed. Phones, tablets, and other computers all work.

## How It Works

Fello Desktop ships with a built-in WebUI server. Once enabled, devices on the same network can access Fello's full interface through a browser, and all operations communicate with the desktop main process in real time over WebSocket.

---

## Starting the WebUI Service

### Option 1: Enable It in the Desktop Client

1. Open Fello → **Settings**
2. Find the **WebUI** section
3. Turn on the WebUI service switch
4. Configure the port number (auto-assigned by default)
5. Set the access Token (used for security verification)

| Setting | Default | Description |
|--------|-------|------|
| Port | Auto-assigned | The port the WebUI service listens on; customizable |
| Token | (Required) | Access password to prevent unauthorized access |

### Option 2: Deploy as a Server (Headless)

No desktop environment needed; ideal for Linux servers or CI environments.

```bash
# Run directly via npx (no installation required)
npx @zythum02/fello-server --port 9090 --token mysecret

# Or install globally and run
npm install -g @zythum02/fello-server
fello-server -p 9090 -t mysecret
```

| Parameter | Alias | Description |
|------|------|------|
| `--port` | `-p` | Listening port; auto-assigned by default |
| `--token` | `-t` | Access token; a random value is auto-generated if not set |

---

## Accessing in a Browser

Once the service is running, Fello shows the full access link (including the token). Open it in a browser on any device on the same local network:

```
http://<local-ip>:<port>/?token=<your-token>
```

> 💡 **Find your local IP:** On macOS, check System Settings → Wi-Fi → Details, or run `ifconfig | grep inet` in the terminal

---

## Features Supported by WebUI

| Feature | Supported | Notes |
|------|------|------|
| AI Chat | ✅ | Streaming responses, tool calls, permission interactions |
| File Workspace | ✅ | Browse, preview, and edit files |
| Terminal | ✅ | Create and use terminals |
| New Project/Session | ✅ | Full project and session management |
| MCP Server Switching | ✅ | Start and stop MCP servers dynamically |
| Settings Changes | ✅ | Agent, MCP, and other configurations |

---

## Use Cases

- 📱 **Mobile devices** — Check conversation progress or send commands anytime from your phone or tablet
- 💡 **Multi-screen collaboration** — Open Fello on another computer without reinstalling or reconfiguring
- 🐧 **Headless servers** — Run `fello-server` on a Linux server without a desktop and operate it remotely from a browser

---

## Security Notes

> ⚠️ **Security notes:**
> - **Token equals access** — Anyone who knows the token can fully operate Fello (file read/write, terminal execution, AI chat). Always use a strong string
> - **Local network only** — By default it binds to the local network IP; do not expose it to the public internet via port forwarding
> - **Plain HTTP** — The WebUI uses HTTP (not HTTPS), so traffic on the same network can be intercepted. Take extra care on public WiFi
> - **Turn it off when unused** — We recommend disabling the WebUI service when not in use to reduce the attack surface
> - **Clipboard limitations** — Under HTTP, browser paste is restricted (`navigator.clipboard` requires HTTPS); copying works, but the paste button is unavailable

---

## 📖 Related Docs

| Doc | Related Info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: an introduction to remote access |
| → [Permissions & Security](./permissions.md) | Details on the WebUI token's security mechanism |
| → [WeChat iLink](./wechat-ilink.md) | Another way to use Fello remotely |

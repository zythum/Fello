# WebUI Remote Access

> 🌐 **WebUI Remote Access** lets you use the full power of Fello from any browser on the same local network — no client installation needed. Phones, tablets, and other computers all work.

## How It Works

Fello Desktop ships with a built-in WebUI server. Once enabled, devices on the same network can access Fello's full interface through a browser, and all operations communicate with the desktop main process in real time over WebSocket. If you need access from outside the local network, you can add a public tunnel (see "Public Tunnels" below).

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

## Public Tunnels (devtunnel / ngrok)

When you need access from outside the local network (for example, from a phone on cellular data), you can put a public tunnel in front of the WebUI after enabling it. The access URL becomes a public HTTPS link. `devtunnel` and `ngrok` are independent — you can **run both at the same time**, or just one of them.

> ⚠️ A tunnel exposes the WebUI to the internet. Always use a strong token and only keep the tunnel open while you need it.

### Prerequisite: install and sign in to the CLI

Fello invokes the local `devtunnel` or `ngrok` command. A provider's switch is only enabled when the corresponding command is detected. Detection covers `PATH` plus common install locations such as Homebrew and `~/.dotnet/tools`. Click the `devtunnel` / `ngrok` name in Settings to open its official website for install and login instructions.

#### devtunnel (Microsoft Dev Tunnels)

| Platform | Install command |
|------|---------|
| macOS | `brew install devtunnel` |
| Windows | `winget install Microsoft.devtunnel` |
| Linux | `curl -sL https://aka.ms/DevTunnelCliInstall \| bash` |

Sign in once before the first use (hosting always requires a login, even with anonymous access):

```bash
devtunnel user login
```

Fello runs:

```bash
devtunnel host -p <webui-port> --allow-anonymous -l fello -d "Fello WebUI"
```

`--allow-anonymous` lets external devices connect without a Microsoft account; access is still protected by the WebUI token. `-l fello -d "Fello WebUI"` tags the tunnel so Fello can recognize its own: turning the switch off or quitting the app deletes that tunnel (other tunnels on the same account are untouched). If creation is blocked because the account's tunnel quota is full (10 per user), Fello first removes the oldest leftover Fello tunnel and retries.

#### ngrok

| Platform | Install command |
|------|---------|
| macOS | `brew install ngrok/ngrok/ngrok` |
| Windows | `winget install ngrok.ngrok` |
| Other | Download from [ngrok.com/download](https://ngrok.com/download) and add it to `PATH` |

Configure your authtoken once:

```bash
ngrok config add-authtoken <your-authtoken>
```

Fello runs:

```bash
ngrok http --log=stdout --log-format=json http://127.0.0.1:<webui-port>
```

### Starting a tunnel in Settings

1. Open Fello → **Settings → WebUI** and enable the WebUI service first
2. Check the **Public tunnel** section:
   - **Detected**: turn on the switch
   - **Not installed**: install the CLI as shown above, then click **Re-detect** in the section header
3. Turn on the switch in the card for `devtunnel` or `ngrok` (the other provider is unaffected and can be enabled at the same time)
4. Wait for that card's badge to change from "Starting…" to "Running"; the **Tunnel URL** (including the token) appears inside the same card
5. Click the copy button next to the URL and send the full link to the device that needs access

> 💡 Tunnel URLs look like `https://<tunnel-id>.devtunnels.ms/?token=<token>` or `https://<tunnel-id>.ngrok-free.dev/?token=<token>`. The `?token=` part is required, otherwise the WebUI rejects the request.

### Stopping a tunnel

- Turn off the switch in the provider's card (only that tunnel stops; the other keeps running). Turning it off while starting cancels the start
- devtunnel also deletes the tunnel it created, so no stale record is left on the service; the ngrok session is released when its process exits
- Or disable the WebUI service / quit Fello: all tunnels stop and their public URLs become invalid immediately; devtunnel is deleted as well

### Troubleshooting

| Symptom | Fix |
|------|---------|
| Shows "Not installed" | Make sure the CLI is installed and on `PATH`. Apps launched from Finder / the Start menu may not inherit your shell's full PATH; Fello also searches `/opt/homebrew/bin`, `/usr/local/bin`, `~/.dotnet/tools` and similar locations |
| devtunnel fails with a login message | Run `devtunnel user login` in a terminal first |
| devtunnel reports `Rate limit exceeded` | Usually not a login problem but the 10-tunnels-per-account limit: Fello removes the oldest leftover Fello tunnel (label `fello` + description `Fello WebUI`, no active host connection) and retries. If it still fails, run `devtunnel list` and delete unused tunnels with `devtunnel delete <tunnel-id>` |
| ngrok fails with an authtoken message | Run `ngrok config add-authtoken <token>` first |
| ngrok reports `endpoint ... already online` (`ERR_NGROK_334` / `ERR_NGROK_108`) | The account's static domain is already used by another ngrok process or another Fello instance: stop that session (`pkill ngrok`, or quit the other Fello) and retry. The free plan allows only one session per endpoint |
| The ngrok URL shows a warning page first | That is the free-plan traffic notice; click "Visit Site" to continue |
| The tunnel URL does not open | Make sure the WebUI is still running: the tunnel forwards the current WebUI port and stops when the WebUI stops |

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
> - **LAN by default** — The WebUI binds only to the local network by default. Avoid exposing it through untrusted port forwarding; use the built-in public tunnel for remote access
> - **Public tunnel = public exposure** — With devtunnel / ngrok enabled, anyone with the full tunnel URL (including the token) can operate Fello from the internet (file access, terminal commands, AI chat). If Fello runs on a company network, an office computer, or another sensitive environment, confirm your network and security policies before enabling it, and turn it off when you are done
> - **Plain HTTP** — Over a direct LAN connection the WebUI uses HTTP (not HTTPS), so traffic on the same network can be intercepted; a public tunnel URL is HTTPS (TLS terminates at the tunnel service). Take extra care on public WiFi
> - **Turn it off when unused** — We recommend disabling the WebUI service when not in use to reduce the attack surface
> - **Clipboard limitations** — Under HTTP, browser paste is restricted (`navigator.clipboard` requires HTTPS); copying works, but the paste button is unavailable. This does not apply when accessing through an HTTPS tunnel

---

## 📖 Related Docs

| Doc | Related Info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: an introduction to remote access |
| → [Permissions & Security](./permissions.md) | Details on the WebUI token's security mechanism |
| → [WeChat iLink](./wechat-ilink.md) | Another way to use Fello remotely |

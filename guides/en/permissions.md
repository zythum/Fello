# Permissions & Security

> 🛡️ **Fello's permission system** gives you full control over the AI Agent's behavior. Whenever the Agent needs to perform a sensitive operation (writing files, running commands, etc.), it requests your approval.

## Permission Mode

Fello offers two permission modes, chosen when creating a session:

- 🔒 **Ask mode (default)** — Prompts you each time the Agent requests a sensitive operation, so you approve them one by one. Ideal for scenarios requiring strict control.
- ⚡ **Allow All mode** — Automatically approves all permission requests, letting the Agent execute operations freely. Ideal for trusted Agents and fast iteration.

---

## Permission Request Flow

In Ask mode, when the Agent needs to perform a sensitive operation, Fello **forcibly interrupts the execution flow** and shows a permission confirmation dialog:

1. The Agent initiates a permission request (e.g., writing a file, running a command)
2. Fello shows the **Permission Required** dialog
3. The dialog displays the operation details and available policies
4. You choose to Allow or Deny

> 🔒 **Safety guarantees:**
> - **Blocking design** — The Agent pauses completely until it receives your reply and cannot bypass the permission check to continue
> - **Full transparency** — The dialog shows the complete tool name, operation type, and parameter details, so you can clearly see what the Agent intends to do
> - **Three choices** — "Allow once" approves only the current operation; "Always Allow" remembers authorization for that operation category; "Deny" blocks the operation and notifies the Agent
> - **Category-based management** — Permissions are granular by tool type (e.g., write_file, shell_exec), not by individual file. Always allowing "write file" means any file may be written

---

## "Always Allow" Memory

For operation types you trust, you can check **Always Allow**:

- Once checked, similar operations are approved automatically without prompting
- The memory persists in the session state and remains valid after a restart
- It applies only to the current session and does not affect other sessions

> 💡 **Example:** If you have always allowed the "write file" permission, the Agent can write any file later without prompting. However, "run command" will still be asked separately.

---

## Permission Request Queue

When the Agent sends multiple permission requests in a row, Fello queues them and presents them to you one at a time. You won't miss any permission request.

---

## Data Security

| Security Measure | Description |
|---------|------|
| Local data storage | All data is stored in the local `~/.fello/` directory and is not uploaded to the cloud |
| Process isolation | The renderer process has no direct Node access; system operations all go through restricted IPC into the main process |
| Local API Key storage | API keys are stored only in the local configuration file |
| WebUI Token verification | Remote access requires Token authentication |

### WebUI Token Authentication Mechanism

| Mechanism | Description |
|------|------|
| **First visit** | Must include `?token=xxx` in the URL; after the Token is verified, the server sets a Session Cookie |
| **Subsequent requests** | Authenticated automatically via the cookie (`fello_token`), no need to carry the Token each time |
| **Cookie lifecycle** | Session Cookie (no Max-Age) expires when the browser is closed; you need to revisit using the Token URL |

> ⚠️ **Security recommendations:**
> - **Use a strong Token** — Set a high-strength Token string when starting WebUI; avoid simple passwords
> - **Mind the network environment** — WebUI listens on the LAN by default. If exposed to the public internet, the Token is equivalent to full system access
> - **Turn it off when not in use** — Shut down the WebUI service promptly when it's not needed to reduce the attack surface
> - **Token equals access** — Anyone who knows the Token can fully control Fello (including file operations and terminal execution); do not share it with untrusted people

---

## Best Practices

> ✅ **Recommended practices:**
> - Use Ask mode with unfamiliar Agents, and decide whether to loosen restrictions after observing their behavior
> - For trusted local Agents (e.g., kiro-cli), you can use Allow All mode to improve efficiency
> - Regularly review the "Always Allow" list and remove permissions you no longer need
> - Use a strong Token for WebUI and shut down the service when not in use
> - For sensitive projects, use separate sessions to avoid permission memory crossing over

---

## 📖 Related Docs

| Doc | Related info |
|------|---------|
| ← [Quick Start](./quick-start.md) | Coming from here: understanding the permission system |
| → [WebUI Remote Access](./webui.md) | Details on the WebUI Token security mechanism |

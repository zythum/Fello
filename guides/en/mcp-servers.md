# MCP Servers

> 🔧 **MCP (Model Context Protocol)** gives your Agents access to additional tool capabilities. By configuring MCP servers, an Agent can query databases, call APIs, operate on the file system, and more — without modifying the Agent itself.

## What Is MCP

MCP is a standardized protocol that lets AI Agents dynamically discover and call external tools. Fello acts as an MCP client: it can connect to multiple MCP servers and inject the tools they provide into the Agent's capability set.

---

## MCP Server Types

| Type | How It Works | Use Case | Example |
|------|---------|---------|------|
| **Stdio** | Fello launches a local subprocess and communicates via stdin/stdout | Local tools, CLI wrappers | File search, Git operations |
| **HTTP** | Connects to remote services over HTTP/SSE | Remote services, team-shared tools | Database queries, API gateways |

---

## Add an MCP Server

1. Open Fello → **Settings**
2. Find the **MCP Servers** section
3. Click **Add MCP Server**
4. Choose a type (Stdio or HTTP) and fill in the configuration

### Stdio Type Configuration

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `filesystem` | Unique server identifier; only letters, numbers, underscores, and hyphens are allowed |
| **Command** | `npx` | The executable command that starts the MCP server |
| **Arguments** | `@modelcontextprotocol/server-filesystem /path/to/dir` | (Optional) Arguments passed to the command, space-separated |
| **Env vars (JSON)** | `{"NODE_ENV": "production"}` | (Optional) Environment variables in JSON object format |


### HTTP Type Configuration

| Field | Example Value | Description |
|------|-------|------|
| **ID** | `remote-tools` | Unique server identifier; only letters, numbers, underscores, and hyphens are allowed |
| **URL** | `http://localhost:3001/sse` | The HTTP/SSE endpoint of the MCP server |
| **Headers (JSON)** | `{"Authorization": "Bearer xxx"}` | (Optional) Custom request headers in JSON object format |



---

## Enable or Disable MCP Servers in a Session

MCP servers can be toggled on or off at any time during a session — no need to recreate it:

1. At the top of the conversation view, click the **⚙️ settings button** on the right
2. In the panel that opens, find the **MCP Servers** section
3. Toggle the MCP servers you want to enable or disable
4. Click **"Restart Session"** to apply the changes; the Agent will gain or lose the corresponding tool capabilities

> 💡 **Tip:** Different sessions can use different MCP server combinations. For example, enable Git tools for a coding session and database tools for a data analysis session.

---

## Recommended MCP Servers

### Exa: Web search, built for AI agents

For web search. API Agents have no web search tool by default — without configuring this, the Agent can't browse the web.

| Field | Value |
|------|-----|
| **Type** | HTTP |
| **ID** | `exa` |
| **URL** | `https://mcp.exa.ai/mcp` |

---

### Chrome DevTools: Browser Debugging and Automation

Lets the Agent connect to a Chrome browser for page inspection, DOM manipulation, network analysis, and performance debugging.

| Field | Value |
|------|-----|
| **Type** | Stdio |
| **ID** | `chrome-devtools` |
| **Command** | `npx` |
| **Arguments** | `-y chrome-devtools-mcp@latest --no-usage-statistics` |

---

### Computer Use: Desktop Control

Lets the Agent operate your computer like a human — moving the mouse, clicking, typing text, and taking screenshots.

| Field | Value |
|------|-----|
| **Type** | Stdio |
| **ID** | `computer-use` |
| **Command** | `npx` |
| **Arguments** | `-y @github/computer-use-mcp@latest` |

---

### Figma: Design File Reading and Collaboration

Lets the Agent read Figma design files and extract design tokens, component information, layout structures, and more.

| Field | Value |
|------|-----|
| **Type** | Stdio |
| **ID** | `figma` |
| **Command** | `npx` |
| **Arguments** | `-y figma-developer-mcp --figma-api-key=YOUR_API_KEY --stdio` |

> 💡 **Note:** The Figma MCP requires your Figma Personal Access Token. Go to Figma → Settings → Personal access tokens to generate one, then replace `YOUR_API_KEY`.

---

### Mijia Smart Home: IoT Device Control

Lets the Agent query and control your Xiaomi smart home devices (lights, air conditioners, robot vacuums, etc.).

| Field | Value |
|------|-----|
| **Type** | Stdio |
| **ID** | `mijia-api` |
| **Command** | `npx` |
| **Arguments** | `-y @zythum02/mijia-api@latest mcp` |

> 💡 **Learn more:** For the full MCP protocol spec and more community servers, see [modelcontextprotocol.io](https://modelcontextprotocol.io)

---

## Troubleshooting

| Issue | Solution |
|------|---------|
| MCP server fails to start | Check that the command path is correct and that dependencies are installed (e.g., the package invoked by npx) |
| Tool list is empty | Make sure the MCP server is enabled in the session, and check the server logs |
| HTTP connection timeout | Verify the URL is reachable and that the port isn't blocked by a firewall |

---

## 📖 Related Docs

| Doc | Related Info |
|------|---------|
| ← [Agent Configuration](./agents.md) | Configure the Agent first, then add MCP tools to it |
| → [Skills](./skills.md) | Both Skills and MCP are ways to extend Agent capabilities |
| → [Permissions & Security](./permissions.md) | MCP tool calls are also governed by the permission system |

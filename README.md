# Fello (Electron + React + Vite + Tailwind)

An ACP Client desktop app powered by Electron. The renderer is a React + Vite app with Tailwind CSS. Fello supports both local Stdio agents (via ACP) and remote OpenAI-compatible API agents, plus WeChat iLink integration for mobile access.

## Getting Started

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build

# Pack (platform-specific)
npm run pack:mac     # macOS
npm run pack:win     # Windows
npm run pack:linux   # Linux

# Preview the built app
npm run preview

# Lint / Type-check / Format
npm run lint
npm run typecheck
npm run format
```

## How HMR Works

When you run `npm run dev`:

1. **Vite dev server** starts on `http://localhost:5173` with HMR enabled
2. **Electron** starts and loads the renderer from the Vite dev server
3. Changes to React components update instantly without full page reload

Main/preload changes typically require restarting the dev process.

## Project Structure

```
├── src/
│   ├── shared/
│   │   └── schema.ts              # Typed IPC contracts & shared types
│   ├── agents/                    # Agent session logic (shared between backend & renderer)
│   │   ├── session-state.ts       # Session state creation (ACP + MCP tools)
│   │   ├── storage.ts             # API-agent session persistence
│   │   ├── openai-compatible-agent.ts # OpenAI-compatible Agent implementation
│   │   ├── mcp-tools.ts           # MCP session tools factory
│   │   ├── acp-client-tools.ts    # ACP client tools factory
│   │   ├── permission.ts          # Permission memory ("always allow")
│   │   ├── system-prompts.ts      # Base system prompt
│   │   └── utils.ts               # Content block conversion utilities
│   ├── backend/
│   │   ├── backend.ts             # Backend IPC handlers, FS, Terminal
│   │   ├── acp-bridge.ts          # ACP connection wrapper
│   │   ├── agent-terminal-manager.ts # Agent terminal process manager
│   │   ├── storage.ts             # Persistent storage & settings (JSON)
│   │   ├── utils.ts               # Backend utilities
│   │   ├── watcher.ts             # File system watcher
│   │   ├── webui.ts               # WebUI WebSocket & HTTP server
│   │   ├── skills.ts              # Skills catalog & skills.sh integration
│   │   ├── agents/                # Agent process spawners
│   │   │   ├── type.ts            # AgentProcess interface
│   │   │   ├── stdio-agent.ts     # Stdio agent (child_process spawn)
│   │   │   └── openai-compatible-api-agent.ts # API agent (in-process)
│   │   └── ilink/                 # WeChat iLink integration
│   │       ├── ilink-bridge.ts    # iLink connection & message bridge
│   │       ├── ilink-client.ts    # iLink HTTP API client
│   │       └── ilink-crypto.ts    # iLink crypto utilities
│   ├── electron/
│   │   ├── main.ts                # Electron main process
│   │   └── preload.ts             # Preload (contextBridge)
│   └── mainview/
│       ├── App.tsx                # React app root (ThemeProvider, MessageProvider & HashRouter)
│       ├── router.tsx             # Routing configuration (/settings, /skills, /session-view/:id)
│       ├── main.tsx               # React entry point
│       ├── store.ts               # Zustand state management
│       ├── lib/                   # Utilities (session-state-reducer.ts, chat-message.ts, etc.)
│       ├── components/            # UI components
│       │   ├── session/           # Chat, panel (Files/Terminal tabs), detail views
│       │   ├── settings/          # Settings pages (general, agents, MCP, WebUI, iLink)
│       │   ├── skills/            # Skills management (installed + skills.sh store)
│       │   ├── layout/            # Sidebar layout
│       │   ├── providers/         # Theme & Message context providers
│       │   ├── global/            # Error boundary, permission dialog, context menu
│       │   ├── welcome/           # Welcome/home page
│       │   ├── common/            # Reusable components (CodeView, ImageView, etc.)
│       │   ├── content-blocks/    # Multi-modal content renderers
│       │   └── ui/                # shadcn/base-ui primitive components
│       ├── backend.ts             # IPC client wrapper & WebSocket fallback for WebUI
│       ├── electron.ts            # Native Electron-only API wrapper
│       ├── i18n.ts                # i18next configuration
│       ├── locales/               # i18n translation files (en.json, zh-CN.json)
│       ├── index.html             # HTML template
│       └── index.css              # Tailwind CSS
├── electron.vite.config.ts        # electron-vite configuration
├── tools/                         # Build scripts (macOS icon generation)
├── icons/                         # Application icon resources
└── package.json
```

## Features

- **Dual Agent Types**: Local Stdio agents (ACP protocol, e.g. `kiro-cli acp`) and remote OpenAI-compatible API agents with streaming text, reasoning, and file content.
- **Per-Session Configuration**: Models, modes, and agent capabilities (`initializeInfo`) are persistent and isolated per session, ensuring a stable UI when switching between different contexts.
- **MCP Server Support**: Configure and toggle multiple Model Context Protocol (MCP) servers (both Stdio and HTTP) to extend agent capabilities dynamically within sessions.
- **WebUI Remote Access**: Expose the interface to a browser over the local network via WebSocket, enabling remote collaboration. (Enable in Settings > WebUI).
- **WeChat iLink**: Connect Fello to WeChat via iLink protocol for mobile interaction — receive messages and reply from WeChat directly through Fello.
- **Skills System**: Browse and install skills from skills.sh marketplace, with support for user-level and project-level scopes (fello/agents/claude).
- **Tool Permission Memory**: "Always allow" option for tool permissions, persisted per session to reduce repetitive approval dialogs.
- **Auto Session Titles**: New sessions automatically generate short descriptive titles based on the first user query.
- **Chat Attachments**: Attach images/files from the chat input (agent capability aware) with preview and drag-and-drop support.
- **Chat Timeline**: Jump between user messages using the timeline dots in the chat view.
- **Terminal Persistence**: Agent terminal outputs are automatically saved to the session directory and seamlessly restored when revisiting a session.
- **Tabbed Panel Layout**: Right-side panel with Files and Terminal tabs, switching seamlessly between file tree browsing and terminal management.
- **Fullscreen Support**: Toggle fullscreen mode for immersive coding sessions.

## Customizing

- **React components**: Edit files in `src/mainview/`
- **Routing**: Edit `src/mainview/router.tsx`
- **i18n Translation**: Edit `src/mainview/locales/*.json` and configure languages in `src/mainview/i18n.ts`
- **Window / app lifecycle**: Edit `src/electron/main.ts`
- **Backend logic**: Edit `src/backend/backend.ts` and `src/backend/acp-bridge.ts`
- **Renderer ↔ main bridge**: Edit `src/electron/preload.ts`, `src/mainview/backend.ts` and `src/mainview/electron.ts`
- **IPC types**: Edit `src/shared/schema.ts`
- **Agent implementations**: Edit `src/agents/openai-compatible-agent.ts` and `src/backend/agents/`
- **Build settings**: Edit `electron.vite.config.ts`

## Docs

See [docs/README.md](./docs/README.md).

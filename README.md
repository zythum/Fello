# Fello (Electron + React + Vite + Tailwind)

An ACP Client desktop app powered by Electron. The renderer is a React + Vite app with Tailwind CSS.

## Getting Started

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build

# Preview the built app
npm run preview
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
│   │   └── schema.ts       # Typed IPC contracts & Storage schemas
│   ├── backend/
│   │   ├── backend.ts      # Backend IPC handlers, FS, Terminal
│   │   ├── acp-bridge.ts   # ACP connection wrapper
│   │   ├── agent-terminal-manager.ts # Agent terminal process manager
│   │   ├── storage.ts      # Persistent storage & settings (JSON)
│   │   ├── utils.ts        # Backend utilities
│   │   ├── watcher.ts      # File system watcher
│   │   └── webui.ts        # WebUI WebSocket & HTTP server
│   ├── electron/
│   │   ├── main.ts         # Electron main process
│   │   └── preload.ts      # Preload (contextBridge)
│   └── mainview/
│       ├── App.tsx         # React app component (with MessageProvider & ThemeProvider)
│       ├── main.tsx        # React entry point
│       ├── components/     # UI components (bubbles, content-blocks, shadcn/ui, etc.)
│       ├── store.ts        # Zustand state management
│       ├── chat-message.ts # ChatMessage types and ContentBlock discriminators
│       ├── lib/            # Utilities (session-state-reducer.ts, etc.)
│       ├── components/common/ # Shared components (CodeView, CodeCompareView, ImageView)
│       ├── backend.ts      # IPC client wrapper & WebSocket fallback for WebUI
│       ├── electron.ts     # Native Electron-only API wrapper
│       ├── i18n.ts         # i18next configuration
│       ├── locales/        # i18n translation files (en.json, zh-CN.json)
│       ├── index.html      # HTML template
│       └── index.css       # Tailwind CSS
├── electron.vite.config.ts # electron-vite configuration
└── package.json
```

## Features

- **Local AI Collaboration**: Connect to local agents via ACP (e.g. `kiro-cli acp`).
- **WebUI Remote Access**: Expose the interface to a browser over the local network via WebSocket, enabling remote collaboration. (Enable in Settings > WebUI).

## Customizing

- **React components**: Edit files in `src/mainview/`
- **i18n Translation**: Edit `src/mainview/locales/*.json` and configure languages in `src/mainview/i18n.ts`
- **Window / app lifecycle**: Edit `src/electron/main.ts`
- **Backend logic**: Edit `src/backend/backend.ts` and `src/backend/acp-bridge.ts`
- **Renderer ↔ main bridge**: Edit `src/electron/preload.ts`, `src/mainview/backend.ts` and `src/mainview/electron.ts`
- **IPC types**: Edit `src/shared/schema.ts`
- **Settings & Storage**: Modify `SettingsMeta` schema in `src/backend/storage.ts` and `src/shared/schema.ts`
- **Build settings**: Edit `electron.vite.config.ts`

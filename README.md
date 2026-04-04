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
│   ├── electron/
│   │   ├── main.ts         # Electron main process
│   │   ├── preload.ts      # Preload (contextBridge)
│   │   ├── ipc-schema.ts   # Typed IPC contracts
│   │   └── storage.ts      # Persistent storage & settings (JSON)
│   └── mainview/
│       ├── App.tsx         # React app component
│       ├── main.tsx        # React entry point
│       ├── i18n.ts         # i18next configuration
│       ├── locales/        # i18n translation files (en.json, zh-CN.json)
│       ├── index.html      # HTML template
│       └── index.css       # Tailwind CSS
├── electron.vite.config.ts # electron-vite configuration
└── package.json
```

## Customizing

- **React components**: Edit files in `src/mainview/`
- **i18n Translation**: Edit `src/mainview/locales/*.json` and configure languages in `src/mainview/i18n.ts`
- **Window / app lifecycle**: Edit `src/electron/main.ts`
- **Renderer ↔ main bridge**: Edit `src/electron/preload.ts` and `src/mainview/backend.ts`
- **IPC types**: Edit `src/electron/ipc-schema.ts`
- **Settings & Storage**: Modify `SettingsMeta` schema in `src/electron/storage.ts` and `src/electron/ipc-schema.ts`
- **Build settings**: Edit `electron.vite.config.ts`

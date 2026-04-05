## Automation Expectations

- Before finishing a coding task, run: npm run typecheck, npm run lint. Run npm run format only when you changed code formatting or added new files.
- Keep docs in sync when changes are meaningful (architecture, project structure, tech stack, conventions). Otherwise do not change docs.

## Code Conventions

- Indentation: 2 spaces, no tabs.
- UI: prefer existing shadcn/ui components over custom markup when possible.
- Language & i18n: All user-facing UI text MUST be extracted to locale files (`src/mainview/locales/`) using `react-i18next` (`useTranslation`). Do not use hardcoded strings in components.

## Repo Structure

- Backend logic: src/backend (backend.ts, acp-bridge.ts, ipc-schema.ts, storage.ts)
- Electron code: src/electron (main.ts, preload.ts)
- Renderer code: src/mainview (React + Vite)

## Automation Expectations

- Before finishing a coding task, run: npm run typecheck, npm run lint. Run npm run format only when you changed code formatting or added new files.
- Keep docs in sync when changes are meaningful (architecture, project structure, tech stack, conventions). Otherwise do not change docs.

## Code Conventions

- Indentation: 2 spaces, no tabs.
- UI: prefer existing shadcn/ui components over custom markup when possible.
- Language: all user-facing UI text must be English.

## Repo Structure

- Backend logic: src/backend (backend.ts, acp-bridge.ts, ipc-schema.ts, storage.ts)
- Electron code: src/electron (main.ts, preload.ts)
- Renderer code: src/mainview (React + Vite)

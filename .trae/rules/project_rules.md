## Automation Expectations

- Before finishing a coding task, run: npm run typecheck, npm run lint. Run npm run format only when you changed code formatting or added new files.
- Keep docs in sync when changes are meaningful (architecture, project structure, tech stack, conventions). Otherwise do not change docs.

## Code Conventions

- Indentation: 2 spaces, no tabs.
- UI: prefer existing shadcn/ui components over custom markup when possible.
- Language & i18n: All user-facing UI text MUST be extracted to locale files (`src/mainview/locales/`) using `react-i18next` (`useTranslation`). Do not use hardcoded strings in components.
- Backend: All backend code MUST be stateless.
- Mainview: Code MUST be compatible with both Electron and Web UI environments. Any UI element that invokes Electron-specific native APIs (i.e., `electron.xxx` methods like `revealInFinder` or `trashFile`) MUST be hidden when running in Web UI mode (`isWebUI === true`).
- Path Handling: To ensure cross-platform compatibility (especially on Windows), all IPC interfaces must accept and return POSIX-style paths (`/`) for relative project paths. The only exception is `getSystemFilePath`, which is specifically designed to return the native OS path format (e.g., `\` on Windows).
- ACP Protocol Adherence: This project is an ACP (`https://agentclientprotocol.com/`) client, using `@agentclientprotocol/sdk` as the protocol specification. All feature development MUST adhere to the ACP protocol. If a proposed feature conflicts with the ACP protocol, you MUST raise concerns and initiate a discussion before proceeding.
- ACP Integration: When interacting with the underlying ACP service (Agent process), you MUST use `session.resumeId` instead of `session.id`. The ACP interface declaration often names its parameter `sessionId`, which can easily be confused with Fello's own `session.id`. Remember: ACP side's `sessionId` === Fello side's `session.resumeId`.

## Repo Structure

- Backend logic: src/backend (backend.ts, acp-bridge.ts, ipc-schema.ts, storage.ts)
- Electron code: src/electron (main.ts, preload.ts)
- Renderer code: src/mainview (React + Vite)

## Documentation

- Refer to the documentation in the `docs` directory to understand the project.
- Rules Maintenance: When adding new rules to `project_rules.md`, maintain a consistent description style and language with the existing document.

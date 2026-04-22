## Automation Expectations

- Finish task: run `npm run typecheck` and `npm run lint`; run `npm run format` only if needed.
- Update docs only for meaningful architecture/structure/stack changes.

## Code Conventions

- Indentation: 2 spaces, no tabs.
- UI: prefer existing shadcn/ui components.
- i18n: no hardcoded UI text; use `react-i18next` + locale files in `src/mainview/locales/`.
- Backend must be stateless.
- TypeScript: prefer `unknown` over `any`, `satisfies` over `as`.
- Mainview supports Electron + Web UI; hide Electron-native actions when `isWebUI === true`.
- IPC relative paths use POSIX (`/`); only `getSystemFilePath` may return OS-native paths.
- Follow ACP (`@agentclientprotocol/sdk`); if conflicts appear, raise first.
- ACP `sessionId` = `session.resumeId`.

## Repo Structure

- Backend `src/backend`; Electron `src/electron`; Renderer `src/mainview`.

## Documentation

- Refer to `docs/`; keep new `project_rules.md` entries consistent in style/language.

# Fello — Developer Guide / 开发者指南

**For users:** [README.md](./README.md) / [README.zh-CN.md](./README.zh-CN.md) and the [User Manual](./guides/en/README.md) / [用户手册](./guides/zh-CN/README.md).

**For developers:** this guide covers building, customizing, and contributing to Fello.

**使用者请阅读** [README.md](./README.md) / [README.zh-CN.md](./README.zh-CN.md) 与 [用户手册](./guides/zh-CN/README.md) / [User Manual](./guides/en/README.md)。

**开发者请阅读**本文档（构建、自定义与参与贡献）。

---

## Quick Start / 快速开始

```bash
# Install dependencies
# 安装依赖
npm install

# Launch in development mode
# 启动开发模式
npm run dev

# Build for production
# 构建生产版本
npm run build

# Package for your platform
# 打包为桌面应用
npm run pack:mac     # macOS
npm run pack:win     # Windows
npm run pack:linux   # Linux

# Package as npm package (headless server)
# 打包为 npm 包（无头服务器）
npm run pack:npm     # → npm-package/
```

> 💡 `npm install` 会通过 `postinstall` 自动下载 tree-sitter WASM 语法文件；如需手动下载可执行 `npm run download:grammars`。

---

## Project Scripts / 常用脚本

| Script | Description / 说明 |
|--------|-------------------|
| `npm run dev` | Development with HMR / 带 HMR 的开发模式 |
| `npm run build` | Production build (includes server bundle) / 生产构建（含服务器 bundle） |
| `npm run preview` | Preview built app / 预览构建产物 |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | TypeScript checking / TypeScript 类型检查 |
| `npm run format` | Format with oxfmt |
| `npm run pack:npm` | Build npm package → `npm-package/` / 构建 npm 包 |
| `npm run pack:mac` / `pack:win` / `pack:linux` | Package desktop app / 打包桌面应用 |
| `npm run prepare:icon:mac` | Generate macOS app icons / 生成 macOS 应用图标 |
| `npm run download:grammars` | Download tree-sitter WASM grammars / 下载 tree-sitter WASM 语法文件 |

---

## How HMR Works / HMR 原理

`npm run dev` starts:

1. **Vite dev server** on `http://localhost:6234` with HMR enabled
2. **Electron** loads the renderer from the Vite dev server
3. React components update instantly without full page reload

Main/preload changes typically require restarting the dev process.

---

## Headless Server (npm package) / 无头服务器

Run Fello as a pure Node.js server — no Electron, no display required. Perfect for Linux servers or CI environments.
以纯 Node.js 服务器方式运行 Fello —— 无需 Electron、无需显示器，适合 Linux 服务器或 CI 环境。

```bash
# Via npx (no install needed)
# 通过 npx 直接运行（无需安装）
npx @zythum02/fello-server --port 9090 --token mysecret

# Or install globally
# 或全局安装
npm install -g @zythum02/fello-server
fello-server -p 9090 -t mysecret

# Package locally
# 本地打包
npm run pack:npm
cd npm-package
npm publish --access public
```

The server serves the same WEBUI frontend over HTTP/WebSocket, with full session/agent/file/terminal support.
服务器通过 HTTP/WebSocket 提供与桌面端相同的 WEBUI，支持完整的会话 / Agent / 文件 / 终端功能。

### WEBUI Authentication / WEBUI 认证

When accessing the WEBUI in a browser:

1. Visit the provided URL with `?token=xxx` (e.g. `http://192.168.1.100:9090/?token=abc123`)
2. The server validates the token and sets a **session cookie** (`fello_token`)
3. Subsequent requests (JS, CSS, WebSocket, project files) authenticate via cookie
4. Page requests (`/`) always require `?token=` in the URL — cookie alone is not accepted for initial page loads
5. The cookie is a session cookie (no `Max-Age`), cleared when the browser closes

This means each browser session needs the token URL once; refreshing the page works as long as the browser is open.

### Clipboard in HTTP / HTTP 下的剪贴板

`navigator.clipboard` requires a secure context (HTTPS). When accessing WEBUI over plain HTTP, the app automatically falls back to `document.execCommand("copy")` for copy operations. Paste requires `navigator.clipboard.readText()` which has no HTTP fallback — the paste button is hidden when the API is unavailable.

---

## Tech Stack / 技术栈

- **Desktop Shell**: Electron
- **Renderer**: React + Vite + Tailwind CSS
- **AI Protocol**: [ACP (Agent Client Protocol)](https://agentclientprotocol.com/) SDK + AI SDK
- **State Management**: Zustand
- **i18n**: i18next + react-i18next
- **Terminal**: xterm.js + node-pty
- **Build**: electron-vite + electron-builder

---

## Project Structure / 项目结构

```
├── src/
│   ├── shared/               # Typed IPC contracts & shared types
│   ├── agents/               # Agent session logic (ACP + MCP tools, permissions, system prompts)
│   ├── backend/              # IPC handlers, FS, Terminal, WebUI, Skills
│   │   ├── agent/            # Agent bridge and session coordination
│   │   ├── automation/       # Cron scheduling & task execution
│   │   └── ilink/            # WeChat iLink integration
│   ├── electron/             # Electron main process
│   ├── server/               # Headless server entry point (npm package)
│   ├── scripts/              # Preload, MCP servers, workers
│   │   ├── electron-preload/ # Context bridge preload
│   │   ├── mcp-*/            # Built-in MCP server scripts
│   │   └── worker-*/         # Worker scripts (file outline, ripgrep)
│   └── mainview/             # React app (components, routing, store, i18n, styles)
├── docs/                     # Architecture, guides, conventions
├── tools/                    # Build scripts
└── icons/                    # App icons
```

---

## Customization Points / 自定义入口

| What / 目标 | Where to Edit / 修改位置 |
|------|---------------|
| React components | `src/mainview/` |
| Routing | `src/mainview/router.tsx` |
| i18n translations | `src/mainview/locales/*.json` |
| Window / lifecycle | `src/electron/main.ts` |
| Backend logic | `src/backend/backend.ts` + `src/backend/agent/agent-bridge.ts` |
| IPC bridge | `src/scripts/electron-preload/preload.ts`, `src/mainview/backend.ts` |
| IPC types | `src/shared/schema.ts`, `src/shared/constants.ts`, `src/shared/zod/` |
| Agent implementations | `src/agents/` + `src/backend/agent/` |
| Build config | `electron.vite.config.ts` |

---

## Developer Documentation / 开发文档

See [docs/](./docs/README.md) for architecture and internals.
架构与内部实现细节请参阅 [docs/](./docs/README.md)。

- [Overview](./docs/overview.md)
- [Tech Stack](./docs/tech-stack.md)
- [Architecture](./docs/architecture.md)
- [Project Structure](./docs/project-structure.md)
- [Coding Conventions](./docs/coding-conventions.md)
- [Custom Events](./docs/custom-events.md)
- [IPC Protocol](./docs/ipc-protocol.md)
- [Socket Server](./docs/socket-server.md)
- [Built-in ACP Tools](./docs/builtin-tools.md)
- [Skills](./docs/skills.md)
- [Ask User](./docs/ask-user.md)
- [Automation](./docs/automation.md)
- [Project Memory](./docs/memory.md)
- [Storage & Data](./docs/storage.md)

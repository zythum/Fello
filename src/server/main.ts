import "./env";
import { initBackend } from "../backend/backend";
import { version } from "../../package.json";

// ── Parse CLI arguments ─────────────────────────────────────────────
let port: number | undefined;
let token: string | undefined;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[++i], 10);
  } else if (args[i] === "--token" || args[i] === "-t") {
    token = args[++i];
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(version);
    process.exit(0);
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Fello Server — standalone headless server without Electron

Usage: node out/server/main.js [options]

Options:
  -p, --port <number>     HTTP server port (default: random available port)
  -t, --token <string>    Authentication token (default: auto-generated)
  -v, --version           Show version number
  -h, --help              Show this help
`);
    process.exit(0);
  }
}

// ── Initialize backend ─────────────────────────────────────────────
const { backendHandlers, closeBackend } = initBackend(() => false);

// ── Start WEBUI HTTP/WS server ─────────────────────────────────────
backendHandlers
  .startWebUIServer({ port, token })
  .then(({ url }) => {
    const title = `Fello Server v${version}`;
    const pad = 4;
    const inner = title.length + pad * 2;
    console.log("");
    console.log(`  ╔${"═".repeat(inner)}╗`);
    console.log(`  ║${" ".repeat(pad)}${title}${" ".repeat(pad)}║`);
    console.log(`  ╚${"═".repeat(inner)}╝`);
    console.log(`  🖥️  WEBUI: ${url}`);
    console.log("");
  })
  .catch((err) => {
    console.error("[Fello] Failed to start server:", err);
    process.exit(1);
  });

// ── Graceful shutdown ──────────────────────────────────────────────
async function shutdown() {
  console.log("\n[Fello] Shutting down...");
  await backendHandlers.stopWebUIServer();
  await closeBackend().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

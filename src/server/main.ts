import { initBackend, clearBackend } from "../backend/backend";
import { startWebUI, stopWebUI } from "../backend/webui";

// ── Parse CLI arguments ─────────────────────────────────────────────
let port: number | undefined;
let token: string | undefined;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[++i], 10);
  } else if (args[i] === "--token" || args[i] === "-t") {
    token = args[++i];
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Fello Server — standalone headless server without Electron

Usage: node out/server/main.js [options]

Options:
  -p, --port <number>     HTTP server port (default: random available port)
  -t, --token <string>    Authentication token (default: auto-generated)
  -h, --help              Show this help
`);
    process.exit(0);
  }
}

// ── Initialize backend ─────────────────────────────────────────────
// The emitter function sends events to an Electron renderer — in server
// mode there is none, so we pass a noop. WebSocket clients still receive
// events via broadcastWebUIEvent (called inside initBackend's sendEvent).
initBackend(() => false);

// ── Start WEBUI HTTP/WS server ─────────────────────────────────────
startWebUI({ port, token })
  .then(({ url }) => {
    console.log("");
    console.log("  ╔══════════════════════════════════════╗");
    console.log("  ║          Fello Server                ║");
    console.log("  ╚══════════════════════════════════════╝");
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
  stopWebUI();
  await clearBackend().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

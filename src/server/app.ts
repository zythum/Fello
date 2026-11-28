/**
 * Headless server 业务主体（由 `./main` 动态 import）。
 *
 * `process.scriptsPath` / `rendererPath` / `treeSitterWasmPath` 由薄入口 `./main`
 * 先 import `./env` 设置好；本模块不再重复 import，否则打包时 `env` 会被提升到
 * 共享 chunk，`import.meta.dirname` 变成 `out/server/assets`，路径全部算错。
 */
import { initBackend } from "../backend/backend";
import { applyProxy, detectSystemProxy, settingProxyInfoToProxyConfig } from "../backend/proxy";
import { storageOps } from "../backend/storage";
import { version } from "../../package.json";
import { cli } from "./cli";

// ── Apply proxy as early as possible ──────────────────────────────
// 必须在任何网络请求 / 子进程 spawn 之前执行（undici dispatcher +
// http/https globalAgent + process.env，子进程自动继承）。
// system 模式：detectSystemProxy 为同步实现，启动早期一次探测完整生效。
const proxySettings = storageOps.getSettings().proxy;
if (proxySettings.mode === "system") {
  const detected = detectSystemProxy();
  applyProxy(detected);
  console.log(`[proxy] system proxy: ${detected.httpProxy || detected.httpsProxy || "none"}`);
} else {
  applyProxy(settingProxyInfoToProxyConfig(proxySettings));
}

// ── Initialize backend ─────────────────────────────────────────────
const { backendHandlers, closeBackend } = initBackend(() => false);

// ── Start WEBUI HTTP/WS server ─────────────────────────────────────
backendHandlers
  .startWebUIServer({ port: cli.port, token: cli.token }, { transport: "internal" })
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
  await backendHandlers.stopWebUIServer(undefined, { transport: "internal" });
  await closeBackend().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

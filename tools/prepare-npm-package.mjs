#!/usr/bin/env node

import { readFileSync, writeFileSync, cpSync, rmSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const npmDir = join(root, "npm-package");

// ── Clean previous output ──────────────────────────────────────────
if (existsSync(npmDir)) {
  rmSync(npmDir, { recursive: true });
}

// ── Copy build outputs ─────────────────────────────────────────────
const outDir = join(root, "out");

// Server entry
mkdirSync(join(npmDir, "out", "server"), { recursive: true });
cpSync(join(outDir, "server", "main.js"), join(npmDir, "out", "server", "main.js"));

// MCP scripts (skills + ask-user)
cpSync(join(outDir, "scripts"), join(npmDir, "out", "scripts"), { recursive: true });

// WEBUI frontend (renderer)
cpSync(join(outDir, "renderer"), join(npmDir, "out", "renderer"), { recursive: true });

// Tree-sitter WASM resources (required for GetFileOutline tool)
const resourcesDir = join(root, "resources");
mkdirSync(join(npmDir, "resources"), { recursive: true });
cpSync(join(resourcesDir, "tree-sitter-wasm"), join(npmDir, "resources", "tree-sitter-wasm"), { recursive: true });

// ── Generate package.json ──────────────────────────────────────────
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Dependencies the server actually uses at runtime (exclude Electron-only)
// 外设栈（BLE / HID）只在 Electron 主进程装配，headless server 不加载：
// unified-ble-manager 约 25MB，node-hid / recovery 是原生模块，都不该拖进发布包。
const excludeDeps = new Set([
  "electron-updater",
  "fix-path",
  "unified-ble-manager",
  "node-hid",
  "darwin-corebluetooth-connected-peripherals-recovery",
]);
const deps = {};
for (const [key, val] of Object.entries(rootPkg.dependencies)) {
  if (!excludeDeps.has(key)) {
    deps[key] = val;
  }
}

const npmPkg = {
  name: "@zythum02/fello-server",
  version: rootPkg.version,
  description: "Fello Server — standalone headless AI agent server",
  type: "module",
  bin: {
    "fello-server": "./out/server/main.js",
  },
  files: ["out", "resources"],
  engines: {
    node: ">=22",
  },
  dependencies: deps,
  license: rootPkg.license,
  author: rootPkg.author,
  repository: rootPkg.repository,
  bugs: rootPkg.bugs,
  homepage: rootPkg.homepage,
};

writeFileSync(join(npmDir, "package.json"), JSON.stringify(npmPkg, null, 2) + "\n");

// ── Copy LICENSE and README ────────────────────────────────────────
try {
  cpSync(join(root, "LICENSE"), join(npmDir, "LICENSE"));
} catch {
  /* ignore */
}
try {
  cpSync(join(root, "README.md"), join(npmDir, "README.md"));
} catch {
  /* ignore */
}

console.log("");
console.log(`  📦 npm package ready at ${npmDir}`);
console.log(`  📛 name:    ${npmPkg.name}@${npmPkg.version}`);
console.log(`  🚀 bin:     fello-server`);
console.log("");

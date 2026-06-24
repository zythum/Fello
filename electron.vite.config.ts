import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import compression from "vite-plugin-compression";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, "src/electron/main.ts"),
      },
      outDir: "out/electron",
    },
  },
  preload: {
    build: {
      lib: {
        entry: {
          "electron-preload/preload": resolve(__dirname, "src/scripts/electron-preload/preload.ts"),
          "mcp-skills/server": resolve(__dirname, "src/scripts/mcp-skills/server.ts"),
          "mcp-ask-user/server": resolve(__dirname, "src/scripts/mcp-ask-user/server.ts"),
          "mcp-share-to-user/server": resolve(__dirname, "src/scripts/mcp-share-to-user/server.ts"),
          "mcp-search/server": resolve(__dirname, "src/scripts/mcp-search/server.ts"),
          "worker-file-outline/worker": resolve(__dirname, "src/scripts/worker-file-outline/worker.ts"),
        },
      },
      outDir: "out/scripts",
    },
  },
  renderer: {
    root: "src/mainview",
    plugins: [
      react(),
      compression({
        algorithm: "brotliCompress",
        ext: ".br",
        threshold: 1024,
        compressionOptions: { level: 11 },
      }),
      compression({
        algorithm: "gzip",
        ext: ".gz",
        threshold: 1024,
        compressionOptions: { level: 9 },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/mainview"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/mainview/index.html"),
      },
      outDir: "out/renderer",
      emptyOutDir: true,
    },
    server: {
      port: 6234,
      strictPort: true,
    },
  },
});

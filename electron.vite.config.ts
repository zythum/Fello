import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { compression, defineAlgorithm } from "vite-plugin-compression2";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { constants as zlibConstants } from "zlib";

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
          "mcp-memory/server": resolve(__dirname, "src/scripts/mcp-memory/server.ts"),
          "mcp-memo/server": resolve(__dirname, "src/scripts/mcp-memo/server.ts"),
          "mcp-image-generation/server": resolve(__dirname, "src/scripts/mcp-image-generation/server.ts"),
          "mcp-toolbox/server": resolve(__dirname, "src/scripts/mcp-toolbox/server.ts"),
          "worker-file-outline/worker": resolve(__dirname, "src/scripts/worker-file-outline/worker.ts"),
          "worker-ripgrep/worker": resolve(__dirname, "src/scripts/worker-ripgrep/worker.ts"),
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
        include: /\.(js|mjs|json|css|html)$/i,
        threshold: 1024,
        algorithms: [
          defineAlgorithm("brotliCompress", {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
          }),
          defineAlgorithm("gzip", { level: 9 }),
        ],
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
      rolldownOptions: {
        input: resolve(__dirname, "src/mainview/index.html"),
      },
      outDir: "out/renderer",
      emptyOutDir: true,
    },
    optimizeDeps: {
      exclude: ["@silurus/ooxml"],
    },
    server: {
      port: 6234,
      strictPort: true,
    },
  },
});

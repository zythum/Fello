import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
          "mcp-bmi/server": resolve(__dirname, "src/scripts/mcp-bmi/server.ts"),
          "mcp-skills/server": resolve(__dirname, "src/scripts/mcp-skills/server.ts"),
        },
      },
      outDir: "out/scripts",
    },
  },
  renderer: {
    root: "src/mainview",
    plugins: [react()],
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
      port: 5173,
      strictPort: true,
    },
  },
});

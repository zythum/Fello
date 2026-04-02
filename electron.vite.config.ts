import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "src/electron/main.ts"),
      },
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "src/electron/preload.ts"),
      },
      outDir: "out/preload",
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
      outDir: "../../out/renderer",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  },
});

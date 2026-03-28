import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: "src/mainview",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/mainview"),
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: {
      external: ["electrobun/view"],
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

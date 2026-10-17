import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    ssr: "src/server/main.ts",
    outDir: "out/server",
    target: "node20",
    minify: false,
    emptyOutDir: true,
    rolldownOptions: {
      // Equivalent to esbuild's `--packages=external`: keep every bare import external.
      external: (id: string) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
      output: {
        entryFileNames: "main.js",
        format: "esm",
        banner: "#!/usr/bin/env node",
      },
    },
  },
  ssr: {
    external: true,
  },
});

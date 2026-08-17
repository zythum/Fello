import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages project site: https://zythum.github.io/Fello/
// base must match the canonical repo name (case-sensitive).
export default defineConfig({
  base: "/Fello/",
  plugins: [react(), tailwindcss()],
  server: {
    // Allow importing assets from the repo root (screenshots/, icons/)
    fs: {
      allow: [".."],
    },
  },
});

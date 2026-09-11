import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "ui",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve("ui/src"),
    },
  },
  build: {
    outDir: resolve("dist/ui"),
    emptyOutDir: true,
  },
});

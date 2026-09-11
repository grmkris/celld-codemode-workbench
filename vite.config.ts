import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "ui",
  build: {
    outDir: resolve("dist/ui"),
    emptyOutDir: true,
  },
});

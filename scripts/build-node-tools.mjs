import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));

const targets = [
  { entry: "supervisor/src/index.ts", outfile: "dist/supervisor/index.mjs" },
  { entry: "runner/src/main.ts", outfile: "dist/runner/runner.mjs" },
];

for (const target of targets) {
  mkdirSync(dirname(join(root, target.outfile)), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: [target.entry],
    outfile: target.outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    logLevel: "info",
    external: ["dockerode"],
  });
  console.log(`built ${target.outfile}`);
}

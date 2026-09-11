import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const outdir = join(root, "test-results");
mkdirSync(outdir, { recursive: true });

const started = Date.now();
const result = await build({
  absWorkingDir: root,
  entryPoints: ["worker/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  write: false,
  logLevel: "silent",
  external: ["cloudflare:*", "module", "sucrase", "fs", "path", "url"],
  loader: { ".wasm": "binary" },
});
const elapsedMs = Date.now() - started;
const bytes = result.outputFiles.reduce((sum, file) => sum + file.contents.byteLength, 0);
const report = {
  entry: "worker/index.ts",
  bytes,
  kib: Number((bytes / 1024).toFixed(1)),
  outputs: result.outputFiles.length,
  elapsedMs,
  note: "esbuild Worker bundle including Effect. WASM is inlined as binary for this measurement only; celld compiles WASM separately.",
};
writeFileSync(join(outdir, "bundle.json"), JSON.stringify(report, null, 2));
console.log(`worker bundle ${report.kib} KiB in ${elapsedMs} ms`);

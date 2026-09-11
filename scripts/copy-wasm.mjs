import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
const source = join(
  root,
  "node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm",
);
const targets = [
  join(root, "worker/vendor/emscripten-module.wasm"),
  join(root, "ui/public/emscripten-module.wasm"),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`copied release-sync wasm -> ${target}`);
}

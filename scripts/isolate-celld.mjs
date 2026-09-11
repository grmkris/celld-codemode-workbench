import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * celld dev stores state in PROJECT/.celld/dev and resolves PROJECT from the
 * Wrangler config path. A config symlink (or a cwd inside the repo .celld tree)
 * makes two nodes share one lease and SELF-FENCE each other.
 *
 * Isolates live outside the application checkout. wrangler.jsonc and
 * package.json are real copies so path resolution cannot escape.
 */
export function defaultIsolateRoot(port, label = "test") {
  return (
    process.env.CELLD_ISOLATE_ROOT ??
    process.env.CELLD_TEST_WATCH ??
    join(tmpdir(), `celld-codemode-${label}-${port}-${process.pid}`)
  );
}

export function prepareIsolateRoot(projectRoot, isolateRoot) {
  mkdirSync(isolateRoot, { recursive: true });
  for (const name of ["worker", "dist", "shared", "node_modules"]) {
    const from = join(projectRoot, name);
    const to = join(isolateRoot, name);
    if (!existsSync(from) || existsSync(to)) continue;
    symlinkSync(from, to);
  }
  for (const name of ["package.json", "wrangler.jsonc"]) {
    copyFileSync(join(projectRoot, name), join(isolateRoot, name));
  }
  return isolateRoot;
}

export function celldDevArgs(
  project,
  { host = "127.0.0.1", port, clean = false, watch = true } = {},
) {
  const args = ["dev", project, "--host", host, "--port", String(port), "--logs"];
  if (!watch) args.push("--no-watch");
  if (clean) args.push("--clean");
  return args;
}

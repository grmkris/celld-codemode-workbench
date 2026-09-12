import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const browserIsolate =
  process.env.CELLD_ISOLATE_ROOT ?? join(tmpdir(), "celld-codemode-browser-9889");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.CELLD_BASE_URL ?? "http://127.0.0.1:9889",
    trace: "off",
  },
  webServer: process.env.CELLD_BASE_URL
    ? undefined
    : {
        command: "node scripts/dev.mjs",
        env: {
          ...process.env,
          CELLD_PORT: "9889",
          CELLD_VAR_AUTH_FIXTURE: "1",
          MODEL_PROVIDER: "fixture",
          CELLD_ISOLATE_ROOT: browserIsolate,
          CELLD_DEV_CLEAN: "1",
          CELLD_NO_WATCH: "1",
          CELLD_SHUTDOWN_TOTAL_MS: "3000",
          CELLD_SHUTDOWN_DRAIN_MS: "1000",
          CELLD_DRAIN_TOKEN_WAIT_MS: "0",
        },
        url: "http://127.0.0.1:9889/health",
        reuseExistingServer: false,
        timeout: 90_000,
        gracefulShutdown: {
          signal: "SIGTERM",
          timeout: 5_000,
        },
      },
});

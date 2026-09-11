import type { IsolateDriver } from "@tanstack/ai-code-mode";
import { runEffectHostProbe } from "./host/probe";
import { configureQuickJSWasm, createFuelQuickJSDriver, getLastIsolateStats } from "./isolate";
import { LIMITS } from "../shared/limits";
import wasmModule from "./vendor/emscripten-module.wasm";

configureQuickJSWasm(wasmModule);

interface ProbeResult {
  name: string;
  passed: boolean;
  detail: unknown;
}

type CaseFn = (execute: (code: string) => Promise<unknown>) => Promise<unknown>;

const CASES: Record<string, CaseFn> = {
  "structured-result": async (execute) => {
    const result = await execute(`return { ok: true, n: 1 + 2 }`);
    if (!(result as { success: boolean }).success) throw new Error("expected success");
    return result;
  },
  "async-host-combine": async (execute) => {
    const result = await execute(`
      const a = await external_host_echo({ x: 1 });
      const b = await external_host_delay({ ms: 20 });
      return { a, b, sum: 3 };
    `);
    if (!(result as { success: boolean }).success) throw new Error(JSON.stringify(result));
    return result;
  },
  "error-then-reuse": async (execute) => {
    const failed = await execute(`throw new Error("guest-boom")`);
    const ok = await execute(`return { recovered: true }`);
    if ((failed as { success: boolean }).success) throw new Error("first should fail");
    if (!(ok as { success: boolean }).success) throw new Error("second should succeed");
    return { failed, ok };
  },
  "sync-infinite-loop": async (execute) => {
    const result = await execute(`for (;;) {}`);
    if ((result as { success: boolean }).success) throw new Error("loop was not interrupted");
    return result;
  },
  recursion: async (execute) => {
    const result = await execute(`
      function rec(n) { return rec(n + 1); }
      return rec(0);
    `);
    if ((result as { success: boolean }).success) throw new Error("recursion was not bounded");
    return result;
  },
  "microtask-loop": async (execute) => {
    const result = await execute(`
      await new Promise(() => {
        const spin = () => { Promise.resolve().then(spin); };
        spin();
      });
    `);
    if ((result as { success: boolean }).success) throw new Error("microtask loop escaped");
    return result;
  },
  "interrupt-observed": async (execute) => {
    const result = await execute(`
      let n = 0;
      for (let i = 0; i < 250000; i++) n += 1;
      return n;
    `);
    const stats = getLastIsolateStats();
    if (stats.interruptCalls < 1) {
      throw new Error("interrupt handler was never invoked on this runtime");
    }
    return { result, stats };
  },
  "allocation-and-logs": async (execute) => {
    const logs = await execute(`
      for (let i = 0; i < 200; i++) console.log("n".repeat(200));
      return 1;
    `);
    if ((logs as { success: boolean }).success) {
      throw new Error("log budget was not enforced");
    }
    const oversized = await execute(`return "z".repeat(40000)`);
    if ((oversized as { success: boolean }).success) {
      throw new Error("oversized result was not contained");
    }
    const alloc = await execute(`
      const chunks = [];
      for (let i = 0; i < 80; i++) chunks.push("x".repeat(400000));
      return chunks.length;
    `);
    return { alloc, logs, oversized };
  },
  "stalled-host-and-unauthorized": async (execute) => {
    const stalled = await execute(`return await external_host_delay({ ms: 8000 })`);
    const denied = await execute(`return await external_host_secret({})`);
    if ((stalled as { success: boolean }).success) {
      throw new Error("stalled host was not timed out");
    }
    if ((denied as { success: boolean }).success) {
      throw new Error("unauthorized host action succeeded");
    }
    return { stalled, denied };
  },
  "no-host-escape": async (execute) => {
    const result = await execute(`
      const keys = Object.getOwnPropertyNames(globalThis);
      return {
        keys,
        hasProcess: typeof process !== "undefined",
        hasRequire: typeof require !== "undefined",
        hasDeno: typeof Deno !== "undefined",
        hasFetch: typeof fetch !== "undefined",
        hasCelld: typeof celld !== "undefined",
      };
    `);
    const value = (result as { value?: Record<string, unknown> }).value ?? {};
    if (value.hasProcess || value.hasRequire || value.hasDeno || value.hasCelld) {
      throw new Error(`guest escaped: ${JSON.stringify(value)}`);
    }
    return result;
  },
};

async function runCase(driver: IsolateDriver, name: string, fn: CaseFn): Promise<ProbeResult> {
  const context = await driver.createContext({
    timeout: 2_000,
    memoryLimit: LIMITS.isolateMemoryMb,
    bindings: {
      external_host_echo: {
        name: "external_host_echo",
        description: "Echo",
        inputSchema: { type: "object" },
        execute: async (args) => ({ echoed: args, at: Date.now() }),
      },
      external_host_delay: {
        name: "external_host_delay",
        description: "Delay",
        inputSchema: { type: "object" },
        execute: async (args) => {
          const ms = Number((args as { ms?: number }).ms ?? 50);
          await new Promise((resolve) => setTimeout(resolve, ms));
          return { delayed: ms };
        },
      },
      external_host_secret: {
        name: "external_host_secret",
        description: "Unauthorized",
        inputSchema: { type: "object" },
        execute: async () => {
          throw new Error("unauthorized host action");
        },
      },
    },
  });
  try {
    const detail = await fn((code) => context.execute(code));
    return { name, passed: true, detail };
  } catch (error) {
    return {
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.dispose();
  }
}

export async function runContainmentProbes(only?: string): Promise<{
  passed: boolean;
  clock: { dateNowFrozenHint: number; fuelRequired: true; lastInterruptCalls?: number };
  results: ProbeResult[];
}> {
  const driver = createFuelQuickJSDriver({
    timeout: 2_000,
    memoryLimit: 8,
    budget: { ticks: 12_000, hostCalls: 8, logBytes: 2048, resultBytes: 4096 },
  });
  const dateBefore = Date.now();
  let tight = 0;
  for (let i = 0; i < 50_000; i += 1) tight += i;
  const dateAfter = Date.now();
  const names = only ? [only] : Object.keys(CASES);
  const results: ProbeResult[] = [];
  for (const name of names) {
    const fn = CASES[name];
    if (!fn) {
      results.push({ name, passed: false, detail: "unknown case" });
      continue;
    }
    results.push(await runCase(driver, name, fn));
  }
  return {
    passed: results.every((item) => item.passed),
    clock: {
      dateNowFrozenHint: dateAfter - dateBefore,
      fuelRequired: true,
      lastInterruptCalls: getLastIsolateStats().interruptCalls,
    },
    results,
  };
}

export class ProbeCell {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const started = Date.now();
    const selected = url.searchParams.get("case") ?? undefined;
    if (selected === "effect-host") {
      const report = await runEffectHostProbe();
      return Response.json({
        ...report,
        elapsedMs: Date.now() - started,
        runtime: "celld",
      });
    }
    if (selected === "load") {
      const driver = createFuelQuickJSDriver({ timeout: 2_000, memoryLimit: 8 });
      const context = await driver.createContext({ bindings: {} });
      const result = await context.execute("return { loaded: true }");
      await context.dispose();
      return Response.json({
        passed: result.success,
        result,
        elapsedMs: Date.now() - started,
        runtime: "celld",
      });
    }
    const report = await runContainmentProbes(selected);
    return Response.json({
      ...report,
      elapsedMs: Date.now() - started,
      runtime: "celld",
    });
  }
}

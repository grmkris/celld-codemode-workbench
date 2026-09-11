import { describe, expect, it } from "vitest";
import { createFuelQuickJSDriver } from "../../worker/isolate";

describe("fuel-budget QuickJS driver", () => {
  it("returns a structured result and then recovers after a throw", async () => {
    const driver = createFuelQuickJSDriver({ timeout: 2000, budget: { ticks: 200_000 } });
    const context = await driver.createContext({
      bindings: {
        external_add: {
          name: "external_add",
          description: "add",
          inputSchema: { type: "object" },
          execute: async (args) => {
            const value = args as { a: number; b: number };
            return value.a + value.b;
          },
        },
      },
    });
    const ok = await context.execute(`
      const n = await external_add({ a: 2, b: 3 });
      return { n };
    `);
    expect(ok.success).toBe(true);
    expect(ok.value).toEqual({ n: 5 });
    const failed = await context.execute(`throw new Error("guest")`);
    expect(failed.success).toBe(false);
    const again = await context.execute(`return { recovered: true }`);
    expect(again.success).toBe(true);
    await context.dispose();
  });

  it("interrupts a tight synchronous loop with fuel, not a Promise.race", async () => {
    const driver = createFuelQuickJSDriver({
      timeout: 30_000,
      budget: { ticks: 20_000 },
    });
    const context = await driver.createContext({ bindings: {} });
    const started = Date.now();
    const result = await context.execute("for (;;) {}");
    const elapsed = Date.now() - started;
    expect(result.success).toBe(false);
    expect(result.error?.name === "TimeoutError" || result.error?.message).toBeTruthy();
    expect(elapsed).toBeLessThan(10_000);
    await context.dispose();
  });

  it("interrupts a promise/microtask storm with a shared job budget", async () => {
    const driver = createFuelQuickJSDriver({
      timeout: 30_000,
      budget: { ticks: 8_000 },
    });
    const context = await driver.createContext({ bindings: {} });
    const started = Date.now();
    const result = await context.execute(`
      await new Promise(() => {
        const spin = () => { Promise.resolve().then(spin); };
        spin();
      });
    `);
    const elapsed = Date.now() - started;
    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
    await context.dispose();
  });
});

import {
  wrapCode,
  type ExecutionResult,
  type IsolateContext,
  type IsolateDriver,
  type IsolateConfig,
  type NormalizedError,
  type ToolBinding,
} from "@tanstack/ai-code-mode";
import {
  getQuickJS,
  newQuickJSWASMModule,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSSyncVariant,
  type VmCallResult,
} from "quickjs-emscripten";
import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
// @ts-expect-error vendor Emscripten browser loader has no types
import browserLoader from "./vendor/quickjs-loader.mjs";
import { LIMITS } from "../shared/limits";

export const TIMEOUT_ERROR = "TimeoutError";
const MEMORY_LIMIT_ERROR = "MemoryLimitError";
const STACK_OVERFLOW_ERROR = "StackOverflowError";
const JOB_SLICE = 16;
const MAX_JOB_SLICES = 2_048;

export interface FuelBudget {
  ticks: number;
  hostCalls: number;
  logBytes: number;
  resultBytes: number;
  concurrentHostCalls: number;
}

export interface ExecState {
  fuelRemaining: number;
  pendingCancels: Set<() => void>;
  hostCalls: number;
  inFlightHostCalls: number;
  logBytes: number;
  cancelled: boolean;
  interruptCalls: number;
}

export interface IsolateStats {
  interruptCalls: number;
  fuelRemaining: number;
}

let lastIsolateStats: IsolateStats = { interruptCalls: 0, fuelRemaining: 0 };

export function getLastIsolateStats(): IsolateStats {
  return lastIsolateStats;
}

const DEFAULT_BUDGET: FuelBudget = {
  ticks: LIMITS.isolateFuelTicks,
  hostCalls: LIMITS.hostCallsPerExecution,
  logBytes: LIMITS.logBytes,
  resultBytes: LIMITS.resultBytes,
  concurrentHostCalls: LIMITS.concurrentHostCalls,
};

function timeoutError(message = "Code execution interrupted by fuel budget"): Error {
  const error = new Error(message);
  error.name = TIMEOUT_ERROR;
  return error;
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    const msg = error.message;
    const lower = msg.toLowerCase();
    if (
      lower.includes("out of memory") ||
      lower.includes("memory alloc") ||
      (error.name === "InternalError" && lower.includes("memory"))
    ) {
      return {
        name: MEMORY_LIMIT_ERROR,
        message: "Code execution exceeded memory limit",
        stack: error.stack,
      };
    }
    if (lower.includes("stack overflow")) {
      return {
        name: STACK_OVERFLOW_ERROR,
        message: "Code execution exceeded stack size limit",
        stack: error.stack,
      };
    }
    if (error.name === "InternalError" && lower.includes("interrupted")) {
      return {
        name: TIMEOUT_ERROR,
        message: "Code execution interrupted by fuel or deadline",
        stack: error.stack,
      };
    }
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;
    const name = String(errObj.name || "Error");
    const message = String(errObj.message || "Unknown error");
    if (name === "InternalError" && message.toLowerCase().includes("interrupted")) {
      return { name: TIMEOUT_ERROR, message: "Code execution interrupted by fuel or deadline" };
    }
    return { name, message };
  }
  return { name: "UnknownError", message: String(error) };
}

function isFatal(error: NormalizedError): boolean {
  return error.name === MEMORY_LIMIT_ERROR || error.name === STACK_OVERFLOW_ERROR;
}

let modulePromise: Promise<Awaited<ReturnType<typeof getQuickJS>>> | undefined;
let configuredWasm: WebAssembly.Module | undefined;

export function configureQuickJSWasm(wasmModule: WebAssembly.Module): void {
  configuredWasm = wasmModule;
  modulePromise = undefined;
}

async function loadQuickJS() {
  if (!modulePromise) {
    modulePromise = (async () => {
      if (configuredWasm) {
        // Celld's node compat makes the default Emscripten loader take a
        // Node/fs path and hang. Use the browser loader plus the compiled
        // WASM module import (celld compiles .wasm at deploy time).
        const variant: QuickJSSyncVariant = {
          ...RELEASE_SYNC,
          importModuleLoader: async () => browserLoader,
        };
        return await newQuickJSWASMModule(newVariant(variant, { wasmModule: configuredWasm }));
      }
      return await getQuickJS();
    })();
  }
  return modulePromise;
}

/**
 * Pump guest microtasks in bounded slices. executePendingJobs(-1) will run
 * forever if the guest keeps scheduling Promise.resolve().then(...).
 * Fuel is shared with the WASM interrupt handler so nested jobs cannot reset
 * the budget.
 *
 * Do not call Date.now() here: celld freezes host clocks during synchronous
 * WASM, and a clock read from an interrupt/import callback has hung the
 * isolate in practice.
 */
function pumpPendingJobs(vm: QuickJSContext, execState: ExecState, logs: string[]): void {
  let slices = 0;
  while (vm.runtime.alive && vm.runtime.hasPendingJob()) {
    if (execState.cancelled || execState.fuelRemaining <= 0) {
      throw timeoutError();
    }
    const jobs = vm.runtime.executePendingJobs(JOB_SLICE);
    if (jobs.error) {
      const dumped = vm.dump(jobs.error);
      jobs.error.dispose();
      throw dumped;
    }
    execState.fuelRemaining -= JOB_SLICE;
    slices += 1;
    if (slices >= MAX_JOB_SLICES) {
      throw timeoutError("Code execution exceeded pending-job slice budget");
    }
  }
}

async function invokeBinding(
  binding: ToolBinding,
  argsJson: string,
  execState: ExecState,
  budget: FuelBudget,
  timeoutMs: number,
): Promise<string> {
  if (execState.cancelled) {
    return JSON.stringify({ success: false, error: "Execution cancelled" });
  }
  if (execState.hostCalls >= budget.hostCalls) {
    return JSON.stringify({
      success: false,
      error: `Host call budget exceeded (${budget.hostCalls})`,
    });
  }
  if (execState.inFlightHostCalls >= budget.concurrentHostCalls) {
    return JSON.stringify({
      success: false,
      error: `Concurrent host call budget exceeded (${budget.concurrentHostCalls})`,
    });
  }
  execState.hostCalls += 1;
  execState.inFlightHostCalls += 1;
  try {
    const args = JSON.parse(argsJson);
    const result = await Promise.race([
      binding.execute(args),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Host call timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const encoded = JSON.stringify({ success: true, value: result });
    if (encoded.length > budget.resultBytes) {
      return JSON.stringify({
        success: false,
        error: `Host result exceeded ${budget.resultBytes} bytes`,
      });
    }
    return encoded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ success: false, error: message.slice(0, 512) });
  } finally {
    execState.inFlightHostCalls -= 1;
  }
}

function injectBinding(
  vm: QuickJSContext,
  name: string,
  binding: ToolBinding,
  logs: string[],
  execState: ExecState,
  budget: FuelBudget,
  timeoutMs: number,
): void {
  const toolFn = vm.newFunction(name, (argsHandle) => {
    const argsJson = vm.getString(argsHandle);
    const promise = vm.newPromise();
    const resolveWithPayload = (payloadJson: string) => {
      execState.pendingCancels.delete(cancel);
      if (!vm.alive || !promise.alive) return;
      const payloadHandle = vm.newString(payloadJson);
      promise.resolve(payloadHandle);
      payloadHandle.dispose();
    };
    const cancel = () =>
      resolveWithPayload(JSON.stringify({ success: false, error: "Execution interrupted" }));
    execState.pendingCancels.add(cancel);
    void invokeBinding(binding, argsJson, execState, budget, timeoutMs).then(resolveWithPayload);
    void promise.settled.then(() => {
      try {
        if (vm.runtime.alive) {
          pumpPendingJobs(vm, execState, logs);
        }
      } catch (error) {
        execState.cancelled = true;
        logs.push(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        promise.dispose();
      }
    });
    return promise.handle;
  });
  vm.setProp(vm.global, `__${name}_impl`, toolFn);
  toolFn.dispose();
  const wrapper = vm.evalCode(`
    async function ${name}(input) {
      const resultJson = await __${name}_impl(JSON.stringify(input ?? {}));
      const result = JSON.parse(resultJson);
      if (!result.success) throw new Error(result.error);
      return result.value;
    }
  `);
  if (wrapper.error) {
    const dumped = vm.dump(wrapper.error);
    wrapper.error.dispose();
    throw new Error(`Failed to bind ${name}: ${JSON.stringify(dumped)}`);
  }
  wrapper.value.dispose();
}

class FuelIsolateContext implements IsolateContext {
  private execQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private executing = false;

  constructor(
    private readonly vm: QuickJSContext,
    private readonly logs: string[],
    private readonly timeout: number,
    private readonly execState: ExecState,
    private readonly budget: FuelBudget,
  ) {}

  async execute<T = unknown>(code: string): Promise<ExecutionResult<T>> {
    if (this.disposed) {
      return {
        success: false,
        error: { name: "DisposedError", message: "Context has been disposed" },
        logs: [],
      };
    }
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.execQueue;
    this.execQueue = turn;
    await previous;
    if (this.disposed) {
      release();
      return {
        success: false,
        error: { name: "DisposedError", message: "Context has been disposed" },
        logs: [],
      };
    }

    this.executing = true;
    this.logs.length = 0;
    this.execState.cancelled = false;
    this.execState.hostCalls = 0;
    this.execState.inFlightHostCalls = 0;
    this.execState.logBytes = 0;
    this.execState.fuelRemaining = this.budget.ticks;
    this.execState.interruptCalls = 0;
    let guestSettled = true;

    const fail = async (error: unknown, terminal = false): Promise<ExecutionResult<T>> => {
      const normalized = normalizeError(error);
      lastIsolateStats = {
        interruptCalls: this.execState.interruptCalls,
        fuelRemaining: this.execState.fuelRemaining,
      };
      if (normalized.name === TIMEOUT_ERROR || isFatal(normalized) || terminal) {
        this.disposed = true;
        this.execState.cancelled = true;
        for (const cancel of Array.from(this.execState.pendingCancels)) cancel();
        this.execState.pendingCancels.clear();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (guestSettled || isFatal(normalized)) {
          try {
            this.vm.dispose();
          } catch {
            // already torn down
          }
        }
      }
      return { success: false, error: normalized, logs: this.logs.slice(0, LIMITS.logLines) };
    };

    try {
      const wrapped = wrapCode(code);
      const evaluated = this.vm.evalCode(wrapped);
      const promiseHandle = this.vm.unwrapResult(evaluated);
      const nativePromise = this.vm.resolvePromise(promiseHandle);
      promiseHandle.dispose();
      guestSettled = false;
      void nativePromise.then(
        () => {
          guestSettled = true;
        },
        () => {
          guestSettled = true;
        },
      );
      pumpPendingJobs(this.vm, this.execState, this.logs);
      // Host-side timer is valid after we yield (I/O advances celld clocks).
      // It is not the synchronous-loop bound; fuel is.
      const resolved = await awaitWithTimeout(nativePromise, this.timeout);
      const valueHandle = this.vm.unwrapResult(resolved);
      const dumped = this.vm.dump(valueHandle);
      valueHandle.dispose();
      const parsed = typeof dumped === "string" ? safeParse(dumped) : dumped;
      const encoded = JSON.stringify(parsed ?? null);
      lastIsolateStats = {
        interruptCalls: this.execState.interruptCalls,
        fuelRemaining: this.execState.fuelRemaining,
      };
      if (encoded.length > this.budget.resultBytes) {
        return {
          success: false,
          error: {
            name: "ResultLimitError",
            message: `Result exceeded ${this.budget.resultBytes} bytes`,
          },
          logs: this.logs.slice(0, LIMITS.logLines),
        };
      }
      return { success: true, value: parsed as T, logs: this.logs.slice(0, LIMITS.logLines) };
    } catch (error) {
      return await fail(error);
    } finally {
      this.executing = false;
      release();
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.executing) await this.execQueue;
    if (this.disposed) return;
    this.disposed = true;
    this.execState.cancelled = true;
    for (const cancel of Array.from(this.execState.pendingCancels)) cancel();
    this.execState.pendingCancels.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.vm.dispose();
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function awaitWithTimeout(
  promise: Promise<VmCallResult<QuickJSHandle>>,
  timeoutMs: number,
): Promise<VmCallResult<QuickJSHandle>> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError("Code execution timed out"));
    }, timeoutMs);
    promise.then(
      (result) => {
        if (timedOut) {
          try {
            if ("error" in result && result.error) result.error.dispose();
            else result.value.dispose();
          } catch {
            // ignore
          }
          return;
        }
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createFuelQuickJSDriver(
  options: {
    timeout?: number;
    memoryLimit?: number;
    maxStackSize?: number;
    budget?: Partial<FuelBudget>;
  } = {},
): IsolateDriver {
  const timeout = options.timeout ?? LIMITS.executionTimeoutMs;
  const memoryLimit = (options.memoryLimit ?? LIMITS.isolateMemoryMb) * 1024 * 1024;
  const maxStackSize = options.maxStackSize ?? LIMITS.isolateStackBytes;
  const budget: FuelBudget = { ...DEFAULT_BUDGET, ...options.budget };

  return {
    async createContext(config: IsolateConfig): Promise<IsolateContext> {
      const QuickJS = await loadQuickJS();
      const vm = QuickJS.newContext();
      vm.runtime.setMemoryLimit(memoryLimit);
      vm.runtime.setMaxStackSize(maxStackSize);
      const logs: string[] = [];
      const execState: ExecState = {
        fuelRemaining: budget.ticks,
        pendingCancels: new Set(),
        hostCalls: 0,
        inFlightHostCalls: 0,
        logBytes: 0,
        cancelled: false,
        interruptCalls: 0,
      };

      const consoleObj = vm.newObject();
      const makeLogger = (prefix: string) =>
        vm.newFunction(`console.${prefix || "log"}`, (...args) => {
          const message =
            (prefix ? `${prefix}: ` : "") + args.map((arg) => vm.getString(arg)).join(" ");
          execState.logBytes += message.length;
          if (logs.length >= LIMITS.logLines || execState.logBytes > budget.logBytes) {
            throw vm.newError("Log budget exceeded");
          }
          logs.push(message);
        });
      const logFn = makeLogger("");
      const errorFn = makeLogger("ERROR");
      const warnFn = makeLogger("WARN");
      const infoFn = makeLogger("INFO");
      vm.setProp(consoleObj, "log", logFn);
      vm.setProp(consoleObj, "error", errorFn);
      vm.setProp(consoleObj, "warn", warnFn);
      vm.setProp(consoleObj, "info", infoFn);
      vm.setProp(vm.global, "console", consoleObj);
      logFn.dispose();
      errorFn.dispose();
      warnFn.dispose();
      infoFn.dispose();
      consoleObj.dispose();

      for (const [name, binding] of Object.entries(config.bindings)) {
        injectBinding(vm, name, binding, logs, execState, budget, LIMITS.hostCallTimeoutMs);
      }

      // Fuel is the only synchronous bound. Do not read Date.now() or
      // performance.now() from this callback: celld keeps those clocks
      // frozen during sync JS/WASM, and a clock import from the interrupt
      // path has failed to return on the real runtime.
      vm.runtime.setInterruptHandler(() => {
        execState.interruptCalls += 1;
        if (execState.cancelled) return true;
        if (execState.fuelRemaining <= 0) return true;
        execState.fuelRemaining -= 1;
        return false;
      });

      return new FuelIsolateContext(vm, logs, config.timeout ?? timeout, execState, budget);
    },
  };
}

export function remainingBudget(state: ExecState, budget: FuelBudget): FuelBudget {
  return {
    ticks: Math.max(0, state.fuelRemaining),
    hostCalls: Math.max(0, budget.hostCalls - state.hostCalls),
    logBytes: Math.max(0, budget.logBytes - state.logBytes),
    resultBytes: budget.resultBytes,
    concurrentHostCalls: budget.concurrentHostCalls,
  };
}

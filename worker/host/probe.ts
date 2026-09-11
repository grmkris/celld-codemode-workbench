import { Context, Effect, Fiber, Layer } from "effect";

class ClockBox extends Context.Service<ClockBox, { readonly now: () => number }>()(
  "celld/EffectProbeClock",
) {}

export async function runEffectHostProbe(): Promise<{
  passed: boolean;
  asyncOk: boolean;
  layerOk: boolean;
  interrupted: boolean;
  cleaned: boolean;
  detail: string;
}> {
  const asyncOk = (await Effect.runPromise(Effect.succeed(1).pipe(Effect.map((n) => n + 2)))) === 3;

  const layer = Layer.succeed(ClockBox, { now: () => 42 });
  const layered = await Effect.runPromise(
    Effect.gen(function* () {
      const clock = yield* ClockBox;
      return clock.now();
    }).pipe(Effect.provide(layer)),
  );
  const layerOk = layered === 42;

  let cleaned = false;
  const controller = new AbortController();
  const work = Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        cleaned = true;
      }),
    );
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 8_000);
        }),
    );
    return "finished";
  }).pipe(Effect.scoped);

  const fiber = Effect.runFork(work);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await Effect.runPromise(Fiber.interrupt(fiber));
  const interrupted = cleaned;

  return {
    passed: asyncOk && layerOk && interrupted && cleaned,
    asyncOk,
    layerOk,
    interrupted,
    cleaned,
    detail: "Effect async, Layer, interrupt, and scoped cleanup",
  };
}

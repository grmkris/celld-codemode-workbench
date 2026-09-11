import { Effect } from "effect";
import type { Store } from "../store";
import type { HostContext } from "../capabilities";
import { toHostError, type HostFault } from "./faults";
import { hostContext, type Journal, type Policy, type RunIdentity } from "./services";

export async function runHost<A>(
  effect: Effect.Effect<A, HostFault, RunIdentity | Policy | Journal>,
  store: Store,
  ctx: HostContext,
): Promise<A> {
  try {
    return await Effect.runPromiseWith(hostContext(store, ctx))(effect, {
      signal: ctx.abortSignal,
    });
  } catch (error) {
    throw toHostError(error);
  }
}

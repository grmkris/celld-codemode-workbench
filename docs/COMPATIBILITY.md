# Compatibility

Recorded against this checkout on 2026-09-12 (start of `feat/team-agent-platform`).

| Component                              | Version                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| celld                                  | 0.4.1 (`celld --version`)                                            |
| Node                                   | 24.9.0 (dev tooling only)                                            |
| @tanstack/ai                           | 0.54.0                                                               |
| @tanstack/ai-code-mode                 | 0.4.9                                                                |
| @tanstack/ai-isolate-quickjs           | 0.3.1                                                                |
| @tanstack/ai-openai                    | 0.22.6                                                               |
| @tanstack/ai-grok                      | 0.18.5                                                               |
| @tanstack/ai-sandbox                   | 0.5.7                                                                |
| @tanstack/ai-sandbox-docker            | 0.3.2                                                                |
| @tanstack/ai-sandbox-local-process     | 0.2.5                                                                |
| @tanstack/ai-claude-code               | 0.6.5                                                                |
| @tanstack/ai-codex                     | 0.5.5                                                                |
| @tanstack/ai-grok-build                | 0.5.5                                                                |
| @tanstack/ai-opencode                  | 0.4.5                                                                |
| @tanstack/db                           | 0.9.0                                                                |
| @tanstack/react-db                     | 0.3.8                                                                |
| @durable-streams/client                | 0.2.7                                                                |
| @durable-streams/server                | 0.3.9                                                                |
| @durable-streams/state                 | 0.3.2                                                                |
| @durable-streams/tanstack-ai-transport | 0.0.10                                                               |
| better-auth                            | 1.7.4                                                                |
| kysely                                 | 0.28.8                                                               |
| dockerode                              | 4.0.2                                                                |
| quickjs-emscripten                     | 0.31.0                                                               |
| @jitl/quickjs-wasmfile-release-sync    | 0.31.0                                                               |
| zod                                    | 4.6.2 (TanStack Code Mode needs `~standard.jsonSchema`; 4.1.5 threw) |
| effect                                 | 4.0.0-rc.115                                                         |
| oxlint                                 | 1.82.0                                                               |
| oxfmt                                  | 0.67.0                                                               |
| typescript                             | 5.9.2                                                                |
| shadcn chatbot-template                | `f79416827acd90244683903a34343f58193432ac` (MIT)                     |

## Baseline verification (Stage A)

- `npm run check`: PASS (format, lint, typecheck, build, 20 unit tests)
- `npm run test:celld`: **40/41 PASS**, live-provider-smoke **UNRUN**
- Containment probes `sync-infinite-loop` and `microtask-loop`: PASS
- Starting commit before platform work: `d0ceda4` on `feat/team-agent-platform`

## Stage F–G (coordinator + docs/CI)

- Code Mode capabilities: `resources_list_eligible`, `delegation_submit`,
  `delegation_inspect`, `delegation_cancel`, `artifacts_list`, `artifacts_read`
- Command kinds: `cancel_task`, `stop_all` (conversation-scoped)
- Agent schema v4: `inbox` table for deduped coordinator wakes
- Task schema v2: `source_cell_key`, harness metadata on delegated tasks
- Runner profiles: `fixture`, `claude-code`, `codex`, `grok-build`, `opencode` (all live UNRUN)
- CI jobs: `streams` sidecar smoke, `supervisor` build smoke; `AUTH_FIXTURE=1` on celld/browser

## Identifier library decision

`@just-be/effect-typed-id@0.5.0` resolves with a single `effect@4.0.0-rc.115`
install and a compatible peer range (`^4.0.0-beta.90`), but **fails at runtime**
on this Effect RC: `Schema.TaggedErrorClass is not a function` (the library
expects an API that this RC does not export; `Schema.TaggedError` exists instead).

**Outcome: not adopted.** Domain IDs use native Effect 4 `Brand` keys with
runtime prefix/`uuid` validation in `shared/ids.ts`. Stream offsets remain
opaque (`StreamOffset`) and separate from entity IDs. Existing chat/agent
addresses are not rekeyed.

## Dependency notes

- Removed `@shadcn/helpers` (peerOptional conflict with `@tanstack/ai-client`;
  only used by the DEV preview fixture, which now uses static messages).
- `overrides` pin optional `vitest` peers of `@tanstack/ai-sandbox` /
  `@tanstack/ai-persistence` to the project's `3.2.4` so `npm install` succeeds
  without `--force` / `--legacy-peer-deps`.

## APIs actually used

- **celld**: Worker `fetch`, Durable Objects, `new_sqlite_classes`,
  `ctx.storage.sql`, `setAlarm` / `alarm()`, `ctx.waitUntil`,
  `blockConcurrencyWhile`, static assets (`directory`, `binding`,
  `not_found_handling`, `run_worker_first`), WASM module imports.
- **TanStack AI**: `chat`, `toolDefinition`, `maxIterations`, `EventType`.
- **TanStack Code Mode**: `createCodeMode` → `execute_typescript` with input
  field **`typescriptCode`** (not `code`), `external_*` bindings, `wrapCode`.
- **QuickJS**: `RELEASE_SYNC`, `newVariant({ wasmModule })`,
  `runtime.setInterruptHandler`, promise-bridged host functions.

## Clock / interrupt patch

Installed `@tanstack/ai-isolate-quickjs@0.3.1` sets

```ts
vm.runtime.setInterruptHandler(() => Date.now() > execState.deadline);
```

celld documents that `Date.now()` and `performance.now()` stay fixed during
synchronous JS. A guest `for (;;)` therefore never observes a moving deadline.

This repo does **not** silently use `eval`, `new Function`, `node:vm`, or an
unrestricted Worker. `worker/isolate.ts` keeps the official promise bridge and
adds a fuel counter decremented inside the interrupt callback. Nested snippet
invocations share the host-call budget; they do not reset it.

On real celld 0.4.1, a 50k host loop left `Date.now()` unchanged (`clock.dateNowFrozenHint: 0`).
The first isolate adapter also called `Date.now()` from the QuickJS interrupt
callback. That request never returned (curl timed out; `/health` on the Worker
isolate still answered). The shipped handler is **fuel-only** and never reads a
clock. After that change, `GET /api/probe?case=sync-infinite-loop` returned in
449ms with 12,001 interrupt callbacks, and `microtask-loop` returned in 25ms.
Microtask storms are pumped with `executePendingJobs(16)` and the same fuel
counter; `executePendingJobs(-1)` is not used.

A process watchdog killing `celld` is treated as a failed containment test.

## Durability

Local `celld dev` stores objects under `PROJECT/.celld/dev`. Tests use an
isolate directory outside this checkout so they do not share the workbench
lease. A single node proves
writes through the local store (`CELLD_DURABILITY` defaults to `fleet`, which
on one node waits for the bucket/local equivalent). This demo is **not**
hostile-multi-tenant safe. See celld's security page: one fleet is one
application.

## Live providers

`MODEL_PROVIDER=alibaba|openai|grok` plus the matching API key. Alibaba
Token Plan is OpenAI-compatible **chat/completions** (not the Responses
API), so the Worker uses `worker/alibaba.ts` instead of `@tanstack/ai-openai`.
Key: `ALIBABA_TOKEN_PLAN_API_KEY`. Default model: `qwen3.8-max`.
`npm run test:celld` marks live-provider **UNRUN** without `--live-smoke`.
`npm run test:live` fails when no key is configured.

## Effect

Pinned `effect@4.0.0-rc.115`. Used only for trusted-host notify/approval
policy, journaling, scoped cleanup, and interruption. No Node platform
package is bundled. Effect fibers are not Celld jobs.

Worker upload reported by `celld dev` after Effect: about 3205–3257 KiB
uncompressed / 707–709 KiB gzip (2026-09-11, one local machine). The
pre-Effect upload on the same machine was about 2978 / 658 KiB. That is a
rough +230 KiB / +50 KiB gzip delta, not a lab benchmark. `npm run
measure:bundle` uses esbuild with WASM inlined as binary (2923 KiB) and is
not comparable to celld's compiler output. Isolate cold start in these
runs was typically 0.4–70 ms as logged by celld; do not treat that as a
precision claim. Effect was kept because probes and host tests passed and
the size delta did not block the alpha.

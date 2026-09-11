# Architecture

The application is one Cloudflare-compatible Worker plus three Durable Object
classes. It is intended to run on **celld**, not on a Node process.

```
UI (static assets)
  → Worker (auth, routing)
    → DirectoryCell (one per owner — chat index)
    → AgentCell (one per owner:chat — transcript, runs, app state)
        → TanStack AI chat loop
            → execute_typescript
                → fuel-budget QuickJS WASM isolate
                    → host capabilities (SQL, approvals, schedules)
    → ProbeCell (disposable containment runs)
```

## Multiple chats

Each chat is its own **AgentCell** (`idFromName(ownerId:chatId)`). The
**DirectoryCell** (`idFromName(ownerId)`) owns the chat list: create, rename,
archive, and fenced activity previews (title / last message / run status).
Listing never wakes every chat. Durable Objects cannot be enumerated from the
Worker; do not proxy celld's operator `celld cell list` API.

Chats are created only through `POST /api/chats` (which bootstraps the
AgentCell). Hitting `/api/agents/:id` for an unknown id returns 404. The first
directory access seeds a `default` chat so existing workbench state remains
reachable.

Activity pushes use a message-seq fence: a delayed preview cannot overwrite a
newer one, and an archived chat rejects resurrection. v1 keeps memory, tasks,
snippets, and schedules **per chat**; shared memory across chats is a follow-up.

## Trust boundary

The Worker and AgentCell are the trusted kernel. Generated TypeScript never
runs as host JavaScript. Guest code can only call the injected `external_*`
bindings. Those bindings re-check owner, capability grant, run generation,
cancellation, and output size on every call.

Self-programming means the agent can save, test, activate, invoke, and roll
back **application snippets**. It cannot rewrite the kernel, mint deployment
credentials, disable auth, or raise quotas.

## Durable state

Each AgentCell owns a SQLite database (`new_sqlite_classes`). Control tables
are not exposed through a generic query tool. Schema lives in
`worker/schema.ts`. Directory schema lives in `worker/directory-schema.ts`.

Recoverable boundaries are **model turns** and **capability effects**, not a
JavaScript stack. If a Code Mode program is interrupted, the next turn inspects
the journal instead of replaying the program.

## Admission and fencing

One conversational run is active at a time **per chat cell**. Extra messages
on that cell are queued. Each run has a generation. Stale callbacks after Stop
or recovery cannot commit. Separate chats run in parallel because they are
separate cells.

`ctx.waitUntil` continues the model/tool loop after the HTTP response.
Disconnecting the UI is not Stop. Stop persists `cancel_requested`, aborts the
in-flight model/host work, and later records `terminated`.

## Approvals

`integrations.notify` writes an immutable operation proposal and throws
`ApprovalRequiredError`. The isolate is not left suspended. Approve/deny is a
host endpoint. The saved arguments are executed by operation id. A second
approve of the same id is idempotent.

## Schedules

Schedules use Durable Object `setAlarm`. They pin a snippet version and
capability set. Dispatch re-checks current grants. Occurrences are keyed by
`(schedule_id, due_at)`. After downtime, only the due occurrence is taken; a
one-shot is not replayed.

## Code Mode

TanStack `createCodeMode` exposes `execute_typescript` and generates type
stubs from the live tool schemas. The isolate driver is a small adapter over
`@tanstack/ai-isolate-quickjs` / `quickjs-emscripten` that interrupts with a
**fuel tick**. celld freezes `Date.now()` during synchronous JavaScript/WASM,
and a `Date.now()` read from the interrupt import hung the guest isolate.
Snippet tests run with `mode: "test"` against an in-memory scratch copy of
memory/tasks so they cannot perform live external effects.

# Agent notes

This is a Celld-hosted Code Mode application, not a general coding harness.

## Do

- Keep generated TypeScript inside the fuel-limited QuickJS isolate.
- Re-check owner, grant, generation, cancellation, and output size on every host call.
- Use disposable AgentCells / ProbeCells and `CELLD_ISOLATE_ROOT` outside this checkout (`celld dev` state is always `PROJECT/.celld/dev`).
- Preserve passing containment assertions (`sync-infinite-loop`, `microtask-loop`).
- Map host failures to stable public error codes. Do not leak Effect internals.

## Do not

- Call `Date.now()` from the isolate interrupt handler.
- Replace fuel interruption with wall-clock deadlines.
- Replay a half-finished Code Mode program after isolate loss.
- Use `pkill`/`killall` against celld. Only stop the child you started.
- Treat Effect fibers as persisted jobs or Effect timeouts as containment.
- Add a second AI/workflow engine beside TanStack `chat()`.
- Commit `.env`, `.celld/`, keys, or private screenshots.
- Turn an UNRUN live-provider check into PASS.

## Commands

```sh
npm run doctor
npm test
npm run test:celld
npm run test:live    # requires configured provider key
npm run check
```

Login for the local workbench: owner `operator`, secret `dev-change-me`.

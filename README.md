# Celld Code Mode workbench

Experimental application agent that runs **inside [celld](https://celld.dev)**.
The model writes TypeScript; a fuel-limited QuickJS WASM isolate executes it
against host-enforced capabilities (memory, tasks, snippets, schedules,
config, one approved notification sink).

This is a standalone alpha, not a general coding harness and not a
hostile-multi-tenant product. Publishing the source does not authorize
exposing the workbench, opening firewall ports, or launching a paid public
deployment. Keep celld on loopback. The operator/internal listener stays
private.

```
UI / authenticated HTTP
  → DirectoryCell (chat index per owner)
  → AgentCell (one chat cell: state, admission, scheduling, recovery)
    → TanStack AI loop
      → Code Mode in a restricted isolate
        → host capabilities (Effect-backed notify/approval path)
```

## Prerequisites

- Node 20+ (tested on Node 24)
- npm (this repo uses `package-lock.json`; do not introduce another package manager)
- `celld` **0.4.1** on `PATH`

```sh
curl -fsSL https://celld.dev/install.sh | CELLD_VERSION=v0.4.1 sh
export PATH="$HOME/.local/bin:$PATH"
```

`esbuild` is installed as a devDependency; celld reads `PATH`.

## Setup

```sh
cp .env.example .env
npm ci
```

`AUTH_SECRET` defaults to `dev-change-me` via `wrangler.jsonc` vars.

## Run (fixture mode)

```sh
export PATH="$PWD/node_modules/.bin:$HOME/.local/bin:$PATH"
npm run doctor
npm run dev
```

Open `http://127.0.0.1:9876`. With `AUTH_FIXTURE=1` (default in tests), log in
via **Enter** as fixture owner `operator`. For Better Auth email/password, leave
fixture mode off and use `/login` / `/signup`. Disconnecting the browser does
not stop a run. Use **Stop**.

Fixture mode uses a deterministic model that still exercises the real
interpreter, host capabilities, SQLite, transport, and UI.

## Optional live model

`npm run dev` loads `~/.config/secrets.env` when present and selects
Alibaba Token Plan if `ALIBABA_TOKEN_PLAN_API_KEY` is set. The coding-agent
subscription is not this application's credential.

```
MODEL_PROVIDER=alibaba
ALIBABA_TOKEN_PLAN_API_KEY=   # never commit
ALIBABA_MODEL=qwen3.8-max
```

Also accepted: `MODEL_PROVIDER=openai` / `OPENAI_API_KEY` or
`MODEL_PROVIDER=grok` / `XAI_API_KEY`. Ordinary tests stay fixture-only.

```sh
npm run test:live    # fails clearly when no key is configured
```

`npm run test:celld` reports live-provider as **UNRUN** unless you pass
`--live-smoke`. Never treat UNRUN as PASS.

## Stack (streams + celld)

```sh
npm run streams     # Durable Streams sidecar only (:4437)
npm run stack       # streams + celld dev (:9876), sets STREAMS_BASE_URL
```

## Supervisor + runner

```sh
npm run supervisor:build
npm run supervisor -- enroll --name my-laptop --base-url http://127.0.0.1:9876 --token <token>
npm run supervisor -- run --name my-laptop
npm run runner:build   # dist/runner/runner.mjs (fixture default harness)
```

Harness profiles (`fixture`, `claude-code`, `codex`, `grok-build`, `opencode`) resolve
via `runner/src/profiles.ts`. All harness live rows are **UNRUN** — see
[docs/HARNESSES.md](docs/HARNESSES.md).

## Verify

```sh
npm test            # unit tests, including fuel interrupt + Effect host path
npm run probe       # containment probes on a disposable ProbeCell (port 9888)
npm run test:celld  # probes + HTTP acceptance + restart/schedule demo
npm run test:e2e    # fixture demo without probes
npm run test:browser
npm run check       # format, lint, typecheck, build, unit tests
```

Tests start a disposable `celld dev` project **outside this checkout** (default:
`$TMPDIR/celld-codemode-test-<port>-<pid>`). `celld dev` always stores state in
`PROJECT/.celld/dev`; sharing that directory with the workbench causes
`SELF-FENCE`. Tests never `pkill` other celld processes. Leave a workbench on
`:9876` running.

## Containment note

celld freezes `Date.now()` during synchronous JS/WASM. The upstream
`@tanstack/ai-isolate-quickjs` interrupt uses wall-clock time and does not
fire here. This repo's `worker/isolate.ts` uses a **fuel tick** instead.
Calling `Date.now()` from the interrupt handler hung a ProbeCell in earlier
investigation; do not reintroduce that. A process watchdog killing celld is
a failed containment test.

Reproduce locally:

```sh
npm run probe
```

Expect `probe:sync-infinite-loop` and `probe:microtask-loop` to pass while
`/health` remains up.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/COMMANDS.md](docs/COMMANDS.md),
[docs/STREAMS.md](docs/STREAMS.md),
[docs/SELF-HOST.md](docs/SELF-HOST.md),
[docs/SECURITY.md](docs/SECURITY.md),
[docs/HARNESSES.md](docs/HARNESSES.md),
[docs/RECOVERY.md](docs/RECOVERY.md),
[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md),
and [docs/DEMO.md](docs/DEMO.md).

Effect is used only at the trusted host boundary for capability policy,
operation journaling, and the notify/approval lifecycle. It is not a guest
sandbox, not a second AI loop, and not crash recovery. Celld records and
wake-ups remain authoritative.

## Security limitations

- One local celld node is one application fleet, not a multi-tenant product.
- Sessions are HMAC over `AUTH_SECRET`. Default secret is for loopback demos.
- Guest code cannot self-approve, raise quotas, or read deploy credentials.
- An accepted notify that fails after dispatch is marked `uncertain` and is
  not automatically retried.
- Reset disposable demo state by stopping that `celld dev` and deleting its
  `PROJECT/.celld/dev` (the workbench uses this checkout's `.celld/dev`).

## Troubleshooting

| Symptom                        | What to do                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `SELF-FENCE` / two celld nodes | They share one `PROJECT/.celld/dev`. Tests must use `CELLD_ISOLATE_ROOT` outside this repo. |
| Port in use                    | `CELLD_TEST_PORT=9890 npm run test:celld`                                                   |
| Isolate never interrupts       | Confirm fuel-only handler; do not call `Date.now()` there.                                  |
| Live smoke UNRUN               | Expected without keys. `test:live` fails instead of UNRUN.                                  |

## Source

https://github.com/grmkris/celld-codemode-workbench

## License

MIT for this application's original source. Third-party packages keep their
own licenses. See [NOTICE](NOTICE).

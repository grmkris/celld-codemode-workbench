# Harness matrix

All harness profiles are **UNRUN** in CI and local smoke unless explicitly noted.
Claude Code is the reference wiring path; only Alibaba live smoke is enabled for the
main chat model in this repository.

## Profile summary

| Profile     | Package                    | Sandbox               | Live status | Notes                                     |
| ----------- | -------------------------- | --------------------- | ----------- | ----------------------------------------- |
| fixture     | (built-in runner adapter)  | n/a                   | UNRUN       | NDJSON chunks + workspace file edit       |
| claude-code | `@tanstack/ai-claude-code` | `localProcessSandbox` | UNRUN       | Reference wiring; no CLI token extraction |
| codex       | `@tanstack/ai-codex`       | docker (planned)      | UNRUN       | Stub registry in `runner/src/profiles.ts` |
| grok-build  | `@tanstack/ai-grok-build`  | docker (planned)      | UNRUN       | Stub registry in `runner/src/profiles.ts` |
| opencode    | `@tanstack/ai-opencode`    | docker (planned)      | UNRUN       | Stub registry in `runner/src/profiles.ts` |

## Capability matrix (live execution)

Rows are **UNRUN** for live harness runs. Contract validation (imports, wiring,
tool-exec envelope) may pass in CI without invoking provider CLIs.

| Profile     | start | stream | cancel | host tools | approvals | continuation | disconnect | restart |
| ----------- | ----- | ------ | ------ | ---------- | --------- | ------------ | ---------- | ------- |
| fixture     | UNRUN | UNRUN  | UNRUN  | UNRUN      | UNRUN     | UNRUN        | UNRUN      | UNRUN   |
| claude-code | UNRUN | UNRUN  | UNRUN  | UNRUN      | UNRUN     | UNRUN        | UNRUN      | UNRUN   |
| codex       | UNRUN | UNRUN  | UNRUN  | UNRUN      | UNRUN     | UNRUN        | UNRUN      | UNRUN   |
| grok-build  | UNRUN | UNRUN  | UNRUN  | UNRUN      | UNRUN     | UNRUN        | UNRUN      | UNRUN   |
| opencode    | UNRUN | UNRUN  | UNRUN  | UNRUN      | UNRUN     | UNRUN        | UNRUN      | UNRUN   |

## Runner selection

Profiles resolve through `runner/src/profiles.ts` (no live credentials required).

Set `harness` on the assignment payload or `CELLD_HARNESS` in the container environment:

- `fixture` (default) — deterministic NDJSON stream for CI
- `claude-code` — validates `localProcessSandbox` + `remoteToolStubs` + tool-exec URL envelope
- `codex` / `grok-build` / `opencode` — import + wiring stubs only (UNRUN)

```sh
npm run runner:build
CELLD_HARNESS=codex node dist/runner/runner.mjs   # UNRUN stub path
```

## Tool-exec envelope

Remote tools POST to TaskCell `tool-exec` with:

```json
{
  "attemptId": "att_…",
  "invocationId": "…",
  "lease": "…",
  "name": "tool_name",
  "args": {},
  "argsHash": "…",
  "version": 1
}
```

## Live policy

- Do **not** set `CELLD_HARNESS_LIVE=1` in CI.
- Do **not** extract coding-agent CLI tokens from the host environment.
- Main chat model live smoke: Alibaba only (`npm run test:live`).

# Harness matrix

All harness profiles are **UNRUN** in CI and local smoke unless explicitly noted.
Claude Code is the reference wiring path; only Alibaba live smoke is enabled for the
main chat model in this repository.

| Profile     | Package                    | Sandbox               | Live status | Notes                                     |
| ----------- | -------------------------- | --------------------- | ----------- | ----------------------------------------- |
| fixture     | (built-in runner adapter)  | n/a                   | UNRUN       | NDJSON chunks + workspace file edit       |
| claude-code | `@tanstack/ai-claude-code` | `localProcessSandbox` | UNRUN       | Reference wiring; no CLI token extraction |
| codex       | `@tanstack/ai-codex`       | docker (planned)      | UNRUN       | Stub — not wired in runner yet            |
| opencode    | `@tanstack/ai-opencode`    | docker (planned)      | UNRUN       | Stub — not wired in runner yet            |

## Runner selection

Set `harness` on the assignment payload or `CELLD_HARNESS` in the container environment:

- `fixture` (default) — deterministic NDJSON stream for CI
- `claude-code` — validates `localProcessSandbox` + `remoteToolStubs` + tool-exec URL envelope

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

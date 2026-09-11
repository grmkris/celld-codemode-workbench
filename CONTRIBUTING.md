# Contributing

## Setup

Follow the README. Use npm and the committed lockfile.

```sh
npm ci
npm run doctor
npm run check
```

Real Celld tests need `celld` 0.4.1 and a free loopback port (default 9888).
They spawn `celld dev` in `CELLD_ISOLATE_ROOT` (or a temp directory), never in
this checkout's `.celld/dev`. Do not `pkill` other celld processes.

## Style

- `npm run format` then `npm run lint:fix`
- Do not add overlapping linters
- Do not disable rules for vendor/WASM by silencing whole trees of application code
- Keep formatting-only changes out of behavior PRs when practical

## Tests

- Unit tests must run offline
- `npm run test:celld` is required for isolate, recovery, approval, and schedule changes
- `npm run test:live` is opt-in and must fail when no credentials are configured
- Do not weaken assertions to get a green check

## Security

Do not commit secrets, private logs, or internal addresses. Reset only
disposable demo state under `.celld/`.

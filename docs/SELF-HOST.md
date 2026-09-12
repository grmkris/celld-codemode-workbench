# Self-host stack

Loopback-first deployment for a single operator fleet. Not hostile multi-tenant.

## Components

| Process                          | Role                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `services/streams.mjs`           | Durable Streams file-backed sidecar                       |
| `celld dev`                      | Worker + Durable Objects (Agent, Team, Task, Identity, …) |
| `durable-streams-server` (Caddy) | Optional TLS + HTTP/2 front door                          |
| `supervisor`                     | Registered machine: enroll, poll, provision containers    |
| `runner`                         | In-container harness (fixture default)                    |

## Quick start

```sh
npm ci
npm run stack              # streams + celld on :9876
```

With Caddy h2 (when `durable-streams-server` is on PATH):

```sh
# Example Caddyfile (not committed — adapt paths)
# :443 {
#   tls internal
#   reverse_proxy /api/* 127.0.0.1:9876
#   reverse_proxy /v1/stream/* 127.0.0.1:4437
# }
```

Environment:

```sh
STREAMS_BASE_URL=http://127.0.0.1:4437
STREAMS_WRITE_TOKEN=dev-streams-token   # set in production
AUTH_SECRET=change-me
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=https://your-host
```

## Supervisor

```sh
npm run supervisor:build
npm run supervisor -- enroll --name my-laptop --base-url http://127.0.0.1:9876 --token <enrollment-token>
npm run supervisor -- run --name my-laptop
npm run supervisor -- drain --name my-laptop
```

Credentials: `~/.celld-supervisor/<name>/credentials.json` (mode 0600).

## Isolation

Tests and CI use `CELLD_ISOLATE_ROOT` outside this checkout. Do not share
`.celld/dev` between workbench and test nodes (`SELF-FENCE`).

## CI note

GitHub Actions runs on `ubuntu-latest` only — not on operator VPS hosts.

# Security

Experimental loopback demo. **Not** a proven hostile-multi-tenant platform.

## Report a vulnerability

Open a private GitHub security advisory on the public repository. Do not file
public issues with secrets or exploit payloads.

## What this software does not promise

- Isolation between mutually hostile tenants on one fleet
- Safety when celld binds to a public address
- Protection of the unauthenticated operator/internal listener
- Automatic recovery of externally accepted effects with unknown results

## Auth limits

- Better Auth (email/password) in IdentityCell for real sign-in
- `AUTH_FIXTURE=1` enables legacy `POST /api/login` (`operator` /
  `dev-change-me`) for CI/browser tests only
- Sessions are HMAC/cookie-based; default secrets are for local demos
- Inbound `x-celld-*` headers are stripped at the Worker edge; identity comes
  from verified session
- Mutating requests require Origin checks

## Guest / host boundary

Guest TypeScript runs in QuickJS with a fuel budget. Host capabilities re-check
owner, grant, generation, cancellation, and output size on every call. Nested
snippets inherit remaining limits and cannot escalate capabilities.

Approvals bind owner, operation id, and hashed arguments. Guest code cannot
self-approve or raise quotas.

## Delegation

`delegation_submit` creates tasks and returns ids promptly — it does not wait
for remote worker completion. Task cancellation is separate from conversation
Stop. See [COMMANDS.md](./COMMANDS.md).

## Streams

Durable Streams sidecar binds loopback. Write token is shared only with Celld.

## Local defaults

- Worker: `127.0.0.1`
- Default `AUTH_SECRET`: `dev-change-me`
- Demo notify sink writes to the cell `notifications` table only

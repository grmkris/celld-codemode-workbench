# Security

This project is an experimental loopback demo. It is not a proven
hostile-multi-tenant platform.

## Report a vulnerability

Open a private GitHub security advisory on the public repository, or contact
the maintainer through GitHub. Do not file a public issue that includes
secrets, tokens, or exploit payloads.

## What this software does not promise

- Isolation between mutually hostile tenants on one fleet
- Protection if you bind celld to a public address
- Protection of the unauthenticated operator/internal listener
- Automatic recovery of an externally accepted effect whose result is unknown

## Local defaults

- Worker listen address: `127.0.0.1`
- Default `AUTH_SECRET`: `dev-change-me` (change it for any shared machine)
- Demo notify sink writes to the cell's `notifications` table only

## Guest / host boundary

Guest TypeScript runs in QuickJS with a fuel budget. Host capabilities
re-check policy. Nested snippets inherit remaining limits and cannot escalate
to capabilities the parent does not hold. Approvals bind owner, operation id,
and hashed arguments.

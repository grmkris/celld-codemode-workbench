# Operator recovery

## Local reset

Stop `celld dev`, then delete `.celld/dev` to wipe Durable Object state. The
next `npm run dev` starts empty.

## Stuck run

1. `POST /api/agents/<id>/stop` with a valid session.
2. Confirm the run status becomes `terminated`.
3. Inspect `/snapshot` for `waiting_approval` or `uncertain` operations.

Stop does not undo a notification that already landed in `notifications`.

## Pending approval across restart

Approvals are SQLite rows. After process restart they remain `proposed` until
expiry. Approve or deny by operation id. Do not invent a new payload.

## Uncertain effect

`/test/crash` with `ALLOW_TEST_HOOKS=1` can leave `operations.status = uncertain`.
Treat those as "maybe delivered". Reconcile against `notifications` by
`operation_id`. Do not retry a new operation with a different payload and call
it the same effect.

## Schedule after eviction

Alarms are stored with the object. After `celld` restarts, `AgentCell`
re-arms `setAlarm` from the durable `schedules.next_due_at` during
`blockConcurrencyWhile`. Dispatch takes at most one occurrence per
`(schedule_id, due_at)`. A revoked capability skips the occurrence even if
the schedule was created earlier.

## Auth lockout

Sessions are HMAC tokens over `AUTH_SECRET`. Rotate the secret by changing
`AUTH_SECRET` / `CELLD_VAR_AUTH_SECRET` and logging in again. Old tokens fail
closed.

## Do not expose the operator listener

celld's internal listener (`/state`, `/evict`, `/do`) is unauthenticated.
Keep it on loopback. This application's public Worker does not proxy it.

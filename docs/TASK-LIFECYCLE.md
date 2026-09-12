# Task lifecycle

Delegated work moves through TaskCell, TeamCell assignment queues, and a
supervisor-owned runner container. Celld SQLite remains authoritative; journals
and streams are derived.

## Lease

`POST /attempts/:id` claims create a lease + generation fence. The claiming
machine renews via TeamCell heartbeat:

```json
{ "attempts": [{ "attemptId", "taskCellAddress", "lease", "generation", "ttlMs?" }] }
```

TeamCell verifies the machine credential and forwards
`POST /attempts/:id/lease/renew` to TaskCell. Attempt events use
`POST /machines/:id/attempts/:attemptId/events` (same auth).

## Sweeper

TaskCell `alarm()` every ~30s while attempts are `assigned|running`:

- `lease_expires_at < now` → attempt `lost`, task `queued` (retries left) or
  `failed`, event `lease.expired`
- Never “drives” a run to discover loss — expiry is pure lease math

TeamCell `alarm()` every ~30s while machines are live:

- `last_seen_at` older than three heartbeat intervals → machine `stale`
- Their `assigned` (not yet `running`) assignments return to `pending`
- A later heartbeat restores `stale` → `approved`

## Cancel to container

`cancelDelegation` / `POST .../task-assignments/.../cancel` sets
`cancel_requested=1`. Supervisor poll receives cancels, `stopContainer`s the
journaled runner, and posts `attempt.cancelled` through the machine proxy.
TaskCell advances cancel `requested → signalled → confirmed` on that event.

## In-container journal

Runner writes NDJSON to `/tmp/celld-runs/<attemptId>.ndjson` (stderr to `.err`),
mirrors to console, then appends an exit sentinel:

```json
{ "__exit": N, "__nonce": "<sha256(celld/journal-exit/v1:attemptId).slice(0,32)>" }
```

Supervisor tails with `docker exec tail -c +N -f`, persists byte offsets in its
node:sqlite journal, batches lines to attempt events, stops on the sentinel
(`attempt.finished`), and resumes every active journaled container after
restart. First-byte stall of 10s emits `journal-stalled`.

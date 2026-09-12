# Commands

Server-owned mutations go through `POST /api/agents/:id/commands` (or the
conversation equivalent). Reads (`GET /snapshot`, `GET /stream`, `GET /events`)
never start runs.

## Envelope

```json
{
  "commandId": "cmd_<uuid>",
  "kind": "send",
  "payload": {},
  "expectedRunId": "run_<uuid>",
  "expectedGeneration": 2
}
```

## Dedup

Commands are keyed by `(principal, commandId)` with a payload hash.

| Case                                          | Result                |
| --------------------------------------------- | --------------------- |
| Same `commandId` + same payload hash          | Replay stored outcome |
| Same `commandId` + different payload          | `409 conflict`        |
| Command still in flight (`outcome_json` null) | `409 conflict`        |

Identical text under different command ids creates two user messages.

## Kinds

| Kind                 | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `send`               | Record user message + admit run or enqueue                           |
| `stop`               | Cancel active **conversation run**; pause queue                      |
| `cancel_task`        | Cancel one **delegated task** by `taskId`                            |
| `stop_all`           | `stop` + cancel pending/running delegated tasks in this conversation |
| `approve` / `deny`   | CAS on pending operation                                             |
| `resume_queue`       | Clear queue pause and advance                                        |
| `remove_queued`      | Drop one queued message                                              |
| `rename` / `archive` | Conversation metadata                                                |

### Stop vs Cancel task vs Stop all

- **Stop** (`kind: stop`): stops the in-cell model/Code Mode run. Sets
  `cancel_requested`, aborts in-flight work, pauses the message queue. Does not
  undo external effects already accepted.
- **Cancel task** (`kind: cancel_task`, payload `{ taskId }`): requests
  cancellation of a delegated worker task in TaskCell. Scoped to the linked team
  conversation.
- **Stop all** (`kind: stop_all`): Stop **plus** bounded cancellation of
  pending/running delegated tasks for the same conversation. Queue remains
  paused until `resume_queue`.

Optional fencing: `expectedRunId` + `expectedGeneration`. Stale fencing returns
`409 { status: "stale" }` without cancelling.

## Run / queue

One active run per chat cell. Concurrent sends enqueue with author attribution.
Stop sets `queue_paused`; queued messages do not advance until `resume_queue`.

Send returns `202` with `{ queued: true|false, runId?, messageId }`. The HTTP
response is an ack; execution continues via `waitUntil`.

## Legacy endpoints

`POST /chat` and `POST /stop` remain for compatibility. Prefer `/commands` for
dedup and fencing.

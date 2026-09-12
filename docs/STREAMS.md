# Durable Streams

Chat chunks and scoped state records publish through Durable Streams. Celld is
the authority; streams are a derived transport.

## Local sidecar

```sh
npm run streams          # services/streams.mjs on 127.0.0.1:4437
npm run stack            # streams + celld dev (sets STREAMS_BASE_URL)
```

The sidecar uses `@durable-streams/server` `DurableStreamTestServer` with a
file-backed data directory (`STREAMS_DATA_DIR`, default `/tmp/celld-streams-data`).

## Snapshot + offset contract

`GET /api/agents/:id/snapshot` returns:

- `messages` / `messageParts` from SQLite (committed boundaries)
- `streamOffset` — last acked outbox offset for the chat publisher

Clients attach to `GET /api/agents/:id/stream?offset=<streamOffset>` (proxied
to Durable Streams with whitelisted query params). The offset is opaque; do not
treat it as an entity id.

## Outbox publisher

Each AgentCell owns an `outbox` + `publisher` table. Publication uses a fenced
producer (`producerId` = cell address, monotonic `epoch`). On sequence gap or
stale epoch:

1. Read stream tail
2. Compare fingerprints
3. Ack matching rows or re-append missing ones

Crash between append and ack reconciles the same way on the next flush/alarm.

## Outage

If the streams sidecar is down:

- Celld continues recording messages and outbox rows
- Publication retries via `waitUntil` and alarms
- UI shows delivery delayed; **do not** re-invoke the model because the client
  disconnected

## Epoch / resnapshot

When the publisher epoch bumps (cell reconstruction), clients with a stale
offset must resnapshot and reattach from the returned `streamOffset`.

## Security

Streams bind to loopback in dev. Production self-host uses Caddy + bearer token
(`STREAMS_WRITE_TOKEN`) shared only with Celld — see [SELF-HOST.md](./SELF-HOST.md).

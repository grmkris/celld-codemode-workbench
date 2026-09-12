import {
  DurableStream,
  FetchError,
  IdempotentProducer,
  SequenceGapError,
  StaleEpochError,
  stream,
} from "@durable-streams/client";
import { sha256Hex, stableJson } from "../../shared/crypto";
import { EventId, newId } from "../../shared/ids";
import type { Sql } from "../sql";
import { streamsWriteHeaders, type StreamsConfig } from "./config";

export interface OutboxRow {
  id: number;
  event_id: string;
  kind: string;
  payload: string;
  fingerprint: string;
  published_offset: string | null;
  acked_at: number | null;
  created_at: number;
}

export interface PublisherRow {
  key: string;
  producer_id: string;
  epoch: number;
  last_seq: number;
  last_acked_offset: string | null;
}

export interface OutboxFlushResult {
  published: number;
  delayed: number;
}

export interface OutboxPublisherOptions {
  publisherKey: string;
  config?: StreamsConfig;
  fetch?: typeof fetch;
}

interface StreamEnvelope {
  eventId: string;
  kind: string;
  payload: unknown;
  fingerprint: string;
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof FetchError) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    );
  }
  return false;
}

export class OutboxPublisher {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly sql: Sql,
    private readonly options: OutboxPublisherOptions,
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async enqueue(kind: string, payload: unknown): Promise<string> {
    const eventId = EventId.generate();
    const payloadJson = stableJson(payload);
    const fingerprint = await sha256Hex(`${kind}:${payloadJson}`);
    const now = Date.now();

    this.sql.exec(
      `INSERT INTO outbox(event_id, kind, payload, fingerprint, created_at)
       VALUES(?, ?, ?, ?, ?)`,
      eventId,
      kind,
      payloadJson,
      fingerprint,
      now,
    );

    return eventId;
  }

  async flush(streamUrl: string): Promise<OutboxFlushResult> {
    const pending = this.pendingRows();
    if (pending.length === 0) return { published: 0, delayed: 0 };

    const authHeaders = streamsWriteHeaders(this.options.config);
    let published = 0;

    try {
      const handle = await this.connectOrCreate(streamUrl, authHeaders);
      let state = this.loadPublisherState();
      let remaining = pending;

      while (remaining.length > 0) {
        const producer = new IdempotentProducer(handle, state.producer_id, {
          epoch: state.epoch,
          headers: authHeaders,
          fetch: this.fetchImpl,
        });

        try {
          for (const row of remaining) {
            producer.append(this.encodeEnvelope(row));
          }
          await producer.flush();

          const offset = producer.lastSuccessfulOffset ?? state.last_acked_offset ?? null;
          this.markAcked(remaining, offset);
          this.savePublisherState({
            ...state,
            epoch: producer.epoch,
            last_seq: producer.nextSeq,
            last_acked_offset: offset,
          });

          published += remaining.length;
          remaining = [];
        } catch (error) {
          if (error instanceof StaleEpochError || error instanceof SequenceGapError) {
            const ackedFingerprints = await this.reconcileFingerprints(streamUrl, authHeaders);
            const reconciled = this.markAckedByFingerprints(remaining, ackedFingerprints, null);
            published += reconciled;
            remaining = remaining.filter((row) => !ackedFingerprints.has(row.fingerprint));

            if (remaining.length === 0) break;

            const nextEpoch =
              error instanceof StaleEpochError ? error.currentEpoch + 1 : state.epoch + 1;
            state = {
              ...state,
              epoch: nextEpoch,
              last_seq: 0,
            };
            this.savePublisherState(state);
            continue;
          }

          if (isNetworkError(error)) {
            return { published, delayed: remaining.length };
          }

          throw error;
        }
      }

      return { published, delayed: 0 };
    } catch (error) {
      if (isNetworkError(error)) {
        return { published: 0, delayed: pending.length };
      }
      throw error;
    }
  }

  pendingRows(): OutboxRow[] {
    return this.sql.exec(
      `SELECT id, event_id, kind, payload, fingerprint, published_offset, acked_at, created_at
       FROM outbox
       WHERE acked_at IS NULL
       ORDER BY id ASC`,
    ) as unknown as OutboxRow[];
  }

  private encodeEnvelope(row: OutboxRow): string {
    const envelope: StreamEnvelope = {
      eventId: row.event_id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as unknown,
      fingerprint: row.fingerprint,
    };
    return JSON.stringify(envelope);
  }

  private async connectOrCreate(
    streamUrl: string,
    authHeaders: Record<string, string>,
  ): Promise<DurableStream> {
    const connectOpts = {
      url: streamUrl,
      headers: authHeaders,
      fetch: this.fetchImpl,
    };

    const head = await DurableStream.head(connectOpts);
    if (head.exists) {
      return DurableStream.connect(connectOpts);
    }

    const created = new DurableStream({
      ...connectOpts,
      contentType: "application/json",
    });
    await created.create({ contentType: "application/json" });
    return created;
  }

  private loadPublisherState(): PublisherRow {
    const existing = this.sql.one<{
      key: string;
      producer_id: string;
      epoch: number;
      last_seq: number;
      last_acked_offset: string | null;
    }>(
      "SELECT key, producer_id, epoch, last_seq, last_acked_offset FROM publisher WHERE key = ?",
      this.options.publisherKey,
    );

    if (existing) {
      return {
        key: String(existing.key),
        producer_id: String(existing.producer_id),
        epoch: Number(existing.epoch),
        last_seq: Number(existing.last_seq),
        last_acked_offset: existing.last_acked_offset ? String(existing.last_acked_offset) : null,
      };
    }

    const row: PublisherRow = {
      key: this.options.publisherKey,
      producer_id: newId("prod"),
      epoch: 0,
      last_seq: 0,
      last_acked_offset: null,
    };

    this.sql.exec(
      `INSERT INTO publisher(key, producer_id, epoch, last_seq, last_acked_offset)
       VALUES(?, ?, ?, ?, NULL)`,
      row.key,
      row.producer_id,
      row.epoch,
      row.last_seq,
    );

    return row;
  }

  private savePublisherState(state: PublisherRow): void {
    this.sql.exec(
      `UPDATE publisher
       SET producer_id = ?, epoch = ?, last_seq = ?, last_acked_offset = ?
       WHERE key = ?`,
      state.producer_id,
      state.epoch,
      state.last_seq,
      state.last_acked_offset,
      state.key,
    );
  }

  private markAcked(rows: OutboxRow[], offset: string | null): void {
    const now = Date.now();
    for (const row of rows) {
      this.sql.exec(
        "UPDATE outbox SET acked_at = ?, published_offset = ? WHERE id = ?",
        now,
        offset,
        row.id,
      );
    }
  }

  private markAckedByFingerprints(
    rows: OutboxRow[],
    fingerprints: Set<string>,
    offset: string | null,
  ): number {
    let count = 0;
    for (const row of rows) {
      if (!fingerprints.has(row.fingerprint)) continue;
      this.sql.exec(
        "UPDATE outbox SET acked_at = ?, published_offset = ? WHERE id = ?",
        Date.now(),
        offset,
        row.id,
      );
      count += 1;
    }
    return count;
  }

  private async reconcileFingerprints(
    streamUrl: string,
    authHeaders: Record<string, string>,
  ): Promise<Set<string>> {
    const fingerprints = new Set<string>();
    const state = this.loadPublisherState();

    try {
      const response = await stream<StreamEnvelope>({
        url: streamUrl,
        headers: authHeaders,
        offset: state.last_acked_offset ?? "0",
        live: false,
        fetch: this.fetchImpl,
      });

      const items = await response.json();
      for (const item of items) {
        if (item.fingerprint) fingerprints.add(item.fingerprint);
      }
    } catch {
      try {
        const head = await DurableStream.head({
          url: streamUrl,
          headers: authHeaders,
          fetch: this.fetchImpl,
        });
        if (head.exists && head.offset) {
          // Stream exists but tail read failed — leave reconciliation empty.
        }
      } catch {
        // Ignore head failures during reconciliation.
      }
    }

    return fingerprints;
  }
}

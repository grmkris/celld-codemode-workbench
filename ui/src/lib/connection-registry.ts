import type { DurableStreamConnection } from "@durable-streams/tanstack-ai-transport";

const refCounts = new Map<string, number>();
const connections = new Map<string, DurableStreamConnection>();

/** Connection identity: agent + credentials + resume offset. */
export function connectionKey(
  agentId: string,
  token: string,
  initialOffset?: string | null,
): string {
  return `${agentId}|${token}|${initialOffset ?? ""}`;
}

/**
 * Ref-counted connection pool. Strict Mode safe: paired acquire/release in
 * effect cleanups prevent double-free.
 */
export function acquireConnection(
  key: string,
  factory: () => DurableStreamConnection,
): DurableStreamConnection {
  const next = (refCounts.get(key) ?? 0) + 1;
  refCounts.set(key, next);
  let connection = connections.get(key);
  if (!connection) {
    connection = factory();
    connections.set(key, connection);
  }
  return connection;
}

export function releaseConnection(key: string): void {
  const current = refCounts.get(key) ?? 0;
  if (current <= 1) {
    refCounts.delete(key);
    connections.delete(key);
    return;
  }
  refCounts.set(key, current - 1);
}

export function connectionRefCount(key: string): number {
  return refCounts.get(key) ?? 0;
}

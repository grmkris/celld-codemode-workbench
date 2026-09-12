import type { DurableStreamConnection } from "@durable-streams/tanstack-ai-transport";

const refCounts = new Map<string, number>();
const connections = new Map<string, DurableStreamConnection>();

/**
 * Ref-counted connection pool keyed by conversation id. Strict Mode safe:
 * paired acquire/release in effect cleanups prevent double-free.
 */
export function acquireConnection(
  conversationKey: string,
  factory: () => DurableStreamConnection,
): DurableStreamConnection {
  const next = (refCounts.get(conversationKey) ?? 0) + 1;
  refCounts.set(conversationKey, next);
  let connection = connections.get(conversationKey);
  if (!connection) {
    connection = factory();
    connections.set(conversationKey, connection);
  }
  return connection;
}

export function releaseConnection(conversationKey: string): void {
  const current = refCounts.get(conversationKey) ?? 0;
  if (current <= 1) {
    refCounts.delete(conversationKey);
    connections.delete(conversationKey);
    return;
  }
  refCounts.set(conversationKey, current - 1);
}

export function connectionRefCount(conversationKey: string): number {
  return refCounts.get(conversationKey) ?? 0;
}

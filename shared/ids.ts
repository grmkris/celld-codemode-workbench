export function newId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function validOwnerId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value);
}

export function validAgentId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value);
}

export function cellName(ownerId: string, agentId: string): string {
  return `${ownerId}:${agentId}`;
}

export function scopedOperationId(
  ownerId: string,
  executionId: string,
  capability: string,
  argsHash: string,
): string {
  return `${ownerId}:${executionId}:${capability}:${argsHash.slice(0, 32)}`;
}

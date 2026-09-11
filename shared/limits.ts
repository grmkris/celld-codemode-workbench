export const LIMITS = {
  memoryKeyBytes: 128,
  memoryValueBytes: 8_192,
  memoryEntries: 256,
  taskTitleBytes: 240,
  taskNotesBytes: 4_096,
  openTasks: 100,
  snippetSourceBytes: 32_768,
  snippetVersionsPerName: 32,
  snippetNames: 32,
  snippetRepairAttempts: 4,
  logLines: 64,
  logBytes: 8_192,
  resultBytes: 16_384,
  hostCallsPerExecution: 40,
  concurrentHostCalls: 4,
  hostCallTimeoutMs: 3_000,
  executionTimeoutMs: 8_000,
  isolateMemoryMb: 16,
  isolateStackBytes: 128 * 1024,
  isolateFuelTicks: 250_000,
  eventsRetained: 2_000,
  operationsRetained: 500,
  scheduleCatchUp: 1,
  approvalTtlMs: 30 * 60_000,
  messageBytes: 8_192,
  queuedMessages: 8,
  preferencesBytes: 2_048,
  notifyMessageBytes: 2_048,
} as const;

export const LOW_RISK_CAPABILITIES = [
  "inspect",
  "memory",
  "tasks",
  "snippets",
  "schedules",
  "config",
] as const;

export const PROTECTED_CAPABILITIES = ["integrations"] as const;

export const ALL_CAPABILITIES = [...LOW_RISK_CAPABILITIES, ...PROTECTED_CAPABILITIES] as const;

export type CapabilityName = (typeof ALL_CAPABILITIES)[number];

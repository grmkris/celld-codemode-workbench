import { HostError } from "../../shared/errors";
import type { CommandDedupResult, CommandRow } from "./types";

export function resolveCommandDedup(
  existing: CommandRow | null,
  payloadHash: string,
): CommandDedupResult | null {
  if (!existing) return null;
  if (String(existing.payload_hash) !== payloadHash) {
    throw new HostError("conflict", "Command id reused with different payload", 409);
  }
  if (!existing.outcome_json) {
    throw new HostError("conflict", "Command is still in flight", 409);
  }
  return {
    replay: true,
    outcome: JSON.parse(String(existing.outcome_json)) as unknown,
  };
}

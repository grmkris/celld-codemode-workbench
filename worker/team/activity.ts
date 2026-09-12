import { HostError } from "../../shared/errors";

export type ConversationActivityInput = {
  lastMessage?: string;
  runStatus?: string;
  activityRevision?: number;
};

export type ConversationPatchInput = {
  title?: string;
  archived?: boolean;
  expectedActivityRevision?: number;
};

export function assertActivityRevision(value: unknown, field = "activityRevision"): number {
  const revision = Number(value ?? 0);
  if (!Number.isFinite(revision) || revision < 0) {
    throw new HostError("invalid", `${field} must be a non-negative number`, 400);
  }
  return Math.floor(revision);
}

/** Ordinal fence: stale activity pushes cannot overwrite newer previews. */
export function shouldAcceptActivityPush(
  currentRevision: number,
  incomingRevision: number,
): { accepted: boolean; reason?: "stale_revision" } {
  if (incomingRevision < currentRevision) {
    return { accepted: false, reason: "stale_revision" };
  }
  return { accepted: true };
}

export function nextActivityRevision(currentRevision: number, incomingRevision?: number): number {
  const incoming = incomingRevision ?? currentRevision + 1;
  return Math.max(currentRevision + 1, incoming);
}

export function patchRequiresCas(input: ConversationPatchInput): boolean {
  return input.expectedActivityRevision !== undefined;
}

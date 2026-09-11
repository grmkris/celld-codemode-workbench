import { Brand } from "effect";
import { HostError } from "./errors";

/** Opaque Durable Streams offset — never treat as an entity id. */
export type StreamOffset = string & Brand.Brand<"StreamOffset">;
export const StreamOffset = Brand.nominal<StreamOffset>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PrefixedIdApi<B extends string> {
  readonly prefix: string;
  readonly generate: () => B;
  readonly parse: (input: unknown) => B;
  readonly is: (input: unknown) => input is B;
  readonly fromUuid: (uuid: string) => B;
  readonly toUuid: (id: B) => string;
}

function makePrefixedId<B extends string>(prefix: string): PrefixedIdApi<B> {
  const pattern = new RegExp(
    `^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
  );
  const brand = (value: string): B => value as B;

  return {
    prefix,
    generate: () => brand(`${prefix}_${crypto.randomUUID()}`),
    parse: (input: unknown) => {
      if (typeof input !== "string" || !pattern.test(input)) {
        throw new HostError("invalid", `Expected ${prefix}_<uuid>`, 400);
      }
      return brand(input);
    },
    is: (input: unknown): input is B => typeof input === "string" && pattern.test(input),
    fromUuid: (uuid: string) => {
      if (!UUID_RE.test(uuid)) {
        throw new HostError("invalid", `Invalid UUID for ${prefix}`, 400);
      }
      return brand(`${prefix}_${uuid.toLowerCase()}`);
    },
    toUuid: (id: B) => String(id).slice(prefix.length + 1),
  };
}

export type UserId = string & Brand.Brand<"UserId">;
export type TeamId = string & Brand.Brand<"TeamId">;
export type MembershipId = string & Brand.Brand<"MembershipId">;
export type InvitationId = string & Brand.Brand<"InvitationId">;
export type ConversationId = string & Brand.Brand<"ConversationId">;
export type MessageId = string & Brand.Brand<"MessageId">;
export type RunId = string & Brand.Brand<"RunId">;
export type CommandId = string & Brand.Brand<"CommandId">;
export type OperationId = string & Brand.Brand<"OperationId">;
export type TaskId = string & Brand.Brand<"TaskId">;
export type AttemptId = string & Brand.Brand<"AttemptId">;
export type MachineId = string & Brand.Brand<"MachineId">;
export type EnvironmentId = string & Brand.Brand<"EnvironmentId">;
export type WorkspaceVersionId = string & Brand.Brand<"WorkspaceVersionId">;
export type ArtifactId = string & Brand.Brand<"ArtifactId">;
export type EventId = string & Brand.Brand<"EventId">;
export type AgentProfileId = string & Brand.Brand<"AgentProfileId">;
export type ProjectId = string & Brand.Brand<"ProjectId">;

export const UserId = makePrefixedId<UserId>("user");
export const TeamId = makePrefixedId<TeamId>("team");
export const MembershipId = makePrefixedId<MembershipId>("mem");
export const InvitationId = makePrefixedId<InvitationId>("inv");
export const ConversationId = makePrefixedId<ConversationId>("conv");
export const MessageId = makePrefixedId<MessageId>("msg");
export const RunId = makePrefixedId<RunId>("run");
export const CommandId = makePrefixedId<CommandId>("cmd");
export const OperationId = makePrefixedId<OperationId>("op");
export const TaskId = makePrefixedId<TaskId>("task");
export const AttemptId = makePrefixedId<AttemptId>("att");
export const MachineId = makePrefixedId<MachineId>("mach");
export const EnvironmentId = makePrefixedId<EnvironmentId>("env");
export const WorkspaceVersionId = makePrefixedId<WorkspaceVersionId>("wsv");
export const ArtifactId = makePrefixedId<ArtifactId>("art");
export const EventId = makePrefixedId<EventId>("evt");
export const AgentProfileId = makePrefixedId<AgentProfileId>("aprof");
export const ProjectId = makePrefixedId<ProjectId>("proj");

/** Compile-time rejection of mixed ID kinds is enforced by distinct Brand keys. */
export type AssertDistinctIds = UserId extends TeamId ? never : true;

/** Legacy-compatible id generator used by existing cells. */
export function newId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function validOwnerId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value) || UserId.is(value);
}

export function validAgentId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value) || ConversationId.is(value);
}

export function cellName(ownerId: string, agentId: string): string {
  return `${ownerId}:${agentId}`;
}

/** Physical conversation cell address — never embed the viewing user id. */
export function conversationCellName(teamId: string, conversationId: string): string {
  return `team:${teamId}:conv:${conversationId}`;
}

export function scopedOperationId(
  ownerId: string,
  executionId: string,
  capability: string,
  argsHash: string,
): string {
  return `${ownerId}:${executionId}:${capability}:${argsHash.slice(0, 32)}`;
}

export function parseStreamOffset(input: unknown): StreamOffset {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) {
    throw new HostError("invalid", "Invalid stream offset", 400);
  }
  return StreamOffset(input);
}

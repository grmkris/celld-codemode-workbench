import { createStateSchema } from "@durable-streams/state";
import { z } from "zod";

export const conversationSummarySchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string(),
  cellAddress: z.string(),
  activityRevision: z.number(),
  lastMessage: z.string(),
  runStatus: z.string(),
  archived: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const approvalSchema = z.object({
  id: z.string(),
  capability: z.string(),
  argsJson: z.string(),
  status: z.string(),
  conversationId: z.string().optional(),
});

export const checklistTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  conversationId: z.string().optional(),
});

export const machineSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  status: z.enum(["pending", "approved", "draining", "revoked"]),
  labelsJson: z.string().optional(),
  lastSeenAt: z.number().nullable().optional(),
  createdAt: z.number(),
});

export const delegatedTaskSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  conversationId: z.string(),
  status: z.string(),
  title: z.string(),
  updatedAt: z.number(),
});

export const teamRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  personal: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ApprovalRecord = z.infer<typeof approvalSchema>;
export type ChecklistTaskRecord = z.infer<typeof checklistTaskSchema>;
export type MachineRecord = z.infer<typeof machineSchema>;
export type DelegatedTaskRecord = z.infer<typeof delegatedTaskSchema>;
export type TeamRecord = z.infer<typeof teamRecordSchema>;

export const teamStateSchema = createStateSchema({
  conversations: {
    schema: conversationSummarySchema,
    type: "conversation",
    primaryKey: "id",
  },
  approvals: {
    schema: approvalSchema,
    type: "approval",
    primaryKey: "id",
  },
  checklistTasks: {
    schema: checklistTaskSchema,
    type: "checklistTask",
    primaryKey: "id",
  },
  machines: {
    schema: machineSchema,
    type: "machine",
    primaryKey: "id",
  },
  delegatedTasks: {
    schema: delegatedTaskSchema,
    type: "delegatedTask",
    primaryKey: "id",
  },
  teams: {
    schema: teamRecordSchema,
    type: "team",
    primaryKey: "id",
  },
});

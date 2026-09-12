/**
 * TeamCell uses a single global registry Durable Object (`idFromName("global")`).
 * All teams, memberships, invitations, and conversation indexes live in one
 * SQLite database — TeamCell is the ownership boundary, not one cell per row.
 */
import { bytesOf } from "../shared/crypto";
import { HostError } from "../shared/errors";
import {
  ConversationId,
  InvitationId,
  MachineId,
  MembershipId,
  TaskId,
  TeamId,
  conversationCellName,
  taskCellName,
  validAgentId,
  validOwnerId,
} from "../shared/ids";
import {
  enrollmentTokenIsUsable,
  generateEnrollmentToken,
  generateMachineCredential,
  hashEnrollmentToken,
  hashMachineCredential,
  normalizeEnrollmentTtlSeconds,
  type EnrollmentTokenRow,
} from "./team/enrollment";
import {
  assertMachineCredential,
  countActiveAssignments,
  machineCanAcceptWork,
  parseCapacities,
  parseLabels,
  type MachineRow,
} from "./team/machines";
import {
  decideRequeueAssignments,
  decideStaleMachines,
  MACHINE_STALE_AFTER_MS,
  TEAM_SWEEP_ALARM_MS,
} from "./team/sweep";
import { LIMITS } from "../shared/limits";
import {
  assertActivityRevision,
  nextActivityRevision,
  shouldAcceptActivityPush,
} from "./team/activity";
import {
  buildAcceptUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationIsAcceptable,
  invitationRejectReason,
  normalizeInvitationTtlSeconds,
  type InvitationRow,
} from "./team/invitations";
import {
  canManageInvitations,
  canManageMachines,
  canWriteConversations,
  parseTeamRole,
  requireRole,
  type TeamRole,
} from "./team/roles";
import { TEAM_SCHEMA_SQL, TEAM_SCHEMA_VERSION } from "./team-schema";
import { Sql } from "./sql";
import type { Env } from "./env";

type TeamRow = {
  id: string;
  name: string;
  personal_user_id: string | null;
  created_at: number;
  updated_at: number;
};

type MembershipRow = {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  created_at: number;
};

type ConversationRow = {
  id: string;
  team_id: string;
  title: string;
  cell_address: string;
  activity_revision: number;
  last_message: string;
  run_status: string;
  archived: number;
  created_at: number;
  updated_at: number;
};

export class TeamCell {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = new Sql(ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.sql.migrate(TEAM_SCHEMA_SQL, TEAM_SCHEMA_VERSION);
      await this.armMachineSweepAlarm();
    });
  }

  async alarm(): Promise<void> {
    this.applyMachineSweep(Date.now());
    await this.armMachineSweepAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = request.headers.get("x-celld-user") ?? "";

    try {
      if (request.method === "POST" && url.pathname === "/bootstrap-personal") {
        return this.bootstrapPersonal(userId, await request.json());
      }

      if (request.method === "POST" && url.pathname === "/activity") {
        return this.activity(await request.json());
      }

      if (request.method === "POST" && url.pathname === "/machines/enroll") {
        return await this.enrollMachine(await request.json());
      }

      const machineMatch = url.pathname.match(/^\/machines\/([^/]+)(\/.*)?$/);
      if (machineMatch) {
        const machineId = MachineId.parse(decodeURIComponent(machineMatch[1]));
        const rest = machineMatch[2] ?? "";

        if (request.method === "POST" && rest === "/poll") {
          return await this.pollMachine(machineId, await request.json(), request);
        }
        if (request.method === "POST" && rest === "/heartbeat") {
          const body = (await request.json().catch(() => ({}))) as {
            attempts?: Array<{
              attemptId?: string;
              taskCellAddress?: string;
              lease?: string;
              generation?: number;
              ttlMs?: number;
            }>;
          };
          return await this.heartbeatMachine(machineId, request, body);
        }
        if (request.method === "POST" && rest === "/drain") {
          return await this.drainMachine(machineId, request, userId);
        }
        const attemptEvents = rest.match(/^\/attempts\/([^/]+)\/events$/);
        if (request.method === "POST" && attemptEvents) {
          return await this.proxyMachineAttemptEvents(
            machineId,
            decodeURIComponent(attemptEvents[1]),
            request,
            await request.json(),
          );
        }
        if (request.method === "POST" && rest === "/revoke") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.revokeMachine(userId, machineId);
        }
      }

      if (request.method === "POST" && url.pathname === "/invitations/accept") {
        if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
        return await this.acceptInvitation(userId, await request.json(), request);
      }

      const invitationRevoke = url.pathname.match(/^\/invitations\/([^/]+)\/revoke$/);
      if (request.method === "POST" && invitationRevoke) {
        if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
        return this.revokeInvitation(
          userId,
          InvitationId.parse(decodeURIComponent(invitationRevoke[1])),
        );
      }

      if (request.method === "GET" && url.pathname === "/teams") {
        if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
        return this.listTeams(userId);
      }

      if (request.method === "POST" && url.pathname === "/teams") {
        if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
        return this.createTeam(userId, await request.json());
      }

      const teamMatch = url.pathname.match(/^\/teams\/([^/]+)(\/.*)?$/);
      if (teamMatch) {
        const teamId = TeamId.parse(decodeURIComponent(teamMatch[1]));
        const rest = teamMatch[2] ?? "";

        if (request.method === "GET" && rest === "") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.getTeam(userId, teamId);
        }

        if (request.method === "POST" && rest === "/invitations") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return await this.createInvitation(userId, teamId, await request.json(), request);
        }

        if (request.method === "GET" && rest === "/members") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.listMembers(userId, teamId);
        }

        const memberMatch = rest.match(/^\/members\/([^/]+)$/);
        if (request.method === "DELETE" && memberMatch) {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.removeMember(userId, teamId, decodeURIComponent(memberMatch[1]));
        }

        if (request.method === "GET" && rest === "/conversations") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.listConversations(userId, teamId);
        }

        if (request.method === "POST" && rest === "/conversations") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.createConversation(userId, teamId, await request.json());
        }

        if (request.method === "POST" && rest === "/conversations/link-legacy") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.linkLegacyConversation(userId, teamId, await request.json());
        }

        if (request.method === "POST" && rest === "/machines/enrollment-tokens") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return await this.createEnrollmentToken(userId, teamId, await request.json());
        }

        if (request.method === "GET" && rest === "/machines") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.listMachines(userId, teamId);
        }

        if (request.method === "GET" && rest === "/resources/eligible") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.listEligibleResources(userId, teamId);
        }

        if (request.method === "POST" && rest === "/task-assignments") {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.queueTaskAssignmentRoute(userId, teamId, await request.json());
        }

        const cancelAssignment = rest.match(/^\/task-assignments\/([^/]+)\/cancel$/);
        if (request.method === "POST" && cancelAssignment) {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.cancelTaskAssignment(userId, teamId, decodeURIComponent(cancelAssignment[1]));
        }

        const cancelByTask = rest.match(/^\/task-assignments\/by-task\/([^/]+)\/cancel$/);
        if (request.method === "POST" && cancelByTask) {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          this.requireMembership(userId, teamId, "member");
          const updated = this.requestAssignmentCancel(teamId, decodeURIComponent(cancelByTask[1]));
          return json({ ok: true, updated, cancelRequested: true });
        }

        const conversationMatch = rest.match(/^\/conversations\/([^/]+)$/);
        if (request.method === "PATCH" && conversationMatch) {
          if (!requireUserId(userId)) return json({ error: "missing user id" }, 401);
          return this.patchConversation(
            userId,
            teamId,
            ConversationId.parse(decodeURIComponent(conversationMatch[1])),
            await request.json(),
          );
        }
      }

      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HostError || (error instanceof Error && error.name === "HostError")) {
        const host = error as HostError;
        return json({ error: host.message, code: host.code }, host.status ?? 400);
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  private bootstrapPersonal(
    headerUserId: string,
    body: { userId?: string; name?: string },
  ): Response {
    const userId = parseUserId(body.userId ?? headerUserId);
    const existing = this.personalTeam(userId);
    if (existing) {
      this.ensureOwnerMembership(TeamId.parse(existing.id), userId);
      return json({ team: publicTeam(existing), created: false });
    }

    const now = Date.now();
    const teamId = TeamId.generate();
    const name = normalizeTeamName(body.name, "Personal");
    this.sql.exec(
      `INSERT INTO teams(id, name, personal_user_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
      teamId,
      name,
      userId,
      now,
      now,
    );
    this.ensureOwnerMembership(teamId, userId);
    const team = this.team(teamId)!;
    return json({ team: publicTeam(team), created: true }, 201);
  }

  private listTeams(userId: string): Response {
    const rows = this.sql.exec(
      `SELECT t.id, t.name, t.personal_user_id, t.created_at, t.updated_at, m.role
       FROM memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = ?
       ORDER BY t.updated_at DESC, t.created_at DESC`,
      userId,
    ) as Array<TeamRow & { role: TeamRole }>;
    return json({
      teams: rows.map((row) => ({
        ...publicTeam(row),
        role: row.role,
        personal: row.personal_user_id === userId,
      })),
    });
  }

  private createTeam(userId: string, body: { name?: string }): Response {
    const now = Date.now();
    const teamId = TeamId.generate();
    const name = normalizeTeamName(body.name, "Team");
    this.sql.exec(
      `INSERT INTO teams(id, name, personal_user_id, created_at, updated_at)
       VALUES(?, ?, NULL, ?, ?)`,
      teamId,
      name,
      now,
      now,
    );
    this.insertMembership(teamId, userId, "owner", now);
    return json({ team: publicTeam(this.team(teamId)!) }, 201);
  }

  private getTeam(userId: string, teamId: TeamId): Response {
    this.requireMembership(userId, teamId, "viewer");
    const team = this.team(teamId);
    if (!team) throw new HostError("not_found", "Team not found", 404);
    return json({ team: publicTeam(team) });
  }

  private async createInvitation(
    userId: string,
    teamId: TeamId,
    body: { role?: string; emailHint?: string; ttlSeconds?: number },
    request: Request,
  ): Promise<Response> {
    const role = this.requireMembership(userId, teamId, "admin");
    if (!canManageInvitations(role)) {
      throw new HostError("forbidden", "Requires admin role to invite", 403);
    }

    const inviteRole = parseTeamRole(body.role ?? "member");
    if (inviteRole === "owner") {
      throw new HostError("invalid", "Cannot invite as owner", 400);
    }

    const ttlSeconds = normalizeInvitationTtlSeconds(body.ttlSeconds);
    const token = generateInvitationToken();
    const tokenHash = await hashInvitationToken(token);
    const invitationId = InvitationId.generate();
    const now = Date.now();
    const emailHint = normalizeEmailHint(body.emailHint);

    this.sql.exec(
      `INSERT INTO invitations(
         id, team_id, role, token_hash, email_hint, expires_at, revoked_at,
         accepted_by, accepted_at, created_by, created_at
       ) VALUES(?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      invitationId,
      teamId,
      inviteRole,
      tokenHash,
      emailHint,
      now + ttlSeconds * 1000,
      userId,
      now,
    );

    return json(
      {
        invitationId,
        token,
        acceptUrl: buildAcceptUrl(new URL(request.url).origin, token),
        expiresAt: now + ttlSeconds * 1000,
        role: inviteRole,
      },
      201,
    );
  }

  private async acceptInvitation(
    userId: string,
    body: { token?: string },
    request: Request,
  ): Promise<Response> {
    const token = String(body.token ?? new URL(request.url).searchParams.get("token") ?? "").trim();
    if (!token) throw new HostError("invalid", "Missing invitation token", 400);

    const tokenHash = await hashInvitationToken(token);
    const invitation = this.sql.one<InvitationRow>(
      "SELECT * FROM invitations WHERE token_hash = ?",
      tokenHash,
    );
    if (!invitation) throw new HostError("not_found", "Invitation not found", 404);
    if (!invitationIsAcceptable(invitation)) {
      throw new HostError("invalid", `Invitation ${invitationRejectReason(invitation)}`, 409);
    }

    const teamId = TeamId.parse(invitation.team_id);
    const existing = this.membership(teamId, userId);
    if (existing) {
      return json({
        teamId,
        membershipId: existing.id,
        role: existing.role,
        alreadyMember: true,
      });
    }

    const now = Date.now();
    const membershipId = MembershipId.generate();
    const role = parseTeamRole(invitation.role);

    this.sql.transaction(() => {
      this.sql.exec(
        `INSERT INTO memberships(id, team_id, user_id, role, created_at)
         VALUES(?, ?, ?, ?, ?)`,
        membershipId,
        teamId,
        userId,
        role,
        now,
      );
      this.sql.exec(
        `UPDATE invitations
         SET accepted_by = ?, accepted_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
        userId,
        now,
        invitation.id,
      );
      this.sql.exec("UPDATE teams SET updated_at = ? WHERE id = ?", now, teamId);
    });

    return json({ teamId, membershipId, role, alreadyMember: false }, 201);
  }

  private revokeInvitation(userId: string, invitationId: InvitationId): Response {
    const invitation = this.sql.one<InvitationRow>(
      "SELECT * FROM invitations WHERE id = ?",
      invitationId,
    );
    if (!invitation) throw new HostError("not_found", "Invitation not found", 404);

    const teamId = TeamId.parse(invitation.team_id);
    const role = this.requireMembership(userId, teamId, "admin");
    if (!canManageInvitations(role)) {
      throw new HostError("forbidden", "Requires admin role to revoke invitations", 403);
    }
    if (invitation.accepted_at != null) {
      throw new HostError("conflict", "Invitation already accepted", 409);
    }
    if (invitation.revoked_at != null) {
      return json({ invitationId, revoked: true, revokedAt: invitation.revoked_at });
    }

    const now = Date.now();
    this.sql.exec("UPDATE invitations SET revoked_at = ? WHERE id = ?", now, invitationId);
    return json({ invitationId, revoked: true, revokedAt: now });
  }

  private listMembers(userId: string, teamId: TeamId): Response {
    this.requireMembership(userId, teamId, "viewer");
    const rows = this.sql.exec(
      `SELECT id, team_id, user_id, role, created_at
       FROM memberships WHERE team_id = ?
       ORDER BY created_at ASC`,
      teamId,
    ) as MembershipRow[];
    return json({ members: rows.map(publicMember) });
  }

  private removeMember(userId: string, teamId: TeamId, targetUserIdRaw: string): Response {
    const actorRole = this.requireMembership(userId, teamId, "admin");
    if (!canManageInvitations(actorRole)) {
      throw new HostError("forbidden", "Requires admin role to remove members", 403);
    }

    const targetUserId = parseUserId(targetUserIdRaw);
    const target = this.membership(teamId, targetUserId);
    if (!target) throw new HostError("not_found", "Member not found", 404);

    if (target.role === "owner") {
      const owners = this.sql.one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM memberships WHERE team_id = ? AND role = 'owner'",
        teamId,
      );
      if (Number(owners?.n ?? 0) <= 1) {
        throw new HostError("conflict", "Cannot remove the last owner", 409);
      }
    }

    this.sql.exec(
      "DELETE FROM memberships WHERE team_id = ? AND user_id = ?",
      teamId,
      targetUserId,
    );
    return json({ removed: true, userId: targetUserId });
  }

  private listConversations(userId: string, teamId: TeamId): Response {
    this.requireMembership(userId, teamId, "viewer");
    const rows = this.sql.exec(
      `SELECT id, team_id, title, cell_address, activity_revision, last_message, run_status,
              archived, created_at, updated_at
       FROM conversations
       WHERE team_id = ? AND archived = 0
       ORDER BY updated_at DESC, created_at DESC`,
      teamId,
    ) as ConversationRow[];
    return json({ conversations: rows.map(publicConversation) });
  }

  private createConversation(
    userId: string,
    teamId: TeamId,
    body: { title?: string; profileId?: string },
  ): Response {
    const role = this.requireMembership(userId, teamId, "member");
    if (!canWriteConversations(role)) {
      throw new HostError("forbidden", "Requires member role to create conversations", 403);
    }

    const conversationId = ConversationId.generate();
    const cellAddress = conversationCellName(teamId, conversationId);
    const title = normalizeConversationTitle(body.title, conversationId);
    const now = Date.now();

    this.sql.exec(
      `INSERT INTO conversations(
         id, team_id, title, cell_address, activity_revision, last_message, run_status,
         archived, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 0, '', 'idle', 0, ?, ?)`,
      conversationId,
      teamId,
      title,
      cellAddress,
      now,
      now,
    );
    this.sql.exec("UPDATE teams SET updated_at = ? WHERE id = ?", now, teamId);

    return json(
      {
        conversation: publicConversation(this.conversation(teamId, conversationId)!),
        profileId: body.profileId ?? null,
      },
      201,
    );
  }

  private linkLegacyConversation(
    userId: string,
    teamId: TeamId,
    body: { legacyOwnerId?: string; legacyAgentId?: string; title?: string },
  ): Response {
    const role = this.requireMembership(userId, teamId, "member");
    if (!canWriteConversations(role)) {
      throw new HostError("forbidden", "Requires member role to link conversations", 403);
    }

    const legacyOwnerId = String(body.legacyOwnerId ?? "").trim();
    const legacyAgentId = String(body.legacyAgentId ?? "").trim();
    if (!validOwnerId(legacyOwnerId)) {
      throw new HostError("invalid", "Invalid legacyOwnerId", 400);
    }
    if (!validAgentId(legacyAgentId)) {
      throw new HostError("invalid", "Invalid legacyAgentId", 400);
    }

    const cellAddress = `legacy:${legacyOwnerId}:${legacyAgentId}`;
    const existing = this.sql.one<{ id: string }>(
      "SELECT id FROM conversations WHERE team_id = ? AND cell_address = ?",
      teamId,
      cellAddress,
    );
    if (existing) {
      const row = this.conversation(teamId, ConversationId.parse(existing.id))!;
      return json({ conversation: publicConversation(row), linked: false });
    }

    const conversationId = ConversationId.generate();
    const title = normalizeConversationTitle(body.title, legacyAgentId);
    const now = Date.now();

    this.sql.exec(
      `INSERT INTO conversations(
         id, team_id, title, cell_address, activity_revision, last_message, run_status,
         archived, created_at, updated_at
       ) VALUES(?, ?, ?, ?, 0, '', 'idle', 0, ?, ?)`,
      conversationId,
      teamId,
      title,
      cellAddress,
      now,
      now,
    );
    this.sql.exec("UPDATE teams SET updated_at = ? WHERE id = ?", now, teamId);

    return json(
      {
        conversation: publicConversation(this.conversation(teamId, conversationId)!),
        linked: true,
      },
      201,
    );
  }

  private patchConversation(
    userId: string,
    teamId: TeamId,
    conversationId: ConversationId,
    body: { title?: string; archived?: boolean; expectedActivityRevision?: number },
  ): Response {
    const role = this.requireMembership(userId, teamId, "member");
    if (!canWriteConversations(role)) {
      throw new HostError("forbidden", "Requires member role to update conversations", 403);
    }

    const row = this.conversation(teamId, conversationId);
    if (!row) throw new HostError("not_found", "Conversation not found", 404);

    const hasTitle = body.title !== undefined;
    const hasArchived = body.archived !== undefined;
    if (!hasTitle && !hasArchived) {
      throw new HostError("invalid", "No updates provided", 400);
    }

    const expectedRevision =
      body.expectedActivityRevision === undefined
        ? undefined
        : assertActivityRevision(body.expectedActivityRevision, "expectedActivityRevision");

    const now = Date.now();
    const nextRevision = Number(row.activity_revision) + 1;
    const title = hasTitle ? normalizeConversationTitle(body.title, row.id) : row.title;
    const archived = hasArchived ? (body.archived ? 1 : 0) : Number(row.archived);

    if (expectedRevision !== undefined && expectedRevision !== Number(row.activity_revision)) {
      throw new HostError("conflict", "Stale activity revision", 409);
    }

    const updated = this.sql.transaction(() => {
      if (expectedRevision !== undefined) {
        this.sql.exec(
          `UPDATE conversations
           SET title = ?, archived = ?, activity_revision = ?, updated_at = ?
           WHERE id = ? AND team_id = ? AND activity_revision = ?`,
          title,
          archived,
          nextRevision,
          now,
          conversationId,
          teamId,
          expectedRevision,
        );
      } else {
        this.sql.exec(
          `UPDATE conversations
           SET title = ?, archived = ?, activity_revision = ?, updated_at = ?
           WHERE id = ? AND team_id = ?`,
          title,
          archived,
          nextRevision,
          now,
          conversationId,
          teamId,
        );
      }
      return this.conversation(teamId, conversationId);
    });

    if (expectedRevision !== undefined && Number(updated?.activity_revision) !== nextRevision) {
      throw new HostError("conflict", "Stale activity revision", 409);
    }

    return json({ conversation: publicConversation(updated!) });
  }

  private activity(body: {
    teamId?: string;
    conversationId?: string;
    lastMessage?: string;
    runStatus?: string;
    activityRevision?: number;
  }): Response {
    const teamId = TeamId.parse(body.teamId);
    const conversationId = ConversationId.parse(body.conversationId);
    const row = this.conversation(teamId, conversationId);
    if (!row || Number(row.archived)) {
      return json({ accepted: false, reason: "missing_or_archived" });
    }

    const incomingRevision = assertActivityRevision(
      body.activityRevision ?? Number(row.activity_revision) + 1,
    );
    const gate = shouldAcceptActivityPush(Number(row.activity_revision), incomingRevision);
    if (!gate.accepted) {
      return json({
        accepted: false,
        reason: gate.reason,
        activityRevision: row.activity_revision,
      });
    }

    const lastMessage = truncate(
      String(body.lastMessage ?? row.last_message ?? ""),
      LIMITS.chatPreviewBytes,
    );
    const runStatus = String(body.runStatus ?? row.run_status ?? "idle").slice(0, 64);
    const revision = nextActivityRevision(Number(row.activity_revision), incomingRevision);
    const now = Date.now();

    this.sql.exec(
      `UPDATE conversations
       SET last_message = ?, run_status = ?, activity_revision = ?, updated_at = ?
       WHERE id = ? AND team_id = ? AND archived = 0 AND activity_revision <= ?`,
      lastMessage,
      runStatus,
      revision,
      now,
      conversationId,
      teamId,
      incomingRevision,
    );

    return json({ accepted: true, activityRevision: revision });
  }

  private team(id: TeamId): TeamRow | null {
    return this.sql.one<TeamRow>("SELECT * FROM teams WHERE id = ?", id);
  }

  private personalTeam(userId: string): TeamRow | null {
    return this.sql.one<TeamRow>("SELECT * FROM teams WHERE personal_user_id = ?", userId);
  }

  private membership(teamId: TeamId, userId: string): MembershipRow | null {
    return this.sql.one<MembershipRow>(
      "SELECT * FROM memberships WHERE team_id = ? AND user_id = ?",
      teamId,
      userId,
    );
  }

  private requireMembership(userId: string, teamId: TeamId, minimum: TeamRole): TeamRole {
    const row = this.membership(teamId, userId);
    return requireRole(row?.role ?? null, minimum, "access team");
  }

  private ensureOwnerMembership(teamId: TeamId, userId: string): void {
    const existing = this.membership(teamId, userId);
    if (existing) return;
    this.insertMembership(teamId, userId, "owner", Date.now());
  }

  private insertMembership(
    teamId: TeamId,
    userId: string,
    role: TeamRole,
    createdAt: number,
  ): void {
    this.sql.exec(
      `INSERT INTO memberships(id, team_id, user_id, role, created_at)
       VALUES(?, ?, ?, ?, ?)`,
      MembershipId.generate(),
      teamId,
      userId,
      role,
      createdAt,
    );
  }

  private conversation(teamId: TeamId, conversationId: ConversationId): ConversationRow | null {
    return this.sql.one<ConversationRow>(
      "SELECT * FROM conversations WHERE id = ? AND team_id = ?",
      conversationId,
      teamId,
    );
  }

  private async createEnrollmentToken(
    userId: string,
    teamId: TeamId,
    body: { ttlSeconds?: number },
  ): Promise<Response> {
    const role = this.requireMembership(userId, teamId, "admin");
    if (!canManageMachines(role)) {
      throw new HostError("forbidden", "Requires admin role to issue enrollment tokens", 403);
    }

    const ttlSeconds = normalizeEnrollmentTtlSeconds(body.ttlSeconds);
    const token = generateEnrollmentToken();
    const tokenHash = await hashEnrollmentToken(token);
    const now = Date.now();
    const id = MembershipId.generate();

    this.sql.exec(
      `INSERT INTO enrollment_tokens(id, team_id, token_hash, expires_at, revoked_at, created_by, created_at)
       VALUES(?, ?, ?, ?, NULL, ?, ?)`,
      id,
      teamId,
      tokenHash,
      now + ttlSeconds * 1000,
      userId,
      now,
    );

    return json(
      {
        enrollmentTokenId: id,
        token,
        expiresAt: now + ttlSeconds * 1000,
      },
      201,
    );
  }

  private async enrollMachine(body: {
    token?: string;
    name?: string;
    labels?: Record<string, string>;
    capacities?: Record<string, unknown>;
  }): Promise<Response> {
    const token = String(body.token ?? "").trim();
    if (!token) throw new HostError("invalid", "Missing enrollment token", 400);

    const tokenHash = await hashEnrollmentToken(token);
    const enrollment = this.sql.one<EnrollmentTokenRow>(
      "SELECT * FROM enrollment_tokens WHERE token_hash = ?",
      tokenHash,
    );
    if (!enrollment || !enrollmentTokenIsUsable(enrollment)) {
      throw new HostError("not_found", "Enrollment token invalid or expired", 404);
    }

    const teamId = TeamId.parse(enrollment.team_id);
    const name =
      String(body.name ?? "supervisor")
        .trim()
        .slice(0, 120) || "supervisor";
    const labels = JSON.stringify(body.labels ?? {});
    const capacities = JSON.stringify(
      parseCapacities(JSON.stringify(body.capacities ?? { workspaces: 1 })),
    );
    const credential = generateMachineCredential();
    const credentialHash = await hashMachineCredential(credential);
    const machineId = MachineId.generate();
    const now = Date.now();

    this.sql.transaction(() => {
      this.sql.exec(
        `INSERT INTO machines(
           id, team_id, name, status, labels_json, capacities_json, credential_hash,
           last_seen_at, created_at
         ) VALUES(?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
        machineId,
        teamId,
        name,
        labels,
        capacities,
        credentialHash,
        now,
        now,
      );
      this.sql.exec("UPDATE enrollment_tokens SET revoked_at = ? WHERE id = ?", now, enrollment.id);
    });

    return json(
      {
        machineId,
        teamId,
        credential,
        status: "approved",
      },
      201,
    );
  }

  private async pollMachine(
    machineId: MachineId,
    body: { lease?: string; timeoutMs?: number },
    request: Request,
  ): Promise<Response> {
    const machine = await this.requireMachineAuth(machineId, request);
    if (!machineCanAcceptWork(machine.status)) {
      return json({ assignments: [], cancels: [], machineStatus: machine.status });
    }

    const capacities = parseCapacities(machine.capacities_json);
    const activeRows = this.sql.exec(
      `SELECT status FROM task_assignments
       WHERE machine_id = ? AND status IN ('assigned', 'running')`,
      machineId,
    ) as Array<{ status: string }>;
    const { available } = countActiveAssignments(activeRows, capacities);
    if (available <= 0) {
      return json({ assignments: [], cancels: [], capacityFull: true });
    }

    const now = Date.now();
    const pending = this.sql.one<{
      id: string;
      team_id: string;
      task_id: string;
      attempt_id: string;
      conversation_id: string;
      payload_json: string;
    }>(
      `SELECT id, team_id, task_id, attempt_id, conversation_id, payload_json
       FROM task_assignments
       WHERE team_id = ? AND status = 'pending' AND machine_id IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      machine.team_id,
    );

    const assignments = [];
    if (pending) {
      const updated = this.sql.transaction(() => {
        this.sql.exec(
          `UPDATE task_assignments
           SET machine_id = ?, status = 'assigned', updated_at = ?
           WHERE id = ? AND status = 'pending' AND machine_id IS NULL`,
          machineId,
          now,
          pending.id,
        );
        return this.sql.one<{ machine_id: string | null }>(
          "SELECT machine_id FROM task_assignments WHERE id = ?",
          pending.id,
        );
      });
      if (updated?.machine_id === machineId) {
        const payload = safeJsonParse(pending.payload_json) as Record<string, unknown>;
        assignments.push({
          assignmentId: pending.id,
          teamId: pending.team_id,
          taskId: pending.task_id,
          attemptId: pending.attempt_id,
          conversationId: pending.conversation_id,
          payload: {
            ...payload,
            lease: payload.lease ?? null,
            generation: payload.generation ?? null,
            taskCellAddress:
              payload.taskCellAddress ??
              taskCellName(String(pending.team_id), String(pending.conversation_id)),
          },
        });
      }
    }

    const cancels = this.sql.exec(
      `SELECT id, task_id, attempt_id, conversation_id, team_id
       FROM task_assignments
       WHERE machine_id = ? AND cancel_requested = 1 AND status IN ('assigned', 'running')`,
      machineId,
    ) as Array<{
      id: string;
      task_id: string;
      attempt_id: string;
      conversation_id: string;
      team_id: string;
    }>;

    for (const row of cancels) {
      const address = taskCellName(String(row.team_id), String(row.conversation_id));
      void this.env.TASK.get(this.env.TASK.idFromName(address))
        .fetch(
          new Request(
            `https://task.internal/tasks/${encodeURIComponent(row.task_id)}/signal-cancel`,
            { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
          ),
        )
        .catch(() => undefined);
    }

    this.sql.exec("UPDATE machines SET last_seen_at = ? WHERE id = ?", now, machineId);

    void body.lease;
    void body.timeoutMs;
    return json({
      assignments,
      cancels: cancels.map((row) => ({
        assignmentId: row.id,
        taskId: row.task_id,
        attemptId: row.attempt_id,
        conversationId: row.conversation_id,
      })),
    });
  }

  private async heartbeatMachine(
    machineId: MachineId,
    request: Request,
    body: {
      attempts?: Array<{
        attemptId?: string;
        taskCellAddress?: string;
        lease?: string;
        generation?: number;
        ttlMs?: number;
      }>;
    } = {},
  ): Promise<Response> {
    const machine = await this.requireMachineAuth(machineId, request);
    const now = Date.now();
    let status = machine.status;
    if (status === "stale") {
      status = "approved";
      this.sql.exec(
        "UPDATE machines SET last_seen_at = ?, status = 'approved' WHERE id = ?",
        now,
        machineId,
      );
    } else {
      this.sql.exec("UPDATE machines SET last_seen_at = ? WHERE id = ?", now, machineId);
    }

    const renewals: Array<{ attemptId: string; ok: boolean; error?: string }> = [];
    for (const attempt of body.attempts ?? []) {
      const attemptId = String(attempt.attemptId ?? "").trim();
      const taskCellAddress = String(attempt.taskCellAddress ?? "").trim();
      const lease = String(attempt.lease ?? "");
      const generation = Number(attempt.generation);
      if (!attemptId || !taskCellAddress || !lease || !Number.isFinite(generation)) {
        renewals.push({ attemptId: attemptId || "unknown", ok: false, error: "invalid" });
        continue;
      }
      try {
        const response = await this.env.TASK.get(this.env.TASK.idFromName(taskCellAddress)).fetch(
          new Request(
            `https://task.internal/attempts/${encodeURIComponent(attemptId)}/lease/renew`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                lease,
                generation,
                ttlMs: attempt.ttlMs,
              }),
            },
          ),
        );
        if (!response.ok) {
          const errBody = (await response.json().catch(() => ({}))) as { error?: string };
          renewals.push({
            attemptId,
            ok: false,
            error: String(errBody.error ?? response.status),
          });
        } else {
          renewals.push({ attemptId, ok: true });
        }
      } catch (error) {
        renewals.push({
          attemptId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.armMachineSweepAlarm();
    return json({
      ok: true,
      machineId,
      status,
      lastSeenAt: now,
      renewals,
    });
  }

  private async proxyMachineAttemptEvents(
    machineId: MachineId,
    attemptId: string,
    request: Request,
    body: {
      lease?: string;
      generation?: number;
      taskCellAddress?: string;
      conversationId?: string;
      teamId?: string;
      events?: Array<{ kind?: string; payload?: unknown }>;
    },
  ): Promise<Response> {
    await this.requireMachineAuth(machineId, request);
    const taskCellAddress =
      String(body.taskCellAddress ?? "").trim() ||
      (body.teamId && body.conversationId
        ? taskCellName(String(body.teamId), String(body.conversationId))
        : "");
    if (!taskCellAddress) {
      throw new HostError("invalid", "taskCellAddress required", 400);
    }
    const response = await this.env.TASK.get(this.env.TASK.idFromName(taskCellAddress)).fetch(
      new Request(`https://task.internal/attempts/${encodeURIComponent(attemptId)}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lease: body.lease,
          generation: body.generation,
          events: body.events ?? [],
        }),
      }),
    );
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  }

  private async drainMachine(
    machineId: MachineId,
    request: Request,
    userId: string,
  ): Promise<Response> {
    const machine = this.machine(machineId);
    if (!machine) throw new HostError("not_found", "Machine not found", 404);

    const credential = parseMachineCredential(request);
    if (credential) {
      await this.requireMachineAuth(machineId, request);
    } else if (requireUserId(userId)) {
      const role = this.requireMembership(userId, TeamId.parse(machine.team_id), "admin");
      if (!canManageMachines(role)) {
        throw new HostError("forbidden", "Requires admin role to drain machines", 403);
      }
    } else {
      throw new HostError("forbidden", "Machine credential or admin required", 403);
    }

    const now = Date.now();
    this.sql.exec("UPDATE machines SET status = 'draining' WHERE id = ?", machineId);
    return json({ machineId, status: "draining", updatedAt: now });
  }

  private revokeMachine(userId: string, machineId: MachineId): Response {
    const machine = this.machine(machineId);
    if (!machine) throw new HostError("not_found", "Machine not found", 404);
    const role = this.requireMembership(userId, TeamId.parse(machine.team_id), "admin");
    if (!canManageMachines(role)) {
      throw new HostError("forbidden", "Requires admin role to revoke machines", 403);
    }
    const now = Date.now();
    this.sql.exec(
      "UPDATE machines SET status = 'revoked', credential_hash = NULL WHERE id = ?",
      machineId,
    );
    return json({ machineId, status: "revoked", revokedAt: now });
  }

  private listMachines(userId: string, teamId: TeamId): Response {
    this.requireMembership(userId, teamId, "viewer");
    const rows = this.sql.exec(
      "SELECT * FROM machines WHERE team_id = ? ORDER BY created_at DESC",
      teamId,
    ) as MachineRow[];
    return json({ machines: rows.map(publicMachine) });
  }

  private listEligibleResources(userId: string, teamId: TeamId): Response {
    this.requireMembership(userId, teamId, "viewer");
    const profiles = this.sql.exec(
      `SELECT id, team_id, name, instructions, model, tools_json, created_at
       FROM agent_profiles WHERE team_id = ? ORDER BY created_at ASC LIMIT ?`,
      teamId,
      LIMITS.delegationFanOutMax,
    ) as Array<Record<string, unknown>>;
    const machines = this.sql.exec(
      `SELECT id, team_id, name, status, labels_json, capacities_json, last_seen_at, created_at
       FROM machines
       WHERE team_id = ? AND status IN ('approved', 'draining')
       ORDER BY created_at DESC LIMIT ?`,
      teamId,
      LIMITS.delegationFanOutMax,
    ) as MachineRow[];
    return json({
      profiles: profiles.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        model: row.model ? String(row.model) : null,
        tools: safeJsonParse(String(row.tools_json ?? "[]")),
      })),
      machines: machines.map(publicMachine),
    });
  }

  private queueTaskAssignmentRoute(
    userId: string,
    teamId: TeamId,
    body: {
      taskId?: string;
      attemptId?: string;
      conversationId?: string;
      payload?: Record<string, unknown>;
    },
  ): Response {
    this.requireMembership(userId, teamId, "member");
    const taskId = TaskId.parse(body.taskId);
    const attemptId = String(body.attemptId ?? "").trim();
    if (!attemptId) throw new HostError("invalid", "attemptId required", 400);
    const conversationId = ConversationId.parse(body.conversationId);
    this.queueTaskAssignment({
      teamId,
      taskId,
      attemptId,
      conversationId,
      payload: body.payload,
    });
    return json({ queued: true, taskId, attemptId, conversationId }, 201);
  }

  /** Queue a task assignment for supervisor pickup. */
  queueTaskAssignment(input: {
    teamId: TeamId;
    taskId: TaskId;
    attemptId: string;
    conversationId: ConversationId;
    payload?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO task_assignments(
         id, team_id, task_id, attempt_id, conversation_id, machine_id, status,
         payload_json, cancel_requested, created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, NULL, 'pending', ?, 0, ?, ?)`,
      MembershipId.generate(),
      input.teamId,
      input.taskId,
      input.attemptId,
      input.conversationId,
      JSON.stringify(input.payload ?? {}),
      now,
      now,
    );
    void this.armMachineSweepAlarm();
  }

  /** Mark cancel_requested so the next poll delivers a cancel to the machine. */
  requestAssignmentCancel(teamId: TeamId, taskId: TaskId | string): number {
    const now = Date.now();
    const before = this.sql.exec(
      `SELECT id FROM task_assignments
       WHERE team_id = ? AND task_id = ? AND status IN ('pending', 'assigned', 'running')
         AND cancel_requested = 0`,
      teamId,
      String(taskId),
    );
    this.sql.exec(
      `UPDATE task_assignments
       SET cancel_requested = 1, updated_at = ?
       WHERE team_id = ? AND task_id = ? AND status IN ('pending', 'assigned', 'running')`,
      now,
      teamId,
      String(taskId),
    );
    return before.length;
  }

  private cancelTaskAssignment(userId: string, teamId: TeamId, assignmentId: string): Response {
    this.requireMembership(userId, teamId, "member");
    const row = this.sql.one<{ id: string; team_id: string; task_id: string }>(
      "SELECT id, team_id, task_id FROM task_assignments WHERE id = ? AND team_id = ?",
      assignmentId,
      teamId,
    );
    if (!row) throw new HostError("not_found", "Assignment not found", 404);
    const now = Date.now();
    this.sql.exec(
      `UPDATE task_assignments
       SET cancel_requested = 1, updated_at = ?
       WHERE id = ?`,
      now,
      assignmentId,
    );
    return json({ ok: true, assignmentId, taskId: row.task_id, cancelRequested: true });
  }

  private applyMachineSweep(now: number): void {
    const machines = this.sql.exec(
      `SELECT id, status, last_seen_at FROM machines
       WHERE status IN ('approved', 'stale')`,
    ) as Array<{ id: string; status: string; last_seen_at: number | null }>;
    const stale = decideStaleMachines(machines, now, MACHINE_STALE_AFTER_MS);
    if (stale.length === 0) return;

    const staleIds = new Set(stale.map((row) => row.machineId));
    const assignments = this.sql.exec(
      `SELECT id, machine_id, status FROM task_assignments
       WHERE status = 'assigned' AND machine_id IS NOT NULL`,
    ) as Array<{ id: string; machine_id: string | null; status: string }>;
    const requeues = decideRequeueAssignments(assignments, staleIds);

    this.sql.transaction(() => {
      for (const decision of stale) {
        this.sql.exec(
          `UPDATE machines SET status = 'stale' WHERE id = ? AND status = 'approved'`,
          decision.machineId,
        );
      }
      for (const decision of requeues) {
        this.sql.exec(
          `UPDATE task_assignments
           SET machine_id = NULL, status = 'pending', updated_at = ?
           WHERE id = ? AND status = 'assigned'`,
          now,
          decision.assignmentId,
        );
      }
    });
  }

  private async armMachineSweepAlarm(): Promise<void> {
    const live = this.sql.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM machines WHERE status IN ('approved', 'stale', 'draining')`,
    );
    if (Number(live?.n ?? 0) === 0) return;
    await this.ctx.storage.setAlarm(Date.now() + TEAM_SWEEP_ALARM_MS);
  }

  private machine(id: MachineId): MachineRow | null {
    return this.sql.one<MachineRow>("SELECT * FROM machines WHERE id = ?", id);
  }

  private async requireMachineAuth(machineId: MachineId, request: Request): Promise<MachineRow> {
    const machine = this.machine(machineId);
    if (!machine) throw new HostError("not_found", "Machine not found", 404);
    const credential = parseMachineCredential(request);
    if (!credential) throw new HostError("forbidden", "Missing machine credential", 403);
    const credentialHash = await hashMachineCredential(credential);
    assertMachineCredential(machine, credential, credentialHash);
    return machine;
  }
}

function parseMachineCredential(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  const header = request.headers.get("x-celld-machine-credential");
  return header?.trim() || null;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function publicMachine(row: MachineRow) {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    name: String(row.name),
    status: row.status,
    labels: parseLabels(row.labels_json),
    capacities: parseCapacities(row.capacities_json),
    lastSeenAt: row.last_seen_at ? Number(row.last_seen_at) : null,
    createdAt: Number(row.created_at),
  };
}

function requireUserId(value: string): value is string {
  return validOwnerId(value);
}

function parseUserId(value: unknown): string {
  const userId = String(value ?? "").trim();
  if (!validOwnerId(userId)) {
    throw new HostError("invalid", "Invalid user id", 400);
  }
  return userId;
}

function normalizeTeamName(value: unknown, fallback: string): string {
  const name = String(value ?? "").trim() || fallback;
  if (bytesOf(name) > LIMITS.chatTitleBytes) {
    throw new HostError("invalid", "Team name too large", 400);
  }
  return name;
}

function normalizeConversationTitle(value: unknown, fallback: string): string {
  const title = String(value ?? "").trim() || fallback;
  if (bytesOf(title) > LIMITS.chatTitleBytes) {
    throw new HostError("invalid", "Title too large", 400);
  }
  return title;
}

function normalizeEmailHint(value: unknown): string | null {
  const hint = String(value ?? "").trim();
  if (!hint) return null;
  if (bytesOf(hint) > 320) {
    throw new HostError("invalid", "emailHint too large", 400);
  }
  return hint;
}

function publicTeam(row: TeamRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    personalUserId: row.personal_user_id ? String(row.personal_user_id) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function publicMember(row: MembershipRow) {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    userId: String(row.user_id),
    role: row.role,
    createdAt: Number(row.created_at),
  };
}

function publicConversation(row: ConversationRow) {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    title: String(row.title),
    cellAddress: String(row.cell_address),
    activityRevision: Number(row.activity_revision),
    lastMessage: String(row.last_message ?? ""),
    runStatus: String(row.run_status ?? "idle"),
    archived: Boolean(Number(row.archived)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function truncate(value: string, maxBytes: number): string {
  if (bytesOf(value) <= maxBytes) return value;
  let out = value;
  while (out.length > 0 && bytesOf(out) > maxBytes - 1) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

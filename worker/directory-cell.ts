import { LIMITS } from "../shared/limits";
import { bytesOf } from "../shared/crypto";
import { validAgentId, validOwnerId } from "../shared/ids";
import { HostError } from "../shared/errors";
import { DIRECTORY_SCHEMA_SQL, DIRECTORY_SCHEMA_VERSION } from "./directory-schema";
import { Sql } from "./sql";
import type { Env } from "./env";

type ChatRow = {
  id: string;
  title: string;
  last_message: string;
  last_seq: number;
  run_status: string;
  archived: number;
  created_at: number;
  updated_at: number;
};

export class DirectoryCell {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly sql: Sql;
  private ownerId = "";

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = new Sql(ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.sql.migrate(DIRECTORY_SCHEMA_SQL, DIRECTORY_SCHEMA_VERSION);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ownerId = request.headers.get("x-celld-owner") ?? "";
    if (!validOwnerId(ownerId)) {
      return json({ error: "invalid owner id" }, 400);
    }
    this.ownerId = ownerId;

    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/chats")) {
        return await this.list();
      }
      if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/chats")) {
        return await this.create(await request.json());
      }
      if (request.method === "POST" && url.pathname === "/activity") {
        return this.activity(await request.json());
      }

      const chatMatch = url.pathname.match(/^\/chats\/([^/]+)(\/.*)?$/);
      if (chatMatch) {
        const chatId = decodeURIComponent(chatMatch[1]);
        const rest = chatMatch[2] ?? "";
        if (!validAgentId(chatId)) return json({ error: "invalid chat id" }, 400);
        if (request.method === "PATCH" && rest === "") {
          return await this.rename(chatId, await request.json());
        }
        if (request.method === "POST" && rest === "/archive") {
          return await this.archive(chatId);
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

  private async seedDefaultIfEmpty(): Promise<void> {
    const count = this.sql.one<{ n: number }>("SELECT COUNT(*) AS n FROM chats");
    if (Number(count?.n ?? 0) > 0) return;
    await this.insertAndBootstrap("default", "default");
  }

  private async list(): Promise<Response> {
    await this.seedDefaultIfEmpty();
    const rows = this.sql.exec(
      `SELECT id, title, last_message, last_seq, run_status, archived, created_at, updated_at
       FROM chats WHERE archived = 0
       ORDER BY updated_at DESC, created_at DESC`,
    ) as ChatRow[];
    return json({ chats: rows.map(publicChat) });
  }

  private async create(body: { id?: string; title?: string }): Promise<Response> {
    await this.seedDefaultIfEmpty();
    const active = this.sql.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM chats WHERE archived = 0",
    );
    if (Number(active?.n ?? 0) >= LIMITS.chatsPerOwner) {
      throw new HostError("limit", `At most ${LIMITS.chatsPerOwner} chats per owner`, 409);
    }

    let chatId = String(body.id ?? "").trim();
    if (chatId) {
      if (!validAgentId(chatId)) throw new HostError("invalid", "invalid chat id", 400);
    } else {
      chatId = newChatId();
    }
    const existing = this.sql.one("SELECT id FROM chats WHERE id = ?", chatId);
    if (existing) throw new HostError("conflict", "Chat already exists", 409);

    const title = normalizeTitle(body.title, chatId);
    const row = await this.insertAndBootstrap(chatId, title);
    return json({ chat: publicChat(row) }, 201);
  }

  private async rename(chatId: string, body: { title?: string }): Promise<Response> {
    const row = this.chat(chatId);
    if (!row || Number(row.archived)) throw new HostError("not_found", "Chat not found", 404);
    const title = normalizeTitle(body.title, chatId);
    const now = Date.now();
    this.sql.exec("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", title, now, chatId);
    return json({ chat: publicChat({ ...row, title, updated_at: now }) });
  }

  private async archive(chatId: string): Promise<Response> {
    const row = this.chat(chatId);
    if (!row) throw new HostError("not_found", "Chat not found", 404);
    if (Number(row.archived)) return json({ chat: publicChat(row) });
    const now = Date.now();
    this.sql.exec("UPDATE chats SET archived = 1, updated_at = ? WHERE id = ?", now, chatId);
    await this.markAgentArchived(chatId);
    return json({ chat: publicChat({ ...row, archived: 1, updated_at: now }) });
  }

  private activity(body: {
    chatId?: string;
    lastMessage?: string;
    lastSeq?: number;
    runStatus?: string;
  }): Response {
    const chatId = String(body.chatId ?? "");
    if (!validAgentId(chatId)) throw new HostError("invalid", "invalid chat id", 400);
    const row = this.chat(chatId);
    if (!row || Number(row.archived)) {
      return json({ accepted: false, reason: "missing_or_archived" });
    }
    const lastSeq = Number(body.lastSeq ?? 0);
    if (!Number.isFinite(lastSeq) || lastSeq < 0) {
      throw new HostError("invalid", "lastSeq must be a non-negative number", 400);
    }
    // Ordinal fence: a delayed push cannot overwrite a newer preview.
    if (lastSeq < Number(row.last_seq)) {
      return json({ accepted: false, reason: "stale_seq", lastSeq: row.last_seq });
    }
    const lastMessage = truncate(
      String(body.lastMessage ?? row.last_message ?? ""),
      LIMITS.chatPreviewBytes,
    );
    const runStatus = String(body.runStatus ?? row.run_status ?? "idle").slice(0, 64);
    const now = Date.now();
    this.sql.exec(
      `UPDATE chats
       SET last_message = ?, last_seq = ?, run_status = ?, updated_at = ?
       WHERE id = ? AND archived = 0 AND last_seq <= ?`,
      lastMessage,
      lastSeq,
      runStatus,
      now,
      chatId,
      lastSeq,
    );
    return json({ accepted: true });
  }

  private chat(id: string): ChatRow | null {
    return this.sql.one<ChatRow>("SELECT * FROM chats WHERE id = ?", id);
  }

  private async insertAndBootstrap(chatId: string, title: string): Promise<ChatRow> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO chats(id, title, last_message, last_seq, run_status, archived, created_at, updated_at)
       VALUES(?, ?, '', 0, 'idle', 0, ?, ?)`,
      chatId,
      title,
      now,
      now,
    );
    await this.bootstrapAgent(chatId);
    return this.chat(chatId)!;
  }

  private async bootstrapAgent(chatId: string): Promise<void> {
    const id = this.env.AGENT.idFromName(`${this.ownerId}:${chatId}`);
    const stub = this.env.AGENT.get(id);
    const response = await stub.fetch(
      new Request("https://agent.internal/bootstrap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-celld-owner": this.ownerId,
          "x-celld-agent": chatId,
        },
        body: JSON.stringify({ name: chatId }),
      }),
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new HostError(
        "bootstrap_failed",
        body.error ?? `Failed to bootstrap chat ${chatId}`,
        500,
      );
    }
  }

  private async markAgentArchived(chatId: string): Promise<void> {
    const id = this.env.AGENT.idFromName(`${this.ownerId}:${chatId}`);
    const stub = this.env.AGENT.get(id);
    await stub.fetch(
      new Request("https://agent.internal/archive", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-celld-owner": this.ownerId,
          "x-celld-agent": chatId,
        },
        body: "{}",
      }),
    );
  }
}

function publicChat(row: ChatRow) {
  return {
    id: String(row.id),
    title: String(row.title),
    lastMessage: String(row.last_message ?? ""),
    lastSeq: Number(row.last_seq ?? 0),
    runStatus: String(row.run_status ?? "idle"),
    archived: Boolean(Number(row.archived)),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function newChatId(): string {
  return `c${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function normalizeTitle(value: unknown, fallback: string): string {
  const title = String(value ?? "").trim() || fallback;
  if (bytesOf(title) > LIMITS.chatTitleBytes) {
    throw new HostError("invalid", "Title too large", 400);
  }
  return title;
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

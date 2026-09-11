import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

interface Snapshot {
  agent: Record<string, unknown> | null;
  run: Record<string, unknown> | null;
  messages: Array<{ id: string; role: string; content: string; seq: number }>;
  memory: Array<{ key: string; value: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  snippets: Array<{
    id: string;
    name: string;
    version: number;
    source: string;
    description?: string;
    test_results: string | null;
  }>;
  activations: Array<{ name: string; version_id: string }>;
  schedules: Array<{ id: string; name: string; status: string; next_due_at: number }>;
  occurrences: Array<{ id: string; status: string; due_at: number }>;
  approvals: Array<{ id: string; capability: string; args_json: string; status: string }>;
  notifications: Array<{ id: string; message: string }>;
  latestEventId: number;
}

interface EventRow {
  id: number;
  type: string;
  payload: string;
}

interface SessionInfo {
  ownerId: string;
  provider?: string;
  model?: string;
  live?: boolean;
}

interface HealthInfo {
  ok: boolean;
  provider?: string;
  model?: string;
  live?: boolean;
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

function eventLabel(row: EventRow): string {
  const payload = parsePayload(row.payload);
  switch (row.type) {
    case "run.started":
      return `Run started (${String(payload.adapter ?? "model")})`;
    case "run.completed":
      return "Run finished";
    case "run.queued":
      return "Message queued";
    case "run.cancel_requested":
      return "Stop requested";
    case "run.terminated":
      return "Run stopped";
    case "TOOL_CALL_START":
      return `Code Mode: ${String(payload.toolCallName ?? payload.toolName ?? "tool")}`;
    case "TOOL_CALL_END":
      return "Code Mode finished a call";
    case "TEXT_MESSAGE_CONTENT":
      return "Model text";
    case "approval.proposed":
      return "Approval required before notify";
    case "approval.denied":
      return "Approval denied";
    case "approval.executed":
      return "Notification delivered";
    case "memory.set":
      return `Memory updated: ${String(payload.key ?? "")}`;
    case "snippets.save":
      return `Saved ${String(payload.name ?? "snippet")} v${String(payload.version ?? "")}`;
    case "snippets.test":
      return `Tested ${String(payload.name ?? "snippet")} (${payload.passed ? "pass" : "fail"})`;
    case "snippets.activate":
      return `Activated ${String(payload.name ?? "snippet")}`;
    case "schedule.fired":
      return "Scheduled snippet ran";
    default:
      return row.type;
  }
}

function interesting(row: EventRow): boolean {
  return ![
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_END",
    "TOOL_CALL_ARGS",
    "RUN_STARTED",
    "RUN_FINISHED",
  ].includes(row.type);
}

export function App() {
  const [token, setToken] = useState(localStorage.getItem("celld_token") ?? "");
  const [ownerId, setOwnerId] = useState("operator");
  const [secret, setSecret] = useState("dev-change-me");
  const [agentId] = useState("default");
  const [text, setText] = useState(
    "Remember that this project's priority is reliability. Create three maintenance tasks.",
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [panel, setPanel] = useState<"memory" | "snippets" | "schedules" | "trace">("memory");

  const base = `/api/agents/${agentId}`;
  const runStatus = String(snapshot?.run?.status ?? "idle");
  const live = Boolean(session?.live ?? health?.live);
  const provider = session?.provider ?? health?.provider ?? "fixture";

  const refresh = useCallback(async () => {
    const data = await api<Snapshot>(`${base}/snapshot`, { token });
    setSnapshot(data);
    setCursor(data.latestEventId);
    setConnected(true);
  }, [base, token]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const data = await api<HealthInfo>("/health");
        if (!cancelled) {
          setHealth(data);
          setConnected(true);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    void ping();
    const id = window.setInterval(() => void ping(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    void api<SessionInfo>("/api/session", { token })
      .then(setSession)
      .catch((err: Error) => setError(err.message));
    void refresh().catch((err: Error) => setError(err.message));
  }, [token, refresh]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api<{ events: EventRow[]; latestEventId: number }>(
          `${base}/events?after=${cursor}&wait=1`,
          { token },
        );
        if (cancelled) return;
        if (data.events.length) {
          setEvents((current) => [...current, ...data.events].slice(-80));
          setCursor(data.latestEventId);
          await refresh();
        }
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, cursor, base, refresh]);

  const activeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of snapshot?.activations ?? []) {
      map.set(String(row.name), String(row.version_id));
    }
    return map;
  }, [snapshot]);

  const executions = events.filter((row) =>
    ["TOOL_CALL_START", "run.completed", "approval.proposed", "approval.executed"].includes(
      row.type,
    ),
  );

  if (!token) {
    return (
      <form
        className="login"
        onSubmit={(event) => {
          event.preventDefault();
          void api<{ token: string }>("/api/login", {
            method: "POST",
            body: JSON.stringify({ ownerId, secret }),
          })
            .then((data) => {
              localStorage.setItem("celld_token", data.token);
              setToken(data.token);
            })
            .catch((err: Error) => setError(err.message));
        }}
      >
        <h1 className="brand">Application agent</h1>
        <p className="meta">Owner-scoped Celld workbench. Disconnect is not Stop.</p>
        <p className={`pill ${connected ? "ok" : "warn"}`}>
          {connected ? "Celld reachable" : "Waiting for Celld on this origin"}
        </p>
        <p className="meta">
          {health?.live ? "Live model" : "Fixture model"} · {health?.provider ?? "unknown"}
        </p>
        <label>
          Owner
          <input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} />
        </label>
        <label>
          Shared secret
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        {error ? <p className="bad">{error}</p> : null}
        <p>
          <button className="primary" type="submit">
            Enter
          </button>
        </p>
      </form>
    );
  }

  return (
    <div className="app">
      <aside className="rail">
        <h1 className="brand">Application agent</h1>
        <p className="meta">
          {ownerId}/{agentId}
        </p>
        <div className="status-row">
          <span className={`pill ${connected ? "ok" : "bad"}`}>
            {connected ? "connected" : "disconnected"}
          </span>
          <span className={`pill ${live ? "warn" : "ok"}`}>
            {live ? `live ${provider}` : "fixture"}
          </span>
          <span className={`pill ${runStatus === "failed" ? "bad" : "ok"}`}>{runStatus}</span>
        </div>
        {session?.model ? <p className="meta">model {session.model}</p> : null}
        <p className="meta">Disconnect keeps the run. Stop cancels new host work.</p>
        <div className="section">
          <h2>Approvals</h2>
          {(snapshot?.approvals ?? []).map((item) => (
            <div className="item" key={item.id}>
              <div className="mono">{item.capability}</div>
              <pre>{item.args_json}</pre>
              <button
                onClick={() =>
                  void api(`${base}/approvals`, {
                    method: "POST",
                    token,
                    body: JSON.stringify({ id: item.id, decision: "approve" }),
                  }).then(refresh)
                }
              >
                Approve
              </button>{" "}
              <button
                onClick={() =>
                  void api(`${base}/approvals`, {
                    method: "POST",
                    token,
                    body: JSON.stringify({ id: item.id, decision: "deny" }),
                  }).then(refresh)
                }
              >
                Deny
              </button>
            </div>
          ))}
          {!snapshot?.approvals.length && <p className="meta">None pending.</p>}
        </div>
        <div className="section">
          <h2>Notifications</h2>
          {(snapshot?.notifications ?? []).map((item) => (
            <div className="item" key={item.id}>
              {item.message}
            </div>
          ))}
          {!snapshot?.notifications.length && <p className="meta">No delivered effects.</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("celld_token");
            setToken("");
            setSnapshot(null);
            setEvents([]);
          }}
        >
          Leave
        </button>
      </aside>
      <main className="chat">
        <div className="messages">
          {(snapshot?.messages ?? []).length === 0 && (
            <p className="meta">
              Ask the agent to remember something, create tasks, or write a snippet. In fixture mode
              the interpreter and host capabilities are real.
            </p>
          )}
          {(snapshot?.messages ?? []).map((message) => (
            <article className={`msg ${message.role}`} key={message.id}>
              <div className="meta">{message.role}</div>
              <div>
                {typeof message.content === "string"
                  ? safeText(message.content)
                  : JSON.stringify(message.content)}
              </div>
            </article>
          ))}
          {snapshot?.run && String(snapshot.run.error ?? "") ? (
            <p className="bad">{String(snapshot.run.error)}</p>
          ) : null}
          {error && <p className="bad">{error}</p>}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setBusy(true);
            void api(`${base}/chat`, {
              method: "POST",
              token,
              body: JSON.stringify({ text }),
            })
              .then(() => {
                setText("");
                return refresh();
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
              })
              .finally(() => setBusy(false));
          }}
        >
          <textarea
            rows={3}
            value={text}
            aria-label="Message"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="primary" type="submit" disabled={busy}>
            Send
          </button>
          <button
            type="button"
            onClick={() => void api(`${base}/stop`, { method: "POST", token }).then(refresh)}
          >
            Stop
          </button>
        </form>
      </main>
      <aside className="side">
        <p>
          <button type="button" onClick={() => setPanel("memory")}>
            State
          </button>{" "}
          <button type="button" onClick={() => setPanel("snippets")}>
            Snippets
          </button>{" "}
          <button type="button" onClick={() => setPanel("schedules")}>
            Schedules
          </button>{" "}
          <button type="button" onClick={() => setPanel("trace")}>
            Trace
          </button>
        </p>
        {panel === "memory" && (
          <>
            <div className="section">
              <h2>Memory</h2>
              {(snapshot?.memory ?? []).map((item) => (
                <div className="item" key={item.key}>
                  <strong>{item.key}</strong>
                  <pre>{item.value}</pre>
                </div>
              ))}
              {!snapshot?.memory.length && <p className="meta">No memory yet.</p>}
            </div>
            <div className="section">
              <h2>Tasks</h2>
              {(snapshot?.tasks ?? []).map((item) => (
                <div className="item" key={item.id}>
                  <span className={item.status === "done" ? "ok" : "warn"}>{item.status}</span>{" "}
                  {item.title}
                </div>
              ))}
              {!snapshot?.tasks.length && <p className="meta">No tasks yet.</p>}
            </div>
            <div className="section">
              <h2>Code Mode</h2>
              {executions.length === 0 && <p className="meta">No executions this session.</p>}
              {executions.map((item) => (
                <div className="item" key={item.id}>
                  <div className="mono">{eventLabel(item)}</div>
                </div>
              ))}
            </div>
          </>
        )}
        {panel === "snippets" && (
          <div className="section">
            <h2>Saved programs</h2>
            {(snapshot?.snippets ?? []).map((item) => {
              const tests = item.test_results ? JSON.parse(item.test_results) : null;
              const active = activeByName.get(item.name) === String(item.id);
              return (
                <div className="item" key={item.id}>
                  <div>
                    {item.name} v{item.version} {active ? <span className="ok">active</span> : null}{" "}
                    <span className={tests?.passed ? "ok" : "warn"}>
                      {tests ? (tests.passed ? "tested" : "failed test") : "untested"}
                    </span>
                  </div>
                  {item.description ? <p className="meta">{item.description}</p> : null}
                  <pre>{item.source}</pre>
                  <button
                    type="button"
                    onClick={() =>
                      void api(`${base}/snippets/invoke`, {
                        method: "POST",
                        token,
                        body: JSON.stringify({ name: item.name, version: item.version }),
                      }).then(refresh)
                    }
                  >
                    Invoke without model
                  </button>
                </div>
              );
            })}
            {!snapshot?.snippets.length && <p className="meta">No snippets saved.</p>}
          </div>
        )}
        {panel === "schedules" && (
          <div className="section">
            <h2>Schedules</h2>
            {(snapshot?.schedules ?? []).map((item) => (
              <div className="item" key={item.id}>
                {item.name} · {item.status}
                <div className="mono">due {new Date(item.next_due_at).toISOString()}</div>
                <button
                  type="button"
                  onClick={() =>
                    void api(`${base}/schedules/pause`, {
                      method: "POST",
                      token,
                      body: JSON.stringify({ id: item.id, paused: item.status !== "paused" }),
                    }).then(refresh)
                  }
                >
                  {item.status === "paused" ? "Resume" : "Pause"}
                </button>
              </div>
            ))}
            {(snapshot?.occurrences ?? []).map((item) => (
              <div className="item" key={item.id}>
                {item.status} @ {new Date(item.due_at).toISOString()}
              </div>
            ))}
            {!snapshot?.schedules.length && <p className="meta">No schedules.</p>}
            <button
              type="button"
              onClick={() =>
                void api(`${base}/schedules`, {
                  method: "POST",
                  token,
                  body: JSON.stringify({
                    name: "maintenance-tick",
                    snippetName: "maintenance_summary",
                    delaySeconds: 3,
                  }),
                }).then(refresh)
              }
            >
              Schedule active snippet
            </button>
          </div>
        )}
        {panel === "trace" && (
          <div className="section">
            <h2>Observable actions</h2>
            <label className="meta">
              <input
                type="checkbox"
                checked={showRaw}
                onChange={(event) => setShowRaw(event.target.checked)}
              />{" "}
              Show raw payloads
            </label>
            {events.filter(interesting).map((item) => (
              <div className="item" key={item.id}>
                <div className="mono">
                  {item.id} {eventLabel(item)}
                </div>
                {showRaw ? <pre>{item.payload.slice(0, 800)}</pre> : null}
              </div>
            ))}
            {!events.length && <p className="meta">No events yet.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

function safeText(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

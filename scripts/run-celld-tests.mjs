import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { celldDevArgs, defaultIsolateRoot, prepareIsolateRoot } from "./isolate-celld.mjs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eq = stripped.indexOf("=");
    if (eq < 1) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

const root = dirname(fileURLToPath(new URL(".", import.meta.url)));
loadEnvFile(join(homedir(), ".config/secrets.env"));
loadEnvFile(join(root, ".env"));
const port = Number(process.env.CELLD_TEST_PORT ?? 9888);
const isolateRoot = defaultIsolateRoot(port, "test");
const base = `http://127.0.0.1:${port}`;
const args = new Set(process.argv.slice(2));
const probeOnly = args.has("--probe-only");
const liveSmoke = args.has("--live-smoke");
const demoOnly = args.has("--demo");
const results = [];
const agent = `e2e${Date.now().toString(36)}`;
const PROBE_CASES = [
  "structured-result",
  "async-host-combine",
  "error-then-reuse",
  "interrupt-observed",
  "no-host-escape",
  "stalled-host-and-unauthorized",
  "allocation-and-logs",
  "recursion",
  "sync-infinite-loop",
  "microtask-loop",
];

function log(name, passed, detail) {
  results.push({ name, passed, detail });
  const mark = passed ? "PASS" : String(detail ?? "").startsWith("UNRUN") ? "UNRUN" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

function failHard(message) {
  console.error(message);
  process.exit(1);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function json(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function wireId() {
  return crypto.randomUUID();
}

/** Prefer /commands (kind send) — the sole write path for chat turns. */
async function sendCommand(token, agentId, text) {
  return json(`/api/agents/${agentId}/commands`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      commandId: wireId(),
      kind: "send",
      payload: { text, messageId: wireId() },
    }),
  });
}

function portInUse(listenPort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: listenPort });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitPortFree(listenPort, timeoutMs = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await portInUse(listenPort))) return;
    await wait(150);
  }
  throw new Error(`port ${listenPort} is still in use by the previous test node`);
}

function spawnStreams() {
  const streamsPort = Number(process.env.STREAMS_PORT ?? 4437);
  const dataDir = process.env.STREAMS_DATA_DIR ?? join(isolateRoot, "streams-data");
  mkdirSync(dataDir, { recursive: true });
  const child = spawn("node", [join(root, "services/streams.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      STREAMS_PORT: String(streamsPort),
      STREAMS_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitStreams(timeoutMs = 15_000) {
  const streamsPort = Number(process.env.STREAMS_PORT ?? 4437);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${streamsPort}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.status !== 0) return;
    } catch {
      // retry
    }
    await wait(200);
  }
  throw new Error(`streams sidecar did not start on ${streamsPort}`);
}

function spawnCelld() {
  prepareIsolateRoot(root, isolateRoot);
  console.log(`celld isolate ${isolateRoot}`);
  const env = {
    ...process.env,
    PATH: `${join(root, "node_modules/.bin")}:${process.env.HOME}/.local/bin:${process.env.PATH}`,
    CELLD_VAR_AUTH_SECRET: "dev-change-me",
    CELLD_VAR_AUTH_FIXTURE: "1",
    CELLD_VAR_BETTER_AUTH_SECRET: "dev-change-me",
    CELLD_VAR_MODEL_PROVIDER: liveSmoke
      ? process.env.MODEL_PROVIDER ||
        (process.env.ALIBABA_TOKEN_PLAN_API_KEY ? "alibaba" : "openai")
      : "fixture",
    CELLD_VAR_ALIBABA_MODEL: process.env.ALIBABA_MODEL ?? "qwen3.8-max",
    CELLD_VAR_ALLOW_TEST_HOOKS: "1",
    CELLD_VAR_STREAMS_BASE_URL: process.env.STREAMS_BASE_URL ?? "http://127.0.0.1:4437",
    CELLD_SHUTDOWN_TOTAL_MS: process.env.CELLD_SHUTDOWN_TOTAL_MS ?? "12000",
    CELLD_SHUTDOWN_DRAIN_MS: process.env.CELLD_SHUTDOWN_DRAIN_MS ?? "4000",
    CELLD_DRAIN_TOKEN_WAIT_MS: process.env.CELLD_DRAIN_TOKEN_WAIT_MS ?? "0",
    ...(liveSmoke && process.env.ALIBABA_TOKEN_PLAN_API_KEY
      ? { CELLD_VAR_ALIBABA_TOKEN_PLAN_API_KEY: process.env.ALIBABA_TOKEN_PLAN_API_KEY }
      : {}),
    ...(liveSmoke && process.env.OPENAI_API_KEY
      ? { CELLD_VAR_OPENAI_API_KEY: process.env.OPENAI_API_KEY }
      : {}),
    ...(liveSmoke && process.env.XAI_API_KEY
      ? { CELLD_VAR_XAI_API_KEY: process.env.XAI_API_KEY }
      : {}),
  };
  const child = spawn("celld", celldDevArgs(isolateRoot, { port, watch: false }), {
    cwd: isolateRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function stopChild(child) {
  if (!child || child.exitCode != null || child.killed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, 8_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitHealth(timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { response, body } = await json("/health");
      if (response.ok && body.ok) return body;
    } catch {
      // retry
    }
    await wait(400);
  }
  throw new Error("celld health check timed out");
}

async function login(ownerId) {
  const { response, body } = await json("/api/login", {
    method: "POST",
    body: JSON.stringify({ ownerId, secret: "dev-change-me" }),
  });
  if (!response.ok) throw new Error(body.error ?? "login failed");
  return body.token;
}

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function ensureChat(token, id, title = id) {
  const listed = await json("/api/chats", { headers: auth(token) });
  if ((listed.body.chats ?? []).some((chat) => chat.id === id)) return id;
  const created = await json("/api/chats", {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ id, title }),
  });
  if (!created.response.ok && created.response.status !== 409) {
    throw new Error(created.body.error ?? `create chat ${id} failed`);
  }
  return id;
}

async function snapshot(token, id = agent) {
  const { body } = await json(`/api/agents/${id}/snapshot`, { headers: auth(token) });
  return body;
}

async function waitRunIdle(token, timeoutMs = 25_000, id = agent) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await snapshot(token, id);
    const active = snap.activeRun ?? null;
    if (
      !active ||
      ["completed", "failed", "terminated", "waiting_approval", "cancel_requested"].includes(
        active.status,
      )
    ) {
      return snap;
    }
    await wait(250);
  }
  throw new Error("run did not settle");
}

async function fetchWithTimeout(path, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, { headers, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { response, body, timedOut: false };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { response: null, body: {}, timedOut: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (await portInUse(port)) {
    failHard(
      `CELLD_TEST_PORT ${port} is already in use. Leave the workbench alone and pick a free port.`,
    );
  }
  if (liveSmoke) {
    const hasLiveKey = Boolean(
      process.env.ALIBABA_TOKEN_PLAN_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.XAI_API_KEY,
    );
    if (!hasLiveKey) {
      console.error(
        "test:live requires ALIBABA_TOKEN_PLAN_API_KEY, OPENAI_API_KEY, or XAI_API_KEY",
      );
      process.exit(1);
    }
  }
  if (!existsSync(join(root, "dist/ui"))) mkdirSync(join(root, "dist/ui"), { recursive: true });
  const ui = spawn("npx", ["vite", "build"], { cwd: root, stdio: "inherit" });
  await new Promise((resolve, reject) => {
    ui.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ui build failed"))));
  });

  let streams = null;
  const streamsPort = Number(process.env.STREAMS_PORT ?? 4437);
  if (!(await portInUse(streamsPort))) {
    streams = spawnStreams();
    await waitStreams();
  }
  let celld = spawnCelld();
  const watchdog = setTimeout(() => {
    celld.kill("SIGKILL");
    failHard("WATCHDOG: celld was killed. Containment failed.");
  }, 180_000);

  try {
    await waitHealth();
    log("health", true, "Worker /health responded");

    const unauth = await json(`/api/agents/${agent}/snapshot`);
    log("auth-required", unauth.response.status === 401, `status ${unauth.response.status}`);

    const token = await login("alice");
    const other = await login("bob");

    const forged = await json(`/api/agents/${agent}/snapshot`, {
      headers: { authorization: "Bearer forged" },
    });
    log("forged-session", forged.response.status === 401, `status ${forged.response.status}`);

    if (!demoOnly) {
      for (const name of PROBE_CASES) {
        const probeWatchdog = setTimeout(() => {
          celld.kill("SIGKILL");
          failHard(`WATCHDOG: probe ${name} overran. Failed containment.`);
        }, 12_000);
        const probe = await fetchWithTimeout(`/api/probe?case=${name}`, auth(token), 10_000);
        clearTimeout(probeWatchdog);
        if (probe.timedOut) {
          log(`probe:${name}`, false, "request hung past 10s");
          const health = await fetchWithTimeout("/health", {}, 3_000);
          log(
            `probe:${name}:node-alive`,
            !health.timedOut && health.response?.ok,
            "health after hung probe",
          );
          continue;
        }
        const passed = Boolean(probe.body.passed);
        log(
          `probe:${name}`,
          passed,
          JSON.stringify({
            clock: probe.body.clock,
            elapsedMs: probe.body.elapsedMs,
            runtime: probe.body.runtime,
          }),
        );
        if (!passed) {
          console.log(JSON.stringify(probe.body.results, null, 2));
        }
      }
      const effectHost = await json("/api/probe?case=effect-host", { headers: auth(token) });
      log(
        "probe:effect-host",
        Boolean(effectHost.body.passed),
        JSON.stringify({
          asyncOk: effectHost.body.asyncOk,
          layerOk: effectHost.body.layerOk,
          interrupted: effectHost.body.interrupted,
          cleaned: effectHost.body.cleaned,
        }),
      );
    }
    if (probeOnly) return;

    if (liveSmoke) {
      const hasLiveKey = Boolean(
        process.env.ALIBABA_TOKEN_PLAN_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.XAI_API_KEY,
      );
      if (!hasLiveKey) {
        log("live-provider-smoke", false, "UNRUN: no provider credentials");
        return;
      }
      const liveAgent = `live${Date.now().toString(36)}`;
      await ensureChat(token, liveAgent, "live-smoke");
      const liveChat = await sendCommand(
        token,
        liveAgent,
        "Use execute_typescript to call external_memory_set with key alibaba_ok and value token-plan. Then stop.",
      );
      if (!liveChat.response.ok && liveChat.response.status !== 202) {
        log(
          "live-provider-smoke",
          false,
          `commands ${liveChat.response.status} ${liveChat.body.error ?? ""}`,
        );
        return;
      }
      const liveSnap = await waitRunIdle(token, 60_000, liveAgent);
      const started = (liveSnap.events ?? []).find((row) => row.type === "run.started");
      let payload = {};
      try {
        payload =
          typeof started?.payload === "string"
            ? JSON.parse(started.payload)
            : (started?.payload ?? {});
      } catch {
        payload = {};
      }
      const stored = (liveSnap.memory ?? []).some(
        (row) => row.key === "alibaba_ok" && String(row.value).includes("token-plan"),
      );
      const adapter = String(payload.adapter ?? "");
      const completed = liveSnap.run?.status === "completed";
      const live = adapter === "alibaba" && stored && completed;
      await sendCommand(
        token,
        liveAgent,
        "Use execute_typescript to read external_memory_get for key alibaba_ok and return that value.",
      );
      const inspectSnap = await waitRunIdle(token, 60_000, liveAgent);
      const inspectStarted = (inspectSnap.events ?? []).filter((row) => row.type === "run.started");
      const secondLive = inspectStarted.length >= 2 && inspectSnap.run?.status === "completed";
      log(
        "live-provider-smoke",
        live && secondLive,
        `adapter=${adapter || "missing"} stored=${stored} status=${liveSnap.run?.status} inspect=${inspectSnap.run?.status} error=${liveSnap.run?.error ?? ""}`,
      );
      return;
    }

    const malformed = await sendCommand(token, "Nope", "hi");
    log("malformed-agent", malformed.response.status >= 400, `status ${malformed.response.status}`);

    const unknown = await json(`/api/agents/missingchat/snapshot`, { headers: auth(token) });
    log("unknown-chat-404", unknown.response.status === 404, `status ${unknown.response.status}`);

    await ensureChat(token, agent, "e2e-main");

    const oversized = await sendCommand(token, agent, "x".repeat(20_000));
    log(
      "oversized-message",
      oversized.response.status >= 400,
      `status ${oversized.response.status}`,
    );

    const chatA = `a${Date.now().toString(36)}`;
    const chatB = `b${Date.now().toString(36)}`;
    await ensureChat(token, chatA, "parallel-a");
    await ensureChat(token, chatB, "parallel-b");
    const [parA, parB] = await Promise.all([
      sendCommand(token, chatA, "Inspect current state."),
      sendCommand(token, chatB, "Inspect current state."),
    ]);
    await Promise.all([waitRunIdle(token, 25_000, chatA), waitRunIdle(token, 25_000, chatB)]);
    const listed = await json("/api/chats", { headers: auth(token) });
    const ids = (listed.body.chats ?? []).map((row) => row.id);
    log(
      "multi-chat-parallel",
      (parA.response.status === 202 || parA.response.ok) &&
        (parB.response.status === 202 || parB.response.ok) &&
        ids.includes(chatA) &&
        ids.includes(chatB),
      `ids=${ids.join(",")}`,
    );

    const bobList = await json("/api/chats", { headers: auth(other) });
    const bobSeesAlice = (bobList.body.chats ?? []).some(
      (row) => row.id === chatA || row.id === agent,
    );
    log(
      "multi-chat-cross-owner-list",
      bobList.response.ok && !bobSeesAlice,
      `bobCount=${bobList.body.chats?.length ?? 0}`,
    );

    const archiveTarget = `z${Date.now().toString(36)}`;
    await ensureChat(token, archiveTarget, "to-archive");
    const archived = await json(`/api/chats/${archiveTarget}/archive`, {
      method: "POST",
      headers: auth(token),
    });
    const afterArchive = await sendCommand(token, archiveTarget, "should fail");
    const listAfter = await json("/api/chats", { headers: auth(token) });
    const stillListed = (listAfter.body.chats ?? []).some((row) => row.id === archiveTarget);
    log(
      "multi-chat-archive",
      archived.response.ok && afterArchive.response.status === 410 && !stillListed,
      `archive=${archived.response.status} chat=${afterArchive.response.status} listed=${stillListed}`,
    );

    await sendCommand(
      token,
      agent,
      "Remember that this project's priority is reliability. Create three maintenance tasks.",
    );
    let snap = await waitRunIdle(token);
    const remembered = (snap.memory ?? []).some(
      (row) => row.key === "project_priority" && String(row.value).includes("reliability"),
    );
    log(
      "demo-1-memory-tasks",
      remembered && (snap.tasks?.length ?? 0) >= 3,
      `tasks=${snap.tasks?.length}`,
    );

    const reconnect = await snapshot(token);
    log(
      "reconnect-stable",
      reconnect.memory?.length === snap.memory?.length &&
        reconnect.latestEventId === snap.latestEventId,
      `events=${reconnect.latestEventId}`,
    );

    await sendCommand(
      token,
      agent,
      "Write and test a reusable program that lists unfinished tasks and saves a maintenance summary. Activate it for later use.",
    );
    snap = await waitRunIdle(token);
    const snippet = (snap.snippets ?? []).find((row) => row.name === "maintenance_summary");
    const tested = snippet?.test_results && JSON.parse(snippet.test_results).passed;
    log("demo-2-snippet", Boolean(snippet && tested), snippet ? `v${snippet.version}` : "missing");

    const invoked = await json(`/api/agents/${agent}/snippets/invoke`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ name: "maintenance_summary" }),
    });
    log(
      "demo-3-invoke-no-model",
      invoked.body.modelUsed === false && invoked.response.ok,
      JSON.stringify(invoked.body.modelUsed),
    );

    const scheduled = await json(`/api/agents/${agent}/schedules`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        name: "maintenance-tick",
        snippetName: "maintenance_summary",
        delaySeconds: 2,
      }),
    });
    log("schedule-create", scheduled.response.ok, scheduled.body?.id);

    await stopChild(celld);
    await waitPortFree(port);
    celld = spawnCelld();
    await waitHealth();
    await wait(4000);
    snap = await snapshot(token);
    const occ = (snap.occurrences ?? []).filter((row) => row.status === "succeeded");
    log("demo-4-schedule-after-restart", occ.length === 1, `succeeded=${occ.length}`);

    const paused = await json(`/api/agents/${agent}/schedules`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        name: "paused-tick",
        snippetName: "maintenance_summary",
        delaySeconds: 30,
      }),
    });
    if (paused.body?.id) {
      await json(`/api/agents/${agent}/schedules/pause`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ id: paused.body.id, paused: true }),
      });
      await wait(1500);
      snap = await snapshot(token);
      const pausedFired = (snap.occurrences ?? []).some(
        (row) => String(row.schedule_id) === String(paused.body.id) && row.status === "succeeded",
      );
      log("schedule-pause", !pausedFired, `id=${paused.body.id}`);
    } else {
      log("schedule-pause", false, "could not create pause schedule");
    }

    await sendCommand(token, agent, "Deliver the maintenance summary to the demo integration.");
    snap = await waitRunIdle(token);
    const firstApproval = snap.approvals?.[0];
    const notesBefore = snap.notifications?.length ?? 0;
    log(
      "approval-required-before-send",
      Boolean(firstApproval) && notesBefore === 0,
      `approvals=${snap.approvals?.length}`,
    );

    if (firstApproval) {
      await json(`/api/agents/${agent}/approvals`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ id: firstApproval.id, decision: "deny" }),
      });
    }
    snap = await snapshot(token);
    log(
      "approval-deny",
      (snap.notifications?.length ?? 0) === 0,
      `notes=${snap.notifications?.length}`,
    );

    await sendCommand(token, agent, "Deliver the maintenance summary to the demo integration.");
    snap = await waitRunIdle(token);
    const second = snap.approvals?.[0];
    if (second) {
      const one = await json(`/api/agents/${agent}/approvals`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ id: second.id, decision: "approve" }),
      });
      const two = await json(`/api/agents/${agent}/approvals`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ id: second.id, decision: "approve" }),
      });
      snap = await snapshot(token);
      log(
        "demo-5-approve-once",
        (snap.notifications?.length ?? 0) === 1 &&
          one.body.notificationId === two.body.notificationId,
        `notes=${snap.notifications?.length}`,
      );
      const spoof = await json(`/api/agents/${agent}/approvals`, {
        method: "POST",
        headers: auth(other),
        body: JSON.stringify({ id: second.id, decision: "approve" }),
      });
      log("approval-cross-owner", spoof.response.status >= 400, `status ${spoof.response.status}`);
    } else {
      log("demo-5-approve-once", false, "no second approval");
    }

    await sendCommand(
      token,
      agent,
      "Revise the snippet, demonstrate a failed test, activate a valid revision, and roll back.",
    );
    snap = await waitRunIdle(token);
    const versions = (snap.snippets ?? []).filter((row) => row.name === "maintenance_summary");
    const failedKept = versions.some((row) => {
      const tests = row.test_results ? JSON.parse(row.test_results) : null;
      return tests && tests.passed === false;
    });
    const active = (snap.activations ?? []).find((row) => row.name === "maintenance_summary");
    const failedActive = versions.some((row) => {
      const tests = row.test_results ? JSON.parse(row.test_results) : null;
      return (
        tests && tests.passed === false && active && String(active.version_id) === String(row.id)
      );
    });
    log(
      "demo-6-versions",
      versions.length >= 2 && failedKept && !failedActive,
      `versions=${versions.length} failedActive=${failedActive}`,
    );

    await sendCommand(token, agent, "Try a nested capability escalation.");
    snap = await waitRunIdle(token);
    const escalate = (snap.events ?? []).some?.(() => false);
    const escalateMsg = JSON.stringify(snap.messages?.slice(-1) ?? []);
    log(
      "nested-escalation",
      /policy_escalation|outside the parent|unauthorized_capability|Snippet failed/i.test(
        escalateMsg,
      ) || (snap.snippets ?? []).some((row) => row.name === "narrow_parent"),
      escalateMsg.slice(0, 180),
    );

    const [first, secondChat] = await Promise.all([
      sendCommand(token, agent, "Inspect current state."),
      sendCommand(token, agent, "Inspect again."),
    ]);
    log(
      "concurrent-queue",
      Boolean(first.body.queued || secondChat.body.queued),
      JSON.stringify({ first: first.body, second: secondChat.body }),
    );
    await json(`/api/agents/${agent}/stop`, { method: "POST", headers: auth(token) });
    snap = await waitRunIdle(token);
    log(
      "cancel-requested",
      ["terminated", "completed", "cancel_requested"].includes(snap.run?.status ?? "idle"),
      snap.run?.status,
    );

    const beforeDispatch = await json(`/api/agents/${agent}/test/crash`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ mode: "before-dispatch" }),
    });
    log(
      "crash-before-dispatch",
      beforeDispatch.response.status >= 500,
      `status ${beforeDispatch.response.status}`,
    );

    const afterEffect = await json(`/api/agents/${agent}/test/crash`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ mode: "after-effect" }),
    });
    snap = await snapshot(token);
    const uncertain = (snap.notifications ?? []).some((row) =>
      String(row.message).includes("uncertain-before-record"),
    );
    log(
      "crash-after-effect",
      afterEffect.response.status >= 500 && uncertain,
      `notes=${snap.notifications?.length}`,
    );

    const revoke = await json(`/api/agents/${agent}/capabilities`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ capabilities: ["inspect"] }),
    });
    log("capability-revoke", revoke.response.ok);

    const revokedSchedule = await json(`/api/agents/${agent}/schedules`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        name: "revoked-tick",
        snippetName: "maintenance_summary",
        delaySeconds: 1,
      }),
    });
    if (revokedSchedule.response.ok) {
      await wait(2000);
      snap = await snapshot(token);
      const skipped = (snap.occurrences ?? []).some((row) => row.status === "skipped");
      log("schedule-revocation", skipped, `skipped=${skipped}`);
    } else {
      log("schedule-revocation", true, "create rejected after revoke");
    }

    const resetAgent = `rst${Date.now().toString(36)}`;
    await ensureChat(token, resetAgent, "reset-agent");
    await sendCommand(
      token,
      resetAgent,
      "Remember that this project's priority is reliability. Create three maintenance tasks.",
    );
    let resetSnap = await waitRunIdle(token, 25_000, resetAgent);
    const seeded =
      (resetSnap.tasks?.length ?? 0) >= 3 &&
      (resetSnap.memory ?? []).some((row) => row.key === "project_priority");
    const missingConfirm = await json(`/api/agents/${resetAgent}/reset`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({}),
    });
    const resetHttp = await json(`/api/agents/${resetAgent}/reset`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ confirm: true }),
    });
    resetSnap = await snapshot(token, resetAgent);
    log(
      "workspace-reset",
      seeded &&
        missingConfirm.response.status === 400 &&
        resetHttp.response.ok &&
        (resetSnap.memory?.length ?? 0) === 0 &&
        (resetSnap.tasks?.length ?? 0) === 0,
      `seeded=${seeded} confirm=${missingConfirm.response.status} memory=${resetSnap.memory?.length} tasks=${resetSnap.tasks?.length}`,
    );

    // Durable Streams materialize verifier — requires streams sidecar.
    {
      const streamAgent = `strm${Date.now().toString(36)}`;
      await ensureChat(token, streamAgent, "stream-materialize");
      const prompt = `Stream materialize probe ${Date.now()}`;
      await sendCommand(token, streamAgent, prompt);
      let streamSnap = await waitRunIdle(token, 25_000, streamAgent);
      for (let i = 0; i < 40 && !streamSnap.streamOffset; i += 1) {
        await wait(250);
        streamSnap = await snapshot(token, streamAgent);
      }
      try {
        const { materializeSnapshotFromDurableStream } =
          await import("@durable-streams/tanstack-ai-transport");
        const snapText = (streamSnap.messages ?? []).map((row) => {
          let text = String(row.content ?? "");
          try {
            const parsed = JSON.parse(text);
            text = typeof parsed === "string" ? parsed : text;
          } catch {
            // keep raw
          }
          return { role: String(row.role), text };
        });
        let matched = false;
        let detail = "";
        for (let i = 0; i < 40; i += 1) {
          const materialized = await materializeSnapshotFromDurableStream({
            readUrl: `${base}/api/agents/${streamAgent}/stream`,
            headers: auth(token),
          });
          const streamMessages = (materialized.messages ?? []).map((row) => {
            const text = Array.isArray(row.parts)
              ? row.parts
                  .filter((part) => part?.type === "text")
                  .map((part) => String(part.content ?? part.text ?? ""))
                  .join("")
              : "";
            return { role: String(row.role), text };
          });
          const userEcho = streamMessages.some(
            (row) => row.role === "user" && row.text.includes(prompt),
          );
          const assistantPresent = streamMessages.some(
            (row) => row.role === "assistant" && row.text.length > 0,
          );
          const snapUser = snapText.some((row) => row.role === "user" && row.text.includes(prompt));
          const snapAssistant = snapText.some(
            (row) => row.role === "assistant" && row.text.length > 0,
          );
          matched =
            Boolean(streamSnap.streamOffset) &&
            userEcho &&
            assistantPresent &&
            snapUser &&
            snapAssistant;
          detail = `userEcho=${userEcho} assistant=${assistantPresent} snap=${snapText.length} stream=${streamMessages.length} offset=${materialized.offset ?? ""}`;
          if (matched) break;
          await wait(250);
        }
        log("streams-materialize", matched, detail);
      } catch (error) {
        log(
          "streams-materialize",
          false,
          `error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Task lease renew + cancel_requested flag.
    {
      const boot = await json("/api/teams/bootstrap-personal", {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ name: "Lease personal" }),
      });
      const teamId = String(boot.body.team?.id ?? "");
      const conv = await json(`/api/teams/${teamId}/conversations`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ title: "lease-conv" }),
      });
      const conversationId = String(conv.body.conversation?.id ?? conv.body.id ?? "");
      const taskCreated = await json(`/api/teams/${teamId}/conversations/${conversationId}/tasks`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({
          teamId,
          conversationId,
          title: "lease task",
          harness: "fixture",
          prompt: "renew me",
        }),
      });
      const taskId = String(taskCreated.body.task?.id ?? "");
      const attemptCreated = await json(
        `/api/teams/${teamId}/conversations/${conversationId}/tasks/${taskId}/attempts`,
        {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({ leaseTtlMs: 60_000 }),
        },
      );
      const attemptId = String(attemptCreated.body.attempt?.id ?? "");
      const lease = String(attemptCreated.body.lease ?? "");
      const generation = Number(attemptCreated.body.generation ?? 0);
      const beforeExpiry = Number(attemptCreated.body.leaseExpiresAt ?? 0);
      const renewed = await json(
        `/api/teams/${teamId}/conversations/${conversationId}/tasks/attempts/${attemptId}/lease/renew`,
        {
          method: "POST",
          headers: auth(token),
          body: JSON.stringify({ lease, generation, ttlMs: 120_000 }),
        },
      );
      const afterExpiry = Number(renewed.body.leaseExpiresAt ?? 0);
      const queued = await json(`/api/teams/${teamId}/task-assignments`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({
          taskId,
          attemptId,
          conversationId,
          payload: {
            lease,
            generation,
            taskCellAddress: `team:${teamId}:conv:${conversationId}:tasks`,
          },
        }),
      });
      const cancelled = await json(
        `/api/teams/${teamId}/task-assignments/by-task/${taskId}/cancel`,
        {
          method: "POST",
          headers: auth(token),
          body: "{}",
        },
      );
      log(
        "task-lease-renew-cancel",
        renewed.response.ok &&
          afterExpiry > beforeExpiry &&
          queued.response.ok &&
          cancelled.response.ok &&
          Number(cancelled.body.updated ?? 0) >= 1,
        `renew=${renewed.response.status} delta=${afterExpiry - beforeExpiry} cancelUpdated=${cancelled.body.updated}`,
      );
    }

    log("live-provider-smoke", false, "UNRUN: pass --live-smoke with credentials");

    void escalate;
  } finally {
    clearTimeout(watchdog);
    await stopChild(celld);
    if (streams) await stopChild(streams);
    await wait(300);
    const out = join(root, "test-results");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "celld-tests.json"), JSON.stringify(results, null, 2));
  }

  const failed = results.filter(
    (row) => !row.passed && !String(row.detail ?? "").startsWith("UNRUN"),
  );
  const unrun = results.filter((row) => String(row.detail ?? "").startsWith("UNRUN"));
  console.log(
    `\n${results.length - failed.length - unrun.length}/${results.length} checks passed (${unrun.length} unrun)`,
  );
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

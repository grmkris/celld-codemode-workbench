import { createHash } from "node:crypto";
import type Dockerode from "dockerode";
import type { CelldClient } from "./client.js";
import type { SupervisorJournal } from "./journal.js";
import type { Assignment } from "./docker.js";

const JOURNAL_PATH_PREFIX = "/tmp/celld-runs/";
const FIRST_BYTE_STALL_MS = 10_000;

export function journalExitNonce(attemptId: string): string {
  return createHash("sha256")
    .update(`celld/journal-exit/v1:${attemptId}`)
    .digest("hex")
    .slice(0, 32);
}

export type JournalTailHandle = {
  stop: () => Promise<void>;
};

export async function startJournalTail(input: {
  docker: Dockerode;
  client: CelldClient;
  journal: SupervisorJournal;
  assignment: Assignment;
  containerId: string;
  lease: string;
  generation: number;
  taskCellAddress: string;
}): Promise<JournalTailHandle> {
  const { docker, client, journal, assignment, containerId } = input;
  const attemptId = assignment.attemptId;
  const journalPath = `${JOURNAL_PATH_PREFIX}${attemptId}.ndjson`;
  let offset = journal.getJournalOffset(attemptId) ?? 0;
  let stopped = false;
  let buffer = "";
  let sawByte = offset > 0;
  const abort = new AbortController();

  const postEvents = async (events: Array<{ kind: string; payload?: unknown }>) => {
    if (events.length === 0) return;
    await client.postAttemptEvents({
      attemptId,
      lease: input.lease,
      generation: input.generation,
      taskCellAddress: input.taskCellAddress,
      teamId: assignment.teamId,
      conversationId: assignment.conversationId,
      events,
    });
  };

  const stallTimer = setTimeout(() => {
    if (!sawByte && !stopped) {
      void postEvents([
        {
          kind: "journal-stalled",
          payload: { attemptId, containerId, waitedMs: FIRST_BYTE_STALL_MS },
        },
      ]).catch(() => undefined);
    }
  }, FIRST_BYTE_STALL_MS);

  const run = (async () => {
    // Wait briefly for the runner to create the journal file.
    for (let i = 0; i < 20 && !stopped; i += 1) {
      try {
        const probe = await docker.getContainer(containerId).exec({
          Cmd: ["test", "-f", journalPath],
          AttachStdout: true,
          AttachStderr: true,
        });
        const result = await probe.start({ Detach: false });
        // If test fails, keep waiting.
        void result;
        break;
      } catch {
        await sleep(250);
      }
    }

    while (!stopped && !abort.signal.aborted) {
      try {
        const start = Math.max(1, offset + 1); // tail -c +N is 1-based
        const exec = await docker.getContainer(containerId).exec({
          Cmd: ["tail", "-c", `+${start}`, "-f", journalPath],
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await exec.start({ hijack: true, stdin: false });
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          if (stopped || abort.signal.aborted) break;
          const text = chunk.toString("utf8");
          if (text.length > 0) sawByte = true;
          buffer += text;
          offset += Buffer.byteLength(text);
          journal.setJournalOffset(attemptId, offset, containerId);

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          const events: Array<{ kind: string; payload?: unknown }> = [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(trimmed) as Record<string, unknown>;
            } catch {
              events.push({ kind: "journal.line", payload: { raw: trimmed } });
              continue;
            }
            if (typeof parsed.__exit === "number") {
              const expected = journalExitNonce(attemptId);
              const nonce = String(parsed.__nonce ?? "");
              events.push({
                kind: "attempt.finished",
                payload: {
                  exitCode: Number(parsed.__exit),
                  nonceOk: nonce === expected,
                },
              });
              await postEvents(events);
              stopped = true;
              abort.abort();
              return;
            }
            events.push({
              kind: String(parsed.type ?? "journal.event"),
              payload: parsed,
            });
          }
          if (events.length > 0) await postEvents(events);
        }
      } catch (error) {
        if (stopped || abort.signal.aborted) return;
        journal.append("journal-tail-error", {
          attemptId,
          message: error instanceof Error ? error.message : String(error),
        });
        await sleep(500);
      }
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(stallTimer);
      abort.abort();
      await run.catch(() => undefined);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

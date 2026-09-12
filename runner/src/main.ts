#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadAssignment } from "./assignment.js";
import { resolveHarnessProfile } from "./profiles.js";

const JOURNAL_DIR = process.env.CELLD_JOURNAL_DIR ?? "/tmp/celld-runs";

export function journalExitNonce(attemptId: string): string {
  return createHash("sha256")
    .update(`celld/journal-exit/v1:${attemptId}`)
    .digest("hex")
    .slice(0, 32);
}

function openJournal(attemptId: string) {
  mkdirSync(JOURNAL_DIR, { recursive: true });
  const path = join(JOURNAL_DIR, `${attemptId}.ndjson`);
  const errPath = join(JOURNAL_DIR, `${attemptId}.err`);
  const out = createWriteStream(path, { flags: "a" });
  const err = createWriteStream(errPath, { flags: "a" });
  return { path, out, err };
}

function writeLine(
  stream: NodeJS.WritableStream,
  alsoConsole: "log" | "error" | null,
  line: string,
): void {
  stream.write(`${line}\n`);
  if (alsoConsole === "log") console.log(line);
  if (alsoConsole === "error") console.error(line);
}

async function main() {
  const assignment = loadAssignment();
  const { profile, name } = await resolveHarnessProfile(assignment);
  const journal = openJournal(assignment.attemptId);
  let exitCode = 0;

  const emit = (payload: unknown, sink: "log" | "error" = "log") => {
    writeLine(journal.out, sink, JSON.stringify(payload));
  };

  emit({
    type: "runner-start",
    harness: name,
    package: profile.packageName,
    sandbox: profile.sandbox,
    liveStatus: profile.liveStatus,
    attemptId: assignment.attemptId,
    envKind: assignment.envKind,
  });

  try {
    // Capture harness stdout/stderr into the journal while still mirroring to process streams.
    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);
    console.log = (...args: unknown[]) => {
      const line = args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      writeLine(journal.out, null, line);
      originalLog(...args);
    };
    console.error = (...args: unknown[]) => {
      const line = args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ");
      writeLine(journal.err, null, line);
      writeLine(journal.out, null, line);
      originalError(...args);
    };

    await profile.run(assignment);
    emit({ type: "runner-end", status: "ok", harness: name, attemptId: assignment.attemptId });
  } catch (error) {
    exitCode = 1;
    emit(
      {
        type: "runner-error",
        attemptId: assignment.attemptId,
        message: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
  } finally {
    emit({
      __exit: exitCode,
      __nonce: journalExitNonce(assignment.attemptId),
    });
    await Promise.all([
      new Promise<void>((resolve) => journal.out.end(resolve)),
      new Promise<void>((resolve) => journal.err.end(resolve)),
    ]);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      type: "runner-error",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

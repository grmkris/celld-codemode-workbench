#!/usr/bin/env node
import { loadAssignment } from "./assignment.js";
import { resolveHarnessProfile } from "./profiles.js";

async function main() {
  const assignment = loadAssignment();
  const { profile, name } = await resolveHarnessProfile(assignment);

  console.log(
    JSON.stringify({
      type: "runner-start",
      harness: name,
      package: profile.packageName,
      sandbox: profile.sandbox,
      liveStatus: profile.liveStatus,
      attemptId: assignment.attemptId,
      envKind: assignment.envKind,
    }),
  );

  await profile.run(assignment);

  console.log(JSON.stringify({ type: "runner-end", status: "ok", harness: name }));
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

import { HostError } from "../../shared/errors";

export function assertApprovalCas(
  currentStatus: string,
  expectedStatus: string | undefined,
  decision: "approve" | "deny",
): void {
  if (decision === "approve" && currentStatus === "succeeded") {
    return;
  }
  if (expectedStatus && currentStatus !== expectedStatus) {
    throw new HostError(
      "conflict",
      `Operation status ${currentStatus} does not match expected ${expectedStatus}`,
      409,
    );
  }
  if (decision === "deny" && (currentStatus === "denied" || currentStatus === "succeeded")) {
    throw new HostError("conflict", `Cannot ${decision} a ${currentStatus} operation`, 409);
  }
  if (
    decision === "approve" &&
    currentStatus !== "proposed" &&
    currentStatus !== "approved" &&
    currentStatus !== "succeeded"
  ) {
    throw new HostError("conflict", `Cannot approve a ${currentStatus} operation`, 409);
  }
  if (decision === "deny" && currentStatus !== "proposed" && currentStatus !== "approved") {
    throw new HostError("conflict", `Cannot deny a ${currentStatus} operation`, 409);
  }
}

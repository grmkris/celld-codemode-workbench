import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "../../worker/auth";

describe("session tokens", () => {
  it("signs and verifies an owner session", async () => {
    const token = await signSession("secret", "alice");
    const session = await verifySession("secret", token);
    expect(session.ownerId).toBe("alice");
  });

  it("rejects a forged signature", async () => {
    const token = await signSession("secret", "alice");
    await expect(verifySession("secret", `${token}x`)).rejects.toThrow(/Invalid|Malformed/);
  });

  it("rejects a different secret", async () => {
    const token = await signSession("secret", "alice");
    await expect(verifySession("other", token)).rejects.toThrow(/Invalid/);
  });

  it("rejects an invalid owner id at issue time", async () => {
    await expect(signSession("secret", "Alice!")).rejects.toThrow(/Invalid owner/);
  });
});

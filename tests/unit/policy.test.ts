import { describe, expect, it } from "vitest";
import { narrowCapabilities } from "../../worker/capabilities";
import { scopedOperationId } from "../../shared/ids";
import { redactValue } from "../../shared/redact";
import { stableJson } from "../../shared/crypto";

describe("capability narrowing", () => {
  it("intersects and never expands", () => {
    const parent = new Set(["memory", "tasks"]);
    const next = narrowCapabilities(parent, ["memory"]);
    expect([...next]).toEqual(["memory"]);
    expect(() => narrowCapabilities(parent, ["integrations"])).toThrow(/outside the parent/);
  });
});

describe("operation identity", () => {
  it("scopes idempotency to owner, execution, and payload", () => {
    const left = scopedOperationId("a", "exec1", "integrations.notify", "hash-one");
    const right = scopedOperationId("b", "exec1", "integrations.notify", "hash-one");
    expect(left).not.toBe(right);
  });

  it("stable-json distinguishes key order from value changes", () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    expect(stableJson({ a: 2 })).not.toBe(stableJson({ a: 3 }));
    expect(stableJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableJson([1, undefined, 2])).toBe("[1,null,2]");
    expect(() => JSON.parse(stableJson({ type: "RUN_ERROR", error: undefined }))).not.toThrow();
  });
});

describe("redaction", () => {
  it("redacts credential-looking keys", () => {
    const redacted = redactValue({
      message: "ok",
      apiKey: "sk-live",
      nested: { authorization: "Bearer x" },
    }) as Record<string, unknown>;
    expect(redacted.apiKey).toBe("[redacted]");
    expect((redacted.nested as { authorization: string }).authorization).toBe("[redacted]");
    expect(redacted.message).toBe("ok");
  });
});

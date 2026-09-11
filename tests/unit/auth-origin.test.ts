import { describe, expect, it } from "vitest";
import { assertOrigin, stripInternalHeaders } from "../../worker/auth";
import { HostError } from "../../shared/errors";
import type { Env } from "../../worker/env";

const env = {} as Env;

describe("stripInternalHeaders", () => {
  it("removes inbound x-celld-* headers", () => {
    const request = new Request("https://celld.test/api/chats", {
      headers: {
        authorization: "Bearer token",
        "x-celld-owner": "attacker",
        "x-celld-user": "attacker",
        "x-celld-agent": "evil",
      },
    });
    const stripped = stripInternalHeaders(request);
    expect(stripped.headers.get("authorization")).toBe("Bearer token");
    expect(stripped.headers.get("x-celld-owner")).toBeNull();
    expect(stripped.headers.get("x-celld-user")).toBeNull();
    expect(stripped.headers.get("x-celld-agent")).toBeNull();
  });
});

describe("assertOrigin", () => {
  it("allows mutating requests without Origin", () => {
    expect(() =>
      assertOrigin(new Request("https://celld.test/api/login", { method: "POST" }), env),
    ).not.toThrow();
  });

  it("allows mutating requests when Origin matches host", () => {
    expect(() =>
      assertOrigin(
        new Request("https://celld.test/api/chats", {
          method: "POST",
          headers: { origin: "https://celld.test" },
        }),
        env,
      ),
    ).not.toThrow();
  });

  it("rejects mutating requests when Origin host mismatches", () => {
    expect(() =>
      assertOrigin(
        new Request("https://celld.test/api/chats", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
        env,
      ),
    ).toThrow(HostError);
  });

  it("ignores safe methods even with mismatched Origin", () => {
    expect(() =>
      assertOrigin(
        new Request("https://celld.test/api/chats", {
          method: "GET",
          headers: { origin: "https://evil.test" },
        }),
        env,
      ),
    ).not.toThrow();
  });
});

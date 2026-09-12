import { describe, expect, it } from "vitest";
import {
  ConversationId,
  MessageId,
  TeamId,
  UserId,
  conversationCellName,
  parseStreamOffset,
} from "../../shared/ids";
import { HostError } from "../../shared/errors";

describe("branded identifiers", () => {
  it("generates, parses, and round-trips UUIDs", () => {
    const id = UserId.generate();
    expect(UserId.is(id)).toBe(true);
    expect(UserId.parse(id)).toBe(id);
    const uuid = UserId.toUuid(id);
    expect(UserId.fromUuid(uuid)).toBe(id);
  });

  it("rejects wrong prefixes and malformed input", () => {
    const team = TeamId.generate();
    expect(UserId.is(team)).toBe(false);
    expect(() => UserId.parse(team)).toThrow(HostError);
    expect(() => UserId.parse("not-an-id")).toThrow(HostError);
    expect(() => UserId.parse(12)).toThrow(HostError);
  });

  it("keeps conversation cell addresses free of viewer ids", () => {
    const team = TeamId.generate();
    const conv = ConversationId.generate();
    const name = conversationCellName(team, conv);
    expect(name).toBe(`team:${team}:conv:${conv}`);
    expect(name.includes("user_")).toBe(false);
  });

  it("treats stream offsets as opaque strings", () => {
    expect(parseStreamOffset("abc123")).toBe("abc123");
    expect(() => parseStreamOffset("")).toThrow(HostError);
    expect(MessageId.is(parseStreamOffset("abc123"))).toBe(false);
  });
});

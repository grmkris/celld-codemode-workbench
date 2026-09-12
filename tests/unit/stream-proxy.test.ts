import {
  STREAM_CURSOR_HEADER,
  STREAM_OFFSET_HEADER,
  STREAM_UP_TO_DATE_HEADER,
} from "@durable-streams/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyStreamRead, streamReadQueryParams } from "../../worker/streams/proxy";

describe("proxyStreamRead", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("whitelists offset, live, and cursor query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("ok", {
        headers: {
          [STREAM_OFFSET_HEADER]: "off-1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request(
      "http://localhost/proxy?offset=off-1&live=sse&cursor=cur-1&secret=1&owner=alice",
    );
    await proxyStreamRead(request, "http://upstream/v1/stream/chat/conv_1", "write-token");

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.searchParams.get("offset")).toBe("off-1");
    expect(calledUrl.searchParams.get("live")).toBe("sse");
    expect(calledUrl.searchParams.get("cursor")).toBe("cur-1");
    expect(calledUrl.searchParams.has("secret")).toBe(false);
    expect(calledUrl.searchParams.has("owner")).toBe(false);
    expect([...streamReadQueryParams]).toEqual(["offset", "live", "cursor"]);
  });

  it("forwards durable stream headers and sets cache control", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("payload", {
        status: 200,
        headers: {
          [STREAM_OFFSET_HEADER]: "off-2",
          [STREAM_CURSOR_HEADER]: "cur-2",
          [STREAM_UP_TO_DATE_HEADER]: "true",
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyStreamRead(
      new Request("http://localhost/proxy?offset=off-2"),
      "http://upstream/v1/stream/chat/conv_1",
      "write-token",
    );

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get(STREAM_OFFSET_HEADER)).toBe("off-2");
    expect(response.headers.get(STREAM_CURSOR_HEADER)).toBe("cur-2");
    expect(response.headers.get(STREAM_UP_TO_DATE_HEADER)).toBe("true");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe("payload");
  });

  it("never forwards write credentials to the client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("payload", {
        headers: {
          Authorization: "Bearer write-token",
          "x-streams-write-token": "write-token",
          [STREAM_OFFSET_HEADER]: "off-3",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyStreamRead(
      new Request("http://localhost/proxy"),
      "http://upstream/v1/stream/chat/conv_1",
      "write-token",
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.any(Headers),
    });
    const upstreamHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(upstreamHeaders.get("Authorization")).toBe("Bearer write-token");

    expect(response.headers.get("Authorization")).toBeNull();
    expect(response.headers.get("x-streams-write-token")).toBeNull();
    expect(response.headers.get(STREAM_OFFSET_HEADER)).toBe("off-3");
  });
});

import {
  CURSOR_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  PRODUCER_EPOCH_HEADER,
  PRODUCER_EXPECTED_SEQ_HEADER,
  PRODUCER_ID_HEADER,
  PRODUCER_RECEIVED_SEQ_HEADER,
  PRODUCER_SEQ_HEADER,
  STREAM_CLOSED_HEADER,
  STREAM_CURSOR_HEADER,
  STREAM_OFFSET_HEADER,
  STREAM_UP_TO_DATE_HEADER,
} from "@durable-streams/client";

const STREAM_SSE_DATA_ENCODING_HEADER = "stream-sse-data-encoding";

const ALLOWED_QUERY_PARAMS = new Set([OFFSET_QUERY_PARAM, LIVE_QUERY_PARAM, CURSOR_QUERY_PARAM]);

const UPSTREAM_STREAM_HEADERS = [
  STREAM_OFFSET_HEADER,
  STREAM_CURSOR_HEADER,
  STREAM_UP_TO_DATE_HEADER,
  STREAM_CLOSED_HEADER,
  STREAM_SSE_DATA_ENCODING_HEADER,
  PRODUCER_ID_HEADER,
  PRODUCER_EPOCH_HEADER,
  PRODUCER_SEQ_HEADER,
  PRODUCER_EXPECTED_SEQ_HEADER,
  PRODUCER_RECEIVED_SEQ_HEADER,
  "content-type",
  "content-encoding",
  "vary",
  "etag",
] as const;

const REDACTED_RESPONSE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-streams-write-token",
  "x-celld-streams-token",
]);

function buildUpstreamUrl(request: Request, upstreamUrl: string): string {
  const incoming = new URL(request.url);
  const upstream = new URL(upstreamUrl);

  for (const [key, value] of incoming.searchParams) {
    if (ALLOWED_QUERY_PARAMS.has(key)) {
      upstream.searchParams.set(key, value);
    }
  }

  return upstream.toString();
}

/**
 * Authenticated read proxy for durable streams. Forwards only protocol-safe
 * query params and durable-stream response headers; never exposes write creds.
 */
export async function proxyStreamRead(
  request: Request,
  upstreamUrl: string,
  writeToken?: string,
): Promise<Response> {
  const upstreamHeaders = new Headers();
  if (writeToken) {
    upstreamHeaders.set("Authorization", `Bearer ${writeToken}`);
  }

  const upstreamResponse = await fetch(buildUpstreamUrl(request, upstreamUrl), {
    method: "GET",
    headers: upstreamHeaders,
    signal: request.signal,
  });

  const responseHeaders = new Headers();
  responseHeaders.set("Cache-Control", "private, no-store");

  for (const name of UPSTREAM_STREAM_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  upstreamResponse.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (REDACTED_RESPONSE_HEADERS.has(lower)) return;
    if (responseHeaders.has(name)) return;
    if (lower.startsWith("access-control-")) return;
    if (lower === "cache-control") return;
    if (lower === "set-cookie") return;
    responseHeaders.set(name, value);
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export { ALLOWED_QUERY_PARAMS as streamReadQueryParams };

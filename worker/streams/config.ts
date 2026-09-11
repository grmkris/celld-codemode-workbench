export interface StreamsConfig {
  baseUrl: string;
  writeToken?: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

export type StreamsEnv =
  | Record<string, string | undefined>
  | {
      STREAMS_BASE_URL?: string;
      STREAMS_WRITE_TOKEN?: string;
    };

export function readStreamsConfig(
  env: StreamsEnv = process.env as Record<string, string | undefined>,
): StreamsConfig {
  return {
    baseUrl: trimTrailingSlashes(env.STREAMS_BASE_URL ?? "http://127.0.0.1:4437"),
    writeToken: env.STREAMS_WRITE_TOKEN,
  };
}

export function streamsWriteHeaders(config?: StreamsConfig): Record<string, string> {
  const resolved = config ?? readStreamsConfig();
  if (!resolved.writeToken) return {};
  return { Authorization: `Bearer ${resolved.writeToken}` };
}

export function chatStreamPath(conversationId: string): string {
  return `/v1/stream/chat/${encodeURIComponent(conversationId)}`;
}

export function stateStreamPath(scope: string): string {
  return `/v1/stream/state/${encodeURIComponent(scope)}`;
}

export function chatStreamUrl(conversationId: string, config?: StreamsConfig): string {
  const resolved = config ?? readStreamsConfig();
  return `${resolved.baseUrl}${chatStreamPath(conversationId)}`;
}

export function stateStreamUrl(scope: string, config?: StreamsConfig): string {
  const resolved = config ?? readStreamsConfig();
  return `${resolved.baseUrl}${stateStreamPath(scope)}`;
}

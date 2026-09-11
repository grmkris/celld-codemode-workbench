const SENSITIVE_KEY =
  /(secret|token|password|authorization|credential|api[_-]?key|private[_-]?key)/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") {
    if (value.length > 4_096) return `${value.slice(0, 256)}…[truncated]`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactJson(value: unknown): string {
  return JSON.stringify(redactValue(value));
}

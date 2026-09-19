export async function fetchJson(
  url: URL | string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (!headers.has("user-agent"))
    headers.set("user-agent", "polygraph/0.1 read-only");
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${String(url)}`,
    );
  const data: unknown = await response.json();
  return data;
}

export function asRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Invalid ${context}: expected object`);
  return value as Record<string, unknown>;
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : fallback;
}

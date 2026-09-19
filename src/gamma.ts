import type { Market } from "./types.js";
import { asRecord, fetchJson, stringValue } from "./http.js";

function stringArray(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((x): x is string => typeof x === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseGammaMarket(
  input: unknown,
  fetchedAt = new Date().toISOString(),
): Market | null {
  const raw = asRecord(input, "Gamma market");
  const outcomes = stringArray(raw.outcomes);
  const tokens = stringArray(raw.clobTokenIds);
  const yesIndex = outcomes.findIndex((x) => x.toLowerCase() === "yes");
  const noIndex = outcomes.findIndex((x) => x.toLowerCase() === "no");
  if (
    outcomes.length !== 2 ||
    tokens.length !== 2 ||
    yesIndex < 0 ||
    noIndex < 0
  )
    return null;
  const id = stringValue(raw.id);
  const question = stringValue(raw.question).trim();
  const yesTokenId = tokens[yesIndex];
  const noTokenId = tokens[noIndex];
  if (!id || !question || !yesTokenId || !noTokenId) return null;
  const events: unknown[] = Array.isArray(raw.events) ? raw.events : [];
  const firstEvent = events[0];
  const eventId =
    typeof firstEvent === "object" && firstEvent !== null
      ? stringValue((firstEvent as Record<string, unknown>).id) || null
      : null;
  return {
    id,
    eventId,
    question,
    description: stringValue(raw.description),
    rules: stringValue(raw.rules, stringValue(raw.resolutionSource)),
    yesTokenId,
    noTokenId,
    endDate: stringValue(raw.endDate) || null,
    liquidity: stringValue(raw.liquidityNum, stringValue(raw.liquidity, "0")),
    volume: stringValue(raw.volumeNum, stringValue(raw.volume, "0")),
    active:
      raw.active === true &&
      raw.closed !== true &&
      raw.acceptingOrders !== false,
    fetchedAt,
  };
}

export class GammaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}
  async getActiveBinaryMarkets(limit: number): Promise<Market[]> {
    const url = new URL("/markets", this.baseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");
    const data = await fetchJson(url, this.timeoutMs);
    if (!Array.isArray(data))
      throw new Error("Invalid Gamma response: expected an array");
    const now = new Date().toISOString();
    return data
      .map((x) => parseGammaMarket(x, now))
      .filter((x): x is Market => x?.active === true);
  }
}

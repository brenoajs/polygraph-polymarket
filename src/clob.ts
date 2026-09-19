import { Decimal } from "decimal.js";
import type { Level, OrderBook } from "./types.js";
import { asRecord, fetchJson, stringValue } from "./http.js";

function levels(value: unknown, side: "asks" | "bids"): Level[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const row = asRecord(item, `CLOB ${side} level`);
      const price = stringValue(row.price);
      const size = stringValue(row.size);
      try {
        const priceD = new Decimal(price);
        if (priceD.gt(0) && priceD.lt(1) && new Decimal(size).gt(0))
          return [{ price, size }];
      } catch {
        /* omit malformed level */
      }
      return [];
    })
    .sort((a, b) =>
      side === "asks"
        ? new Decimal(a.price).cmp(b.price)
        : new Decimal(b.price).cmp(a.price),
    );
}

function parseTimestamp(value: unknown, nowMs: number): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Invalid CLOB timestamp: missing");
  const raw = String(value).trim();
  if (!raw) throw new Error("Invalid CLOB timestamp: empty");
  let milliseconds: number;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
  } else {
    milliseconds = Date.parse(raw);
  }
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > nowMs
  )
    throw new Error("Invalid CLOB timestamp: malformed or future value");
  return new Date(milliseconds).toISOString();
}

function parseMinOrderSize(value: unknown): string {
  const raw = stringValue(value);
  try {
    if (raw && new Decimal(raw).isFinite() && new Decimal(raw).gt(0))
      return raw;
  } catch {
    // Fall through to the fail-closed error.
  }
  throw new Error("Invalid CLOB min_order_size");
}

export function parseFeeRate(input: unknown): string {
  const raw = asRecord(input, "CLOB fee rate");
  const value = raw.base_fee;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10_000
  )
    throw new Error("Invalid CLOB base_fee; expected integer basis points");
  return String(value);
}

export function parseOrderBook(
  input: unknown,
  tokenId: string,
  nowMs = Date.now(),
): OrderBook {
  const raw = asRecord(input, "CLOB book");
  return {
    tokenId: stringValue(raw.asset_id, tokenId),
    timestamp: parseTimestamp(raw.timestamp, nowMs),
    minOrderSize: parseMinOrderSize(raw.min_order_size),
    asks: levels(raw.asks, "asks"),
    bids: levels(raw.bids, "bids"),
  };
}

export class ClobClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}
  async getBook(tokenId: string): Promise<OrderBook> {
    const url = new URL("/book", this.baseUrl);
    url.searchParams.set("token_id", tokenId);
    return parseOrderBook(await fetchJson(url, this.timeoutMs), tokenId);
  }
  async getFeeRate(tokenId: string): Promise<string> {
    const url = new URL("/fee-rate", this.baseUrl);
    url.searchParams.set("token_id", tokenId);
    return parseFeeRate(await fetchJson(url, this.timeoutMs));
  }
}

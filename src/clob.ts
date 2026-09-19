import { Decimal } from "decimal.js";
import type { FeeSchedule, Level, OrderBook } from "./types.js";
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

export const ZERO_FEE_SCHEDULE: Readonly<FeeSchedule> = Object.freeze({
  rate: "0",
  exponent: 1,
  takerOnly: true,
});

export function parseFeeSchedule(input: unknown): FeeSchedule {
  const market = asRecord(input, "CLOB market");
  const raw = asRecord(market.fd, "CLOB fee schedule");
  if (
    typeof raw.r !== "number" ||
    !Number.isFinite(raw.r) ||
    raw.r < 0 ||
    raw.r > 1 ||
    typeof raw.e !== "number" ||
    !Number.isInteger(raw.e) ||
    raw.e < 1 ||
    raw.e > 100 ||
    typeof raw.to !== "boolean"
  )
    throw new Error("Invalid CLOB fee schedule fd:{r,e,to}");
  return {
    rate: new Decimal(raw.r).toFixed(),
    exponent: raw.e,
    takerOnly: raw.to,
  };
}

export function parseOrderBook(
  input: unknown,
  tokenId: string,
  nowMs = Date.now(),
): OrderBook {
  const raw = asRecord(input, "CLOB book");
  if (
    typeof tokenId !== "string" ||
    tokenId.length === 0 ||
    typeof raw.asset_id !== "string" ||
    raw.asset_id.length === 0 ||
    raw.asset_id !== tokenId
  )
    throw new Error(
      "Invalid CLOB asset_id: must exactly match requested token",
    );
  return {
    tokenId: raw.asset_id,
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
  async getFeeSchedule(conditionId: string): Promise<FeeSchedule> {
    if (!conditionId) throw new Error("Missing CLOB condition ID");
    const url = new URL(
      `/clob-markets/${encodeURIComponent(conditionId)}`,
      this.baseUrl,
    );
    return parseFeeSchedule(await fetchJson(url, this.timeoutMs));
  }
}

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
        if (new Decimal(price).gt(0) && new Decimal(size).gt(0))
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

export function parseOrderBook(input: unknown, tokenId: string): OrderBook {
  const raw = asRecord(input, "CLOB book");
  const timestampRaw = stringValue(raw.timestamp);
  const numeric = Number(timestampRaw);
  const timestamp =
    Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString()
      : timestampRaw || new Date().toISOString();
  return {
    tokenId: stringValue(raw.asset_id, tokenId),
    timestamp,
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
}

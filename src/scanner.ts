import { Decimal } from "decimal.js";
import type {
  Basket,
  Classification,
  FeeSchedule,
  Market,
  OrderBook,
  ScanResult,
} from "./types.js";
import { basketsFor } from "./relations.js";
import { estimateFill } from "./depth.js";
import type { Config } from "./config.js";

export type BookProvider = (tokenId: string) => Promise<OrderBook>;
export type FeeProvider = (market: Market) => Promise<FeeSchedule>;

function timestampState(
  value: string,
  maxAgeSeconds: number,
  now: number,
): "valid" | "stale" | "invalid" {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now) return "invalid";
  return now - parsed > maxAgeSeconds * 1000 ? "stale" : "valid";
}
function validFeeSchedule(value: FeeSchedule): boolean {
  try {
    const rate = new Decimal(value.rate);
    return (
      rate.isFinite() &&
      rate.gte(0) &&
      rate.lte(1) &&
      Number.isInteger(value.exponent) &&
      value.exponent >= 1 &&
      value.exponent <= 100 &&
      typeof value.takerOnly === "boolean"
    );
  } catch {
    return false;
  }
}

export async function scanRelations(
  markets: Market[],
  classifications: Classification[],
  getBook: BookProvider,
  getFeeRate: FeeProvider,
  config: Config,
  availableCash = config.tradeCap,
): Promise<ScanResult> {
  const byId = new Map(markets.map((market) => [market.id, market]));
  const accepted: ScanResult["accepted"] = [];
  const rejected: ScanResult["rejected"] = [];
  const bookCache = new Map<string, Promise<OrderBook>>();
  const feeCache = new Map<string, Promise<FeeSchedule>>();
  const book = (id: string): Promise<OrderBook> => {
    let pending = bookCache.get(id);
    if (!pending) {
      pending = getBook(id);
      bookCache.set(id, pending);
    }
    return pending;
  };
  const fee = (market: Market): Promise<FeeSchedule> => {
    if (!market.feesEnabled)
      return Promise.resolve({ rate: "0", exponent: 1, takerOnly: true });
    let pending = feeCache.get(market.conditionId);
    if (!pending) {
      pending = getFeeRate(market);
      feeCache.set(market.conditionId, pending);
    }
    return pending;
  };
  const now = Date.now();
  for (const classification of classifications) {
    const pair = `${classification.marketAId}/${classification.marketBId}`;
    const a = byId.get(classification.marketAId);
    const b = byId.get(classification.marketBId);
    if (!a || !b) {
      rejected.push({ pair, reason: "market_missing" });
      continue;
    }
    if (classification.ambiguous) {
      rejected.push({ pair, reason: "ambiguous" });
      continue;
    }
    if (
      !Number.isFinite(classification.confidence) ||
      classification.confidence < 0 ||
      classification.confidence > 1 ||
      classification.confidence < config.minConfidence
    ) {
      rejected.push({ pair, reason: "low_confidence" });
      continue;
    }
    const classificationTime = timestampState(
      classification.classifiedAt,
      config.maxClassificationAgeSeconds,
      now,
    );
    if (classificationTime === "invalid") {
      rejected.push({ pair, reason: "invalid_classification_timestamp" });
      continue;
    }
    if (classificationTime === "stale") {
      rejected.push({ pair, reason: "stale_classification" });
      continue;
    }
    const baskets = basketsFor(classification.relation, a, b);
    if (baskets.length === 0) {
      rejected.push({ pair, reason: "non_actionable_relation" });
      continue;
    }
    let best: {
      basket: Basket;
      fill: NonNullable<ReturnType<typeof estimateFill>>;
    } | null = null;
    let failure = "insufficient_depth";
    for (const basket of baskets) {
      let books: [OrderBook, OrderBook];
      try {
        books = await Promise.all([
          book(basket.legs[0].tokenId),
          book(basket.legs[1].tokenId),
        ]);
      } catch {
        failure = "book_unavailable";
        continue;
      }
      const states = books.map((item) =>
        timestampState(item.timestamp, config.maxBookAgeSeconds, now),
      );
      if (states.includes("invalid")) {
        failure = "invalid_book_timestamp";
        continue;
      }
      if (states.includes("stale")) {
        failure = "stale_book";
        continue;
      }
      let fees: [FeeSchedule, FeeSchedule];
      try {
        const feeMarkets = basket.legs.map((leg) => byId.get(leg.marketId));
        if (!feeMarkets[0] || !feeMarkets[1]) throw new Error("market missing");
        fees = await Promise.all([fee(feeMarkets[0]), fee(feeMarkets[1])]);
        if (!fees.every(validFeeSchedule)) throw new Error("invalid fee");
      } catch {
        failure = "fee_unavailable";
        continue;
      }
      const cap = Decimal.min(config.tradeCap, availableCash).toFixed();
      const fill = estimateFill(
        basket,
        books,
        cap,
        fees,
        config.extraConservativeFeeBps,
      );
      if (!fill) continue;
      if (new Decimal(fill.slippageBps).gt(config.maxBookSlippageBps)) {
        failure = "excessive_slippage";
        continue;
      }
      if (
        new Decimal(fill.netEdge).lte(0) ||
        new Decimal(fill.edgeRatio).lt(config.minNetEdge)
      ) {
        failure = "non_positive_or_small_edge";
        continue;
      }
      if (!best || new Decimal(fill.netEdge).gt(best.fill.netEdge))
        best = { basket, fill };
    }
    if (best)
      accepted.push({
        classification,
        basket: best.basket,
        fill: best.fill,
      });
    else rejected.push({ pair, reason: failure });
  }
  return { accepted, rejected };
}

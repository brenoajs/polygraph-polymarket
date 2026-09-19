import { Decimal } from "decimal.js";
import type {
  Basket,
  Classification,
  Market,
  OrderBook,
  ScanResult,
} from "./types.js";
import { basketsFor } from "./relations.js";
import { estimateFill } from "./depth.js";
import type { Config } from "./config.js";

export type BookProvider = (tokenId: string) => Promise<OrderBook>;
export async function scanRelations(
  markets: Market[],
  classifications: Classification[],
  getBook: BookProvider,
  config: Config,
  availableCash = config.tradeCap,
): Promise<ScanResult> {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const accepted: ScanResult["accepted"] = [];
  const rejected: ScanResult["rejected"] = [];
  const cache = new Map<string, Promise<OrderBook>>();
  const book = (id: string): Promise<OrderBook> => {
    let pending = cache.get(id);
    if (!pending) {
      pending = getBook(id);
      cache.set(id, pending);
    }
    return pending;
  };
  for (const c of classifications) {
    const pair = `${c.marketAId}/${c.marketBId}`;
    const a = byId.get(c.marketAId);
    const b = byId.get(c.marketBId);
    if (!a || !b) {
      rejected.push({ pair, reason: "market_missing" });
      continue;
    }
    if (c.ambiguous) {
      rejected.push({ pair, reason: "ambiguous" });
      continue;
    }
    if (c.confidence < config.minConfidence) {
      rejected.push({ pair, reason: "low_confidence" });
      continue;
    }
    if (
      Date.now() - Date.parse(c.classifiedAt) >
      config.maxClassificationAgeSeconds * 1000
    ) {
      rejected.push({ pair, reason: "stale_classification" });
      continue;
    }
    const baskets = basketsFor(c.relation, a, b);
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
      const books = await Promise.all([
        book(basket.legs[0].tokenId),
        book(basket.legs[1].tokenId),
      ]);
      if (
        books.some(
          (x) =>
            Date.now() - Date.parse(x.timestamp) >
            config.maxBookAgeSeconds * 1000,
        )
      ) {
        failure = "stale_book";
        continue;
      }
      const cap = Decimal.min(config.tradeCap, availableCash).toFixed();
      const fill = estimateFill(basket, books, cap, config.feeBps);
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
        classification: c,
        basket: best.basket,
        fill: best.fill,
      });
    else rejected.push({ pair, reason: failure });
  }
  return { accepted, rejected };
}

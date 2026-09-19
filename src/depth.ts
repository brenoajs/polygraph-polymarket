import { Decimal } from "decimal.js";
import type { Basket, FillEstimate, OrderBook } from "./types.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });
const ZERO = new Decimal(0);

function available(book: OrderBook): Decimal {
  return book.asks.reduce((sum, l) => sum.plus(l.size), ZERO);
}
function costFor(book: OrderBook, quantity: Decimal): Decimal | null {
  let remaining = quantity;
  let cost = ZERO;
  for (const level of book.asks) {
    const take = Decimal.min(remaining, new Decimal(level.size));
    cost = cost.plus(take.mul(level.price));
    remaining = remaining.minus(take);
    if (remaining.lte(0)) return cost;
  }
  return remaining.lte(0) ? cost : null;
}
function d(value: Decimal): string {
  return value.toDecimalPlaces(8).toFixed();
}

export function estimateFill(
  basket: Basket,
  books: [OrderBook, OrderBook],
  cap: string,
  feeBps: string,
): FillEstimate | null {
  if (books.some((book) => book.asks.length === 0)) return null;
  const maxDepth = Decimal.min(available(books[0]), available(books[1]));
  const capD = new Decimal(cap);
  const feeRate = new Decimal(feeBps).div(10_000);
  if (maxDepth.lte(0) || capD.lte(0)) return null;
  let low = ZERO;
  let high = maxDepth;
  for (let i = 0; i < 64; i++) {
    const mid = low.plus(high).div(2);
    const c0 = costFor(books[0], mid);
    const c1 = costFor(books[1], mid);
    if (
      c0 !== null &&
      c1 !== null &&
      c0.plus(c1).mul(feeRate.plus(1)).lte(capD)
    )
      low = mid;
    else high = mid;
  }
  const quantity = low.toDecimalPlaces(6, Decimal.ROUND_DOWN);
  if (quantity.lte(0)) return null;
  const c0 = costFor(books[0], quantity);
  const c1 = costFor(books[1], quantity);
  if (c0 === null || c1 === null) return null;
  const gross = c0.plus(c1);
  const fee = gross.mul(feeBps).div(10_000);
  const payout = quantity.mul(basket.guaranteedPayoutPerShare);
  const edge = payout.minus(gross).minus(fee);
  const avg0 = c0.div(quantity);
  const avg1 = c1.div(quantity);
  const firstAsk0 = books[0].asks[0];
  const firstAsk1 = books[1].asks[0];
  if (!firstAsk0 || !firstAsk1) return null;
  const slip0 = avg0.minus(firstAsk0.price).div(firstAsk0.price).mul(10_000);
  const slip1 = avg1.minus(firstAsk1.price).div(firstAsk1.price).mul(10_000);
  return {
    quantity: d(quantity),
    grossCost: d(gross),
    fee: d(fee),
    netEdge: d(edge),
    edgeRatio: gross.eq(0) ? "0" : d(edge.div(gross)),
    slippageBps: d(Decimal.max(slip0, slip1)),
    legs: [
      { ...basket.legs[0], averagePrice: d(avg0), cost: d(c0) },
      { ...basket.legs[1], averagePrice: d(avg1), cost: d(c1) },
    ],
  };
}

export function bidValue(book: OrderBook, quantity: string): string | null {
  let remaining = new Decimal(quantity);
  let value = ZERO;
  for (const level of book.bids) {
    const take = Decimal.min(remaining, level.size);
    value = value.plus(take.mul(level.price));
    remaining = remaining.minus(take);
    if (remaining.lte(0)) return d(value);
  }
  return null;
}

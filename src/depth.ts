import { Decimal } from "decimal.js";
import type { Basket, FeeSchedule, FillEstimate, OrderBook } from "./types.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });
const ZERO = new Decimal(0);
const ONE = new Decimal(1);
const ZERO_FEE: FeeSchedule = {
  rate: "0",
  exponent: 1,
  takerOnly: true,
};

function available(book: OrderBook): Decimal {
  return book.asks.reduce((sum, level) => sum.plus(level.size), ZERO);
}
interface LegEstimate {
  cost: Decimal;
  fee: Decimal;
}
function estimateLeg(
  book: OrderBook,
  quantity: Decimal,
  schedule: FeeSchedule,
): LegEstimate | null {
  let remaining = quantity;
  let cost = ZERO;
  let fee = ZERO;
  const rate = new Decimal(schedule.rate);
  for (const level of book.asks) {
    const price = new Decimal(level.price);
    const take = Decimal.min(remaining, level.size);
    cost = cost.plus(take.mul(price));
    // Effective CLOB formula: shares * rate * (price * (1 - price))^exponent.
    fee = fee.plus(
      take.mul(rate).mul(price.mul(ONE.minus(price)).pow(schedule.exponent)),
    );
    remaining = remaining.minus(take);
    if (remaining.lte(0)) return { cost, fee };
  }
  return remaining.lte(0) ? { cost, fee } : null;
}
function d(value: Decimal): string {
  return value.toDecimalPlaces(8).toFixed();
}

function totalFor(
  books: [OrderBook, OrderBook],
  quantity: Decimal,
  schedules: [FeeSchedule, FeeSchedule],
  extraRate: Decimal,
): Decimal | null {
  const leg0 = estimateLeg(books[0], quantity, schedules[0]);
  const leg1 = estimateLeg(books[1], quantity, schedules[1]);
  if (!leg0 || !leg1) return null;
  const gross = leg0.cost.plus(leg1.cost);
  return gross.plus(leg0.fee).plus(leg1.fee).plus(gross.mul(extraRate));
}

export function estimateFill(
  basket: Basket,
  books: [OrderBook, OrderBook],
  cap: string,
  schedules: [FeeSchedule, FeeSchedule],
  extraConservativeFeeBps: string,
): FillEstimate | null {
  if (books.some((book) => book.asks.length === 0)) return null;
  const maxDepth = Decimal.min(available(books[0]), available(books[1]));
  const capD = new Decimal(cap);
  const extraRate = new Decimal(extraConservativeFeeBps).div(10_000);
  if (maxDepth.lte(0) || capD.lte(0)) return null;
  let low = ZERO;
  let high = maxDepth;
  for (let i = 0; i < 64; i++) {
    const mid = low.plus(high).div(2);
    const leg0 = estimateLeg(books[0], mid, schedules[0]);
    const leg1 = estimateLeg(books[1], mid, schedules[1]);
    if (leg0 !== null && leg1 !== null) {
      const gross = leg0.cost.plus(leg1.cost);
      const total = gross
        .plus(leg0.fee)
        .plus(leg1.fee)
        .plus(gross.mul(extraRate));
      if (total.lte(capD)) {
        low = mid;
        continue;
      }
    }
    high = mid;
  }
  const roundedUp = low.toDecimalPlaces(6, Decimal.ROUND_UP);
  const roundedUpTotal = totalFor(books, roundedUp, schedules, extraRate);
  const quantity =
    roundedUpTotal?.lte(capD) === true
      ? roundedUp
      : low.toDecimalPlaces(6, Decimal.ROUND_DOWN);
  if (
    quantity.lte(0) ||
    books.some((book) => quantity.lt(new Decimal(book.minOrderSize)))
  )
    return null;
  const leg0 = estimateLeg(books[0], quantity, schedules[0]);
  const leg1 = estimateLeg(books[1], quantity, schedules[1]);
  if (leg0 === null || leg1 === null) return null;
  const gross = leg0.cost.plus(leg1.cost);
  const fee = leg0.fee.plus(leg1.fee).plus(gross.mul(extraRate));
  const payout = quantity.mul(basket.guaranteedPayoutPerShare);
  const edge = payout.minus(gross).minus(fee);
  const avg0 = leg0.cost.div(quantity);
  const avg1 = leg1.cost.div(quantity);
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
      {
        ...basket.legs[0],
        averagePrice: d(avg0),
        cost: d(leg0.cost),
      },
      {
        ...basket.legs[1],
        averagePrice: d(avg1),
        cost: d(leg1.cost),
      },
    ],
  };
}

export function bidValue(book: OrderBook, quantity: string): string | null {
  return bidMark(book, quantity, ZERO_FEE)?.grossValue ?? null;
}

export interface BidMark {
  grossValue: string;
  exitFee: string;
  netValue: string;
}

/** Walk executable bids and deduct the effective condition-level taker fee. */
export function bidMark(
  book: OrderBook,
  quantity: string,
  schedule: FeeSchedule,
): BidMark | null {
  let remaining = new Decimal(quantity);
  let value = ZERO;
  let fee = ZERO;
  const rate = new Decimal(schedule.rate);
  for (const level of book.bids) {
    const price = new Decimal(level.price);
    const take = Decimal.min(remaining, level.size);
    value = value.plus(take.mul(price));
    fee = fee.plus(
      take.mul(rate).mul(price.mul(ONE.minus(price)).pow(schedule.exponent)),
    );
    remaining = remaining.minus(take);
    if (remaining.lte(0))
      return {
        grossValue: d(value),
        exitFee: d(fee),
        netValue: d(value.minus(fee)),
      };
  }
  return null;
}

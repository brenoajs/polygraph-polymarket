import { Decimal } from "decimal.js";
import type { Store } from "./store.js";
import type { ScanResult } from "./types.js";

export function executePaper(
  store: Store,
  scan: ScanResult,
  startingCash: string,
): number[] {
  let cash = new Decimal(startingCash).minus(store.spent());
  const ids: number[] = [];
  for (const opportunity of scan.accepted) {
    const total = new Decimal(opportunity.fill.grossCost).plus(
      opportunity.fill.fee,
    );
    if (total.gt(cash)) continue;
    const id = store.recordPosition(
      opportunity.classification,
      opportunity.basket.key,
      opportunity.fill,
    );
    if (id !== null) {
      ids.push(id);
      cash = cash.minus(total);
    }
  }
  return ids;
}

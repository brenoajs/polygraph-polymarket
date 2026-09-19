import { describe, expect, it } from "vitest";
import { estimateFill, bidValue } from "../src/depth.js";
import { basketsFor } from "../src/relations.js";
import { demoMarkets } from "../src/fixtures/demo.js";
import type { OrderBook } from "../src/types.js";

const [a, b] = demoMarkets();
const basket = basketsFor("exhaustive", a, b)[0];
if (!basket) throw new Error("expected an exhaustive fixture basket");
const now = new Date().toISOString();
function book(
  tokenId: string,
  asks: OrderBook["asks"],
  bids: OrderBook["bids"] = [],
): OrderBook {
  return { tokenId, timestamp: now, asks, bids };
}
describe("depth-aware decimal fills", () => {
  it("walks asks, caps matched quantity, and applies fees", () => {
    const fill = estimateFill(
      basket,
      [
        book(a.yesTokenId, [
          { price: "0.40", size: "10" },
          { price: "0.50", size: "10" },
        ]),
        book(b.yesTokenId, [{ price: "0.40", size: "20" }]),
      ],
      "12.625",
      "100",
    );
    expect(fill).not.toBeNull();
    expect(fill?.quantity).toBe("15");
    expect(fill?.grossCost).toBe("12.5");
    expect(fill?.fee).toBe("0.125");
    expect(fill?.netEdge).toBe("2.375");
    expect(fill?.slippageBps).toBe("833.33333333");
  });
  it("returns null when either ask side has no displayed depth", () =>
    expect(
      estimateFill(
        basket,
        [book("a", []), book("b", [{ price: "0.2", size: "1" }])],
        "1",
        "0",
      ),
    ).toBeNull());
  it("marks by walking displayed bids", () =>
    expect(
      bidValue(
        book(
          "x",
          [],
          [
            { price: "0.5", size: "2" },
            { price: "0.4", size: "2" },
          ],
        ),
        "3",
      ),
    ).toBe("1.4"));
});

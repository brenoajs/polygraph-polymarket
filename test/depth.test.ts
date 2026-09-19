import { describe, expect, it } from "vitest";
import { estimateFill, bidMark, bidValue } from "../src/depth.js";
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
  return { tokenId, timestamp: now, minOrderSize: "1", asks, bids };
}
describe("depth-aware decimal fills", () => {
  it("walks asks, caps matched quantity, and applies live plus extra fees", () => {
    const fill = estimateFill(
      basket,
      [
        book(a.yesTokenId, [
          { price: "0.40", size: "10" },
          { price: "0.50", size: "10" },
        ]),
        book(b.yesTokenId, [{ price: "0.40", size: "20" }]),
      ],
      "12.6975",
      ["100", "100"],
      "100",
    );
    expect(fill).not.toBeNull();
    expect(fill?.quantity).toBe("15");
    expect(fill?.grossCost).toBe("12.5");
    // Live formula: .024 + .0125 + .036, plus 1% conservative gross fee.
    expect(fill?.fee).toBe("0.1975");
    expect(fill?.netEdge).toBe("2.3025");
    expect(fill?.slippageBps).toBe("833.33333333");
  });
  it("returns null when either ask side has no displayed depth", () =>
    expect(
      estimateFill(
        basket,
        [book("a", []), book("b", [{ price: "0.2", size: "1" }])],
        "1",
        ["0", "0"],
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
  it("marks executable bids net of the live fee formula", () => {
    expect(
      bidMark(book("x", [], [{ price: "0.5", size: "2" }]), "2", "100"),
    ).toEqual({ grossValue: "1", exitFee: "0.005", netValue: "0.995" });
  });
  it("charges the live fee formula at every consumed ask level", () => {
    const fill = estimateFill(
      basket,
      [
        book("a", [
          { price: "0.2", size: "1" },
          { price: "0.8", size: "1" },
        ]),
        book("b", [{ price: "0.3", size: "2" }]),
      ],
      "10",
      ["200", "100"],
      "0",
    );
    expect(fill?.quantity).toBe("2");
    expect(fill?.fee).toBe("0.0106");
  });
  it("rejects quantities below either CLOB minimum order", () => {
    const left = book("a", [{ price: "0.4", size: "4" }]);
    left.minOrderSize = "5";
    expect(
      estimateFill(
        basket,
        [left, book("b", [{ price: "0.4", size: "4" }])],
        "10",
        ["0", "0"],
        "0",
      ),
    ).toBeNull();
  });
});

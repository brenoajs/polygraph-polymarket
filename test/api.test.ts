import { describe, expect, it } from "vitest";
import { parseGammaMarket } from "../src/gamma.js";
import { parseOrderBook } from "../src/clob.js";

describe("public API normalization", () => {
  it("maps Yes/No token IDs by outcome order", () => {
    const market = parseGammaMarket(
      {
        id: "7",
        question: "Q?",
        outcomes: '["No","Yes"]',
        clobTokenIds: '["no-token","yes-token"]',
        events: [{ id: "e" }],
        active: true,
        closed: false,
        acceptingOrders: true,
        liquidityNum: 12.5,
        volume: "99",
      },
      "2026-01-01T00:00:00Z",
    );
    expect(market).toMatchObject({
      id: "7",
      eventId: "e",
      yesTokenId: "yes-token",
      noTokenId: "no-token",
      liquidity: "12.5",
      active: true,
    });
  });
  it("rejects non-binary and inactive markets", () => {
    expect(
      parseGammaMarket({
        id: "x",
        question: "Q",
        outcomes: '["A","B","C"]',
        clobTokenIds: '["1","2","3"]',
      }),
    ).toBeNull();
  });
  it("sorts executable asks ascending and bids descending", () => {
    const b = parseOrderBook(
      {
        asset_id: "t",
        timestamp: "1760000000000",
        asks: [
          { price: "0.7", size: "2" },
          { price: "0.4", size: "1" },
        ],
        bids: [
          { price: "0.2", size: "3" },
          { price: "0.3", size: "4" },
        ],
      },
      "x",
    );
    expect(b.asks.map((x) => x.price)).toEqual(["0.4", "0.7"]);
    expect(b.bids.map((x) => x.price)).toEqual(["0.3", "0.2"]);
  });
});

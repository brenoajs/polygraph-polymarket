import { describe, expect, it } from "vitest";
import { parseGammaMarket } from "../src/gamma.js";
import { parseFeeRate, parseOrderBook } from "../src/clob.js";

describe("public API normalization", () => {
  it("maps Yes/No tokens and preserves all resolution context", () => {
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
        description: "Full resolution rules.",
        rules: "Additional market rules.",
        resolutionSource: "https://official.example/result",
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
      description: "Full resolution rules.",
      rules: "Additional market rules.",
      resolutionSource: "https://official.example/result",
    });
  });
  it("rejects non-propositional named two-outcome and non-binary markets", () => {
    expect(
      parseGammaMarket({
        id: "x",
        question: "Q",
        outcomes: '["A","B"]',
        clobTokenIds: '["1","2"]',
      }),
    ).toBeNull();
    expect(
      parseGammaMarket({
        id: "x",
        question: "Q",
        outcomes: '["A","B","C"]',
        clobTokenIds: '["1","2","3"]',
      }),
    ).toBeNull();
  });
  it("sorts executable levels and parses the minimum order", () => {
    const b = parseOrderBook(
      {
        asset_id: "t",
        timestamp: "1760000000000",
        min_order_size: "5",
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
    expect(b.minOrderSize).toBe("5");
  });
  it.each([undefined, "bad", "9999999999999999"])(
    "fails closed on invalid book timestamp %s",
    (timestamp) => {
      expect(() =>
        parseOrderBook(
          { asset_id: "t", timestamp, min_order_size: "1", asks: [], bids: [] },
          "t",
        ),
      ).toThrow(/timestamp/i);
    },
  );
  it("requires a valid positive minimum order size", () => {
    expect(() =>
      parseOrderBook(
        { asset_id: "t", timestamp: Date.now(), asks: [], bids: [] },
        "t",
      ),
    ).toThrow(/min_order_size/i);
  });
  it("parses base fee bps and rejects malformed fee responses", () => {
    expect(parseFeeRate({ base_fee: 200 })).toBe("200");
    expect(() => parseFeeRate({ base_fee: "oops" })).toThrow(/base_fee/i);
  });
});

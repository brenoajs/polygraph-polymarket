import { describe, expect, it } from "vitest";
import { scanRelations } from "../src/scanner.js";
import { loadConfig } from "../src/config.js";
import {
  demoBooks,
  demoClassification,
  demoMarkets,
} from "../src/fixtures/demo.js";

function fixtureBookProvider(books: ReturnType<typeof demoBooks>) {
  return (id: string) => {
    const fixtureBook = books[id];
    if (!fixtureBook) throw new Error(`missing fixture book ${id}`);
    return Promise.resolve(fixtureBook);
  };
}
const noFees = () => Promise.resolve("0");

describe("scanner safety gates", () => {
  it("accepts a fresh high-confidence depth-backed edge", async () => {
    const markets = demoMarkets(),
      classification = demoClassification(),
      books = demoBooks();
    const result = await scanRelations(
      markets,
      [classification],
      fixtureBookProvider(books),
      noFees,
      loadConfig({ tradeCap: "10" }),
    );
    expect(result.accepted).toHaveLength(1);
    expect(Number(result.accepted[0]?.fill.netEdge)).toBeGreaterThan(0);
  });
  it.each([
    ["ambiguous", { ambiguous: true }, "ambiguous"],
    ["low confidence", { confidence: 0.1 }, "low_confidence"],
    [
      "non-actionable",
      { relation: "overlapping" as const },
      "non_actionable_relation",
    ],
    ["stale", { classifiedAt: "2000-01-01T00:00:00Z" }, "stale_classification"],
  ])("rejects %s classifications", async (_name, change, reason) => {
    const result = await scanRelations(
      demoMarkets(),
      [{ ...demoClassification(), ...change }],
      fixtureBookProvider(demoBooks()),
      noFees,
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe(reason);
  });
  it("rejects stale books", async () => {
    const books = demoBooks();
    for (const book of Object.values(books))
      book.timestamp = "2000-01-01T00:00:00Z";
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(books),
      noFees,
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe("stale_book");
  });
  it.each(["not-a-date", "2999-01-01T00:00:00Z"])(
    "rejects invalid/future classification timestamp %s",
    async (classifiedAt) => {
      const result = await scanRelations(
        demoMarkets(),
        [{ ...demoClassification(), classifiedAt }],
        fixtureBookProvider(demoBooks()),
        noFees,
        loadConfig(),
      );
      expect(result.rejected[0]?.reason).toBe(
        "invalid_classification_timestamp",
      );
    },
  );
  it("rejects future book timestamps", async () => {
    const books = demoBooks();
    for (const book of Object.values(books))
      book.timestamp = "2999-01-01T00:00:00Z";
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(books),
      noFees,
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe("invalid_book_timestamp");
  });
  it("rejects excessive slippage", async () => {
    const books = demoBooks();
    const first = books["fixture-a-yes"];
    if (!first) throw new Error("fixture missing");
    first.asks = [
      { price: "0.1", size: "1" },
      { price: "0.6", size: "100" },
    ];
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(books),
      noFees,
      loadConfig({ tradeCap: "10", maxBookSlippageBps: "10" }),
    );
    expect(result.rejected[0]?.reason).toBe("excessive_slippage");
  });
  it("rejects an apparent edge after live fees", async () => {
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(demoBooks()),
      () => Promise.resolve("10000"),
      loadConfig({ tradeCap: "10" }),
    );
    expect(result.rejected[0]?.reason).toBe("non_positive_or_small_edge");
  });
  it("fails closed when a fee cannot be retrieved", async () => {
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(demoBooks()),
      () => Promise.reject(new Error("fee API unavailable")),
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe("fee_unavailable");
  });
});

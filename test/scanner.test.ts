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

describe("scanner safety gates", () => {
  it("accepts a fresh high-confidence depth-backed edge", async () => {
    const markets = demoMarkets(),
      classification = demoClassification(),
      books = demoBooks();
    const result = await scanRelations(
      markets,
      [classification],
      fixtureBookProvider(books),
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
    const markets = demoMarkets(),
      books = demoBooks();
    const result = await scanRelations(
      markets,
      [{ ...demoClassification(), ...change }],
      fixtureBookProvider(books),
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe(reason);
  });
  it("rejects stale books", async () => {
    const books = demoBooks();
    for (const b of Object.values(books)) b.timestamp = "2000-01-01T00:00:00Z";
    const result = await scanRelations(
      demoMarkets(),
      [demoClassification()],
      fixtureBookProvider(books),
      loadConfig(),
    );
    expect(result.rejected[0]?.reason).toBe("stale_book");
  });
});

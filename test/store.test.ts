import { describe, expect, it } from "vitest";
import { Store } from "../src/store.js";
import {
  demoBooks,
  demoClassification,
  demoMarkets,
} from "../src/fixtures/demo.js";
import { scanRelations } from "../src/scanner.js";
import { loadConfig } from "../src/config.js";
import { executePaper } from "../src/paper.js";
import type { FillEstimate } from "../src/types.js";

describe("SQLite paper persistence", () => {
  it("sums paper spending without binary floating-point drift", () => {
    const store = new Store(":memory:");
    try {
      const [a, b] = demoMarkets();
      const fill: FillEstimate = {
        quantity: "1",
        grossCost: "0.1",
        fee: "0.2",
        netEdge: "0.7",
        edgeRatio: "7",
        slippageBps: "0",
        legs: [
          {
            marketId: a.id,
            tokenId: a.yesTokenId,
            outcome: "YES",
            averagePrice: "0.1",
            cost: "0.1",
          },
          {
            marketId: b.id,
            tokenId: b.yesTokenId,
            outcome: "YES",
            averagePrice: "0",
            cost: "0",
          },
        ],
      };
      const classification = demoClassification();
      expect(
        store.recordPosition(classification, "decimal-1", fill),
      ).not.toBeNull();
      expect(
        store.recordPosition(classification, "decimal-2", fill),
      ).not.toBeNull();
      expect(store.spent()).toBe("0.6");
    } finally {
      store.close();
    }
  });

  it("persists normalized data, immutable fills, and prevents duplicate positions", async () => {
    const store = new Store(":memory:");
    try {
      const markets = demoMarkets(),
        c = demoClassification(),
        books = demoBooks(),
        config = loadConfig();
      store.upsertMarkets(markets);
      store.saveClassification(c);
      expect(store.listMarkets()).toHaveLength(2);
      expect(store.listClassifications()).toHaveLength(1);
      const scan = await scanRelations(
        markets,
        [c],
        (id) => {
          const fixtureBook = books[id];
          if (!fixtureBook) throw new Error(`missing fixture book ${id}`);
          return Promise.resolve(fixtureBook);
        },
        config,
      );
      expect(executePaper(store, scan, "1000")).toHaveLength(1);
      expect(executePaper(store, scan, "1000")).toHaveLength(0);
      expect(store.listPositions()).toHaveLength(1);
      expect(() => store.db.exec("UPDATE fills SET fee='9'")).toThrow(
        "immutable",
      );
    } finally {
      store.close();
    }
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalPositionFingerprint, Store } from "../src/store.js";
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
      const secondFill: FillEstimate = {
        ...fill,
        legs: [
          { ...fill.legs[0], tokenId: a.noTokenId, outcome: "NO" },
          { ...fill.legs[1], tokenId: b.noTokenId, outcome: "NO" },
        ],
      };
      expect(
        store.recordPosition(classification, "decimal-2", secondFill),
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
        () => Promise.resolve({ rate: "0", exponent: 1, takerOnly: true }),
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

  it("transactionally replaces the bounded active snapshot", () => {
    const store = new Store(":memory:");
    try {
      const [a, b] = demoMarkets();
      store.replaceMarketSnapshot([a, b]);
      expect(store.listMarkets().map((m) => m.id)).toEqual([a.id, b.id]);
      store.replaceMarketSnapshot([
        { ...b, fetchedAt: new Date().toISOString() },
      ]);
      expect(store.listMarkets().map((m) => m.id)).toEqual([b.id]);
    } finally {
      store.close();
    }
  });

  it("deduplicates a reversed pair and directional relation", () => {
    const store = new Store(":memory:");
    try {
      const [a, b] = demoMarkets();
      const fill: FillEstimate = {
        quantity: "1",
        grossCost: "0.8",
        fee: "0",
        netEdge: "0.2",
        edgeRatio: "0.25",
        slippageBps: "0",
        legs: [
          {
            marketId: a.id,
            tokenId: a.noTokenId,
            outcome: "NO",
            averagePrice: "0.4",
            cost: "0.4",
          },
          {
            marketId: b.id,
            tokenId: b.yesTokenId,
            outcome: "YES",
            averagePrice: "0.4",
            cost: "0.4",
          },
        ],
      };
      const c = { ...demoClassification(), relation: "a_implies_b" as const };
      expect(store.recordPosition(c, "a_no+b_yes", fill)).not.toBeNull();
      const reversed = {
        ...c,
        marketAId: c.marketBId,
        marketBId: c.marketAId,
        relation: "b_implies_a" as const,
      };
      const reversedFill: FillEstimate = {
        ...fill,
        legs: [fill.legs[1], fill.legs[0]],
      };
      expect(
        store.recordPosition(reversed, "a_yes+b_no", reversedFill),
      ).toBeNull();
    } finally {
      store.close();
    }
  });

  it("deduplicates identical economic legs after the relation changes", () => {
    const store = new Store(":memory:");
    try {
      const [a, b] = demoMarkets();
      const fill: FillEstimate = {
        quantity: "1",
        grossCost: "0.8",
        fee: "0",
        netEdge: "0.2",
        edgeRatio: "0.25",
        slippageBps: "0",
        legs: [
          {
            marketId: a.id,
            tokenId: a.yesTokenId,
            outcome: "YES",
            averagePrice: "0.4",
            cost: "0.4",
          },
          {
            marketId: b.id,
            tokenId: b.yesTokenId,
            outcome: "YES",
            averagePrice: "0.4",
            cost: "0.4",
          },
        ],
      };
      expect(
        store.recordPosition(demoClassification(), "first", fill),
      ).not.toBeNull();
      expect(
        store.recordPosition(
          { ...demoClassification(), relation: "equivalent" },
          "second",
          fill,
        ),
      ).toBeNull();
      expect(store.listPositions()[0]?.fingerprint).toBe(
        canonicalPositionFingerprint(fill.legs),
      );
    } finally {
      store.close();
    }
  });

  it("migrates old fingerprints transactionally and retains the oldest collision", () => {
    const directory = mkdtempSync(join(tmpdir(), "polygraph-migration-"));
    const path = join(directory, "old.sqlite");
    const old = new DatabaseSync(path);
    old.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE markets (id TEXT PRIMARY KEY, event_id TEXT, question TEXT NOT NULL, description TEXT NOT NULL, rules TEXT NOT NULL, resolution_source TEXT NOT NULL DEFAULT '', yes_token_id TEXT NOT NULL, no_token_id TEXT NOT NULL, end_date TEXT, liquidity TEXT NOT NULL, volume TEXT NOT NULL, active INTEGER NOT NULL, fetched_at TEXT NOT NULL);
      CREATE TABLE classifications (id INTEGER PRIMARY KEY, market_a_id TEXT NOT NULL, market_b_id TEXT NOT NULL, relation TEXT NOT NULL, ambiguous INTEGER NOT NULL, confidence REAL NOT NULL, rationale TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, classified_at TEXT NOT NULL, human_review_required INTEGER NOT NULL, UNIQUE(market_a_id, market_b_id));
      CREATE TABLE positions (id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, market_a_id TEXT NOT NULL, market_b_id TEXT NOT NULL, relation TEXT NOT NULL, basket_key TEXT NOT NULL, quantity TEXT NOT NULL, gross_cost TEXT NOT NULL, fee TEXT NOT NULL, guaranteed_payout TEXT NOT NULL, opened_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
      CREATE TABLE fills (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL REFERENCES positions(id), filled_at TEXT NOT NULL, gross_cost TEXT NOT NULL, fee TEXT NOT NULL);
      CREATE TABLE legs (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL REFERENCES positions(id), market_id TEXT NOT NULL, token_id TEXT NOT NULL, outcome TEXT NOT NULL, quantity TEXT NOT NULL, average_price TEXT NOT NULL, cost TEXT NOT NULL);
      CREATE TRIGGER fills_immutable_delete BEFORE DELETE ON fills BEGIN SELECT RAISE(ABORT, 'fills are immutable'); END;
      CREATE TRIGGER legs_immutable_delete BEFORE DELETE ON legs BEGIN SELECT RAISE(ABORT, 'legs are immutable'); END;
      INSERT INTO positions VALUES (1,'a:b:old','a','b','exhaustive','oldest','1','0.8','0','1','2025-01-01T00:00:00Z','open');
      INSERT INTO positions VALUES (2,'b:a:new','a','b','equivalent','newer','1','0.8','0','1','2025-01-02T00:00:00Z','open');
      INSERT INTO fills VALUES (1,1,'2025-01-01T00:00:00Z','0.8','0');
      INSERT INTO fills VALUES (2,2,'2025-01-02T00:00:00Z','0.8','0');
      INSERT INTO legs VALUES (1,1,'a','token-a','YES','1','0.4','0.4');
      INSERT INTO legs VALUES (2,1,'b','token-b','NO','1','0.4','0.4');
      INSERT INTO legs VALUES (3,2,'b','token-b','NO','1','0.4','0.4');
      INSERT INTO legs VALUES (4,2,'a','token-a','YES','1','0.4','0.4');
    `);
    old.close();
    const store = new Store(path);
    try {
      expect(store.listPositions().map((position) => position.id)).toEqual([1]);
      expect(store.listPositions()[0]?.fingerprint).toBe(
        canonicalPositionFingerprint([
          { tokenId: "token-a", outcome: "YES" },
          { tokenId: "token-b", outcome: "NO" },
        ]),
      );
      expect(
        store.db.prepare("SELECT count(*) AS n FROM fills").get(),
      ).toMatchObject({ n: 1 });
      expect(
        store.db.prepare("SELECT count(*) AS n FROM legs").get(),
      ).toMatchObject({ n: 2 });
      expect(() => store.db.exec("DELETE FROM fills")).toThrow("immutable");
      const columns = store.db.prepare("PRAGMA table_info(markets)").all();
      expect(columns.map((column) => String(column.name))).toEqual(
        expect.arrayContaining(["condition_id", "fees_enabled"]),
      );
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

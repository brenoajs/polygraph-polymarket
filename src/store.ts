import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Decimal } from "decimal.js";
import type {
  Classification,
  FillEstimate,
  Market,
  Relation,
} from "./types.js";

function text(value: unknown, column: string): string {
  if (typeof value !== "string")
    throw new Error(`Invalid ${column} value in database`);
  return value;
}

function nullableText(value: unknown, column: string): string | null {
  return value === null ? null : text(value, column);
}

export interface PositionRow {
  id: number;
  fingerprint: string;
  market_a_id: string;
  market_b_id: string;
  relation: string;
  basket_key: string;
  quantity: string;
  gross_cost: string;
  fee: string;
  guaranteed_payout: string;
  opened_at: string;
}

function relationForSortedPair(c: Classification): Relation {
  if (c.marketAId <= c.marketBId) return c.relation;
  if (c.relation === "a_implies_b") return "b_implies_a";
  if (c.relation === "b_implies_a") return "a_implies_b";
  return c.relation;
}

export function canonicalPositionFingerprint(
  c: Classification,
  fill: FillEstimate,
): string {
  const markets = [c.marketAId, c.marketBId].sort();
  const legs = fill.legs
    .map((leg) => [leg.marketId, leg.tokenId, leg.outcome])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify([markets, relationForSortedPair(c), legs]);
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }
  private migrate(): void {
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS markets (id TEXT PRIMARY KEY, event_id TEXT, question TEXT NOT NULL, description TEXT NOT NULL, rules TEXT NOT NULL, resolution_source TEXT NOT NULL DEFAULT '', yes_token_id TEXT NOT NULL, no_token_id TEXT NOT NULL, end_date TEXT, liquidity TEXT NOT NULL, volume TEXT NOT NULL, active INTEGER NOT NULL, fetched_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classifications (id INTEGER PRIMARY KEY, market_a_id TEXT NOT NULL, market_b_id TEXT NOT NULL, relation TEXT NOT NULL, ambiguous INTEGER NOT NULL, confidence REAL NOT NULL, rationale TEXT NOT NULL, source TEXT NOT NULL, model TEXT NOT NULL, classified_at TEXT NOT NULL, human_review_required INTEGER NOT NULL, UNIQUE(market_a_id, market_b_id));
    CREATE TABLE IF NOT EXISTS positions (id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, market_a_id TEXT NOT NULL, market_b_id TEXT NOT NULL, relation TEXT NOT NULL, basket_key TEXT NOT NULL, quantity TEXT NOT NULL, gross_cost TEXT NOT NULL, fee TEXT NOT NULL, guaranteed_payout TEXT NOT NULL, opened_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
    CREATE TABLE IF NOT EXISTS fills (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL REFERENCES positions(id), filled_at TEXT NOT NULL, gross_cost TEXT NOT NULL, fee TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS legs (id INTEGER PRIMARY KEY, position_id INTEGER NOT NULL REFERENCES positions(id), market_id TEXT NOT NULL, token_id TEXT NOT NULL, outcome TEXT NOT NULL, quantity TEXT NOT NULL, average_price TEXT NOT NULL, cost TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS fills_immutable_update BEFORE UPDATE ON fills BEGIN SELECT RAISE(ABORT, 'fills are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS fills_immutable_delete BEFORE DELETE ON fills BEGIN SELECT RAISE(ABORT, 'fills are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS legs_immutable_update BEFORE UPDATE ON legs BEGIN SELECT RAISE(ABORT, 'legs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS legs_immutable_delete BEFORE DELETE ON legs BEGIN SELECT RAISE(ABORT, 'legs are immutable'); END;
  `);
    const columns = this.db
      .prepare("PRAGMA table_info(markets)")
      .all() as Record<string, unknown>[];
    if (!columns.some((column) => column.name === "resolution_source"))
      this.db.exec(
        "ALTER TABLE markets ADD COLUMN resolution_source TEXT NOT NULL DEFAULT ''",
      );
  }
  close(): void {
    this.db.close();
  }
  upsertMarkets(markets: Market[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO markets(id,event_id,question,description,rules,resolution_source,yes_token_id,no_token_id,end_date,liquidity,volume,active,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,question=excluded.question,description=excluded.description,rules=excluded.rules,resolution_source=excluded.resolution_source,yes_token_id=excluded.yes_token_id,no_token_id=excluded.no_token_id,end_date=excluded.end_date,liquidity=excluded.liquidity,volume=excluded.volume,active=excluded.active,fetched_at=excluded.fetched_at`,
    );
    this.db.exec("BEGIN");
    try {
      for (const m of markets)
        stmt.run(
          m.id,
          m.eventId,
          m.question,
          m.description,
          m.rules,
          m.resolutionSource,
          m.yesTokenId,
          m.noTokenId,
          m.endDate,
          m.liquidity,
          m.volume,
          m.active ? 1 : 0,
          m.fetchedAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Replace the configured top-N Gamma snapshot; rows outside it are inactive. */
  replaceMarketSnapshot(markets: Market[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO markets(id,event_id,question,description,rules,resolution_source,yes_token_id,no_token_id,end_date,liquidity,volume,active,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,question=excluded.question,description=excluded.description,rules=excluded.rules,resolution_source=excluded.resolution_source,yes_token_id=excluded.yes_token_id,no_token_id=excluded.no_token_id,end_date=excluded.end_date,liquidity=excluded.liquidity,volume=excluded.volume,active=excluded.active,fetched_at=excluded.fetched_at`,
    );
    this.db.exec("BEGIN");
    try {
      this.db.exec("UPDATE markets SET active=0");
      for (const m of markets)
        stmt.run(
          m.id,
          m.eventId,
          m.question,
          m.description,
          m.rules,
          m.resolutionSource,
          m.yesTokenId,
          m.noTokenId,
          m.endDate,
          m.liquidity,
          m.volume,
          m.active ? 1 : 0,
          m.fetchedAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listMarkets(): Market[] {
    return (
      this.db
        .prepare("SELECT * FROM markets WHERE active=1 ORDER BY id")
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      id: String(r.id),
      eventId: nullableText(r.event_id, "markets.event_id"),
      question: String(r.question),
      description: String(r.description),
      rules: String(r.rules),
      resolutionSource: String(r.resolution_source),
      yesTokenId: String(r.yes_token_id),
      noTokenId: String(r.no_token_id),
      endDate: nullableText(r.end_date, "markets.end_date"),
      liquidity: String(r.liquidity),
      volume: String(r.volume),
      active: Boolean(r.active),
      fetchedAt: String(r.fetched_at),
    }));
  }
  saveClassification(c: Classification): void {
    this.db
      .prepare(
        `INSERT INTO classifications(market_a_id,market_b_id,relation,ambiguous,confidence,rationale,source,model,classified_at,human_review_required) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(market_a_id,market_b_id) DO UPDATE SET relation=excluded.relation,ambiguous=excluded.ambiguous,confidence=excluded.confidence,rationale=excluded.rationale,source=excluded.source,model=excluded.model,classified_at=excluded.classified_at,human_review_required=excluded.human_review_required`,
      )
      .run(
        c.marketAId,
        c.marketBId,
        c.relation,
        c.ambiguous ? 1 : 0,
        c.confidence,
        c.rationale,
        c.source,
        c.model,
        c.classifiedAt,
        c.humanReviewRequired ? 1 : 0,
      );
  }
  listClassifications(): Classification[] {
    return (
      this.db
        .prepare("SELECT * FROM classifications ORDER BY id")
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      marketAId: String(r.market_a_id),
      marketBId: String(r.market_b_id),
      relation: String(r.relation) as Classification["relation"],
      ambiguous: Boolean(r.ambiguous),
      confidence: Number(r.confidence),
      rationale: String(r.rationale),
      source: String(r.source) as Classification["source"],
      model: String(r.model),
      classifiedAt: String(r.classified_at),
      humanReviewRequired: Boolean(r.human_review_required),
    }));
  }
  recordPosition(
    c: Classification,
    basketKey: string,
    fill: FillEstimate,
  ): number | null {
    const fingerprint = canonicalPositionFingerprint(c, fill);
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO positions(fingerprint,market_a_id,market_b_id,relation,basket_key,quantity,gross_cost,fee,guaranteed_payout,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          fingerprint,
          c.marketAId,
          c.marketBId,
          c.relation,
          basketKey,
          fill.quantity,
          fill.grossCost,
          fill.fee,
          new Decimal(fill.quantity).toFixed(),
          now,
        );
      if (result.changes === 0) {
        this.db.exec("ROLLBACK");
        return null;
      }
      const id = Number(result.lastInsertRowid);
      this.db
        .prepare(
          "INSERT INTO fills(position_id,filled_at,gross_cost,fee) VALUES(?,?,?,?)",
        )
        .run(id, now, fill.grossCost, fill.fee);
      const stmt = this.db.prepare(
        "INSERT INTO legs(position_id,market_id,token_id,outcome,quantity,average_price,cost) VALUES(?,?,?,?,?,?,?)",
      );
      for (const leg of fill.legs)
        stmt.run(
          id,
          leg.marketId,
          leg.tokenId,
          leg.outcome,
          fill.quantity,
          leg.averagePrice,
          leg.cost,
        );
      this.db.exec("COMMIT");
      return id;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  listPositions(): PositionRow[] {
    return this.db
      .prepare(
        "SELECT id,fingerprint,market_a_id,market_b_id,relation,basket_key,quantity,gross_cost,fee,guaranteed_payout,opened_at FROM positions WHERE status='open' ORDER BY id",
      )
      .all() as unknown as PositionRow[];
  }
  positionLegs(id: number): { tokenId: string; quantity: string }[] {
    return (
      this.db
        .prepare(
          "SELECT token_id,quantity FROM legs WHERE position_id=? ORDER BY id",
        )
        .all(id) as Record<string, unknown>[]
    ).map((r) => ({
      tokenId: String(r.token_id),
      quantity: String(r.quantity),
    }));
  }
  spent(): string {
    const rows = this.db
      .prepare(
        "SELECT gross_cost,fee FROM positions WHERE status='open' ORDER BY id",
      )
      .all() as Record<string, unknown>[];
    let total = new Decimal(0);
    for (const row of rows)
      total = total
        .plus(text(row.gross_cost, "positions.gross_cost"))
        .plus(text(row.fee, "positions.fee"));
    return total.toFixed();
  }
}

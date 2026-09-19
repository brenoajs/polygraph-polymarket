#!/usr/bin/env node
import { Command } from "commander";
import { Decimal } from "decimal.js";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { demoBooks, demoClassification, demoMarkets } from "./fixtures/demo.js";
import { scanRelations } from "./scanner.js";
import { executePaper } from "./paper.js";
import {
  classifyMarkets,
  runOnce,
  scanStored,
  syncMarkets,
} from "./service.js";
import { ClobClient, ZERO_FEE_SCHEDULE } from "./clob.js";
import { bidMark } from "./depth.js";
import { GammaClient } from "./gamma.js";

const program = new Command()
  .name("polygraph")
  .description("Read-only Polymarket relation scanner; PAPER simulation only")
  .version("0.1.0")
  .option("--db <path>", "SQLite database path");
function context() {
  const path = program.opts<{ db?: string }>().db;
  const config = loadConfig(path ? { dbPath: path } : {});
  return { config, store: new Store(config.dbPath) };
}
function output(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

program
  .command("demo")
  .description("run fully offline fixture/mock demo")
  .action(async () => {
    const { config, store } = context();
    try {
      const markets = demoMarkets();
      const classification = demoClassification();
      store.upsertMarkets(markets);
      store.saveClassification(classification);
      const books = demoBooks();
      const scan = await scanRelations(
        markets,
        [classification],
        (id) => {
          const book = books[id];
          if (!book) throw new Error(`missing fixture book ${id}`);
          return Promise.resolve(book);
        },
        () => Promise.resolve(ZERO_FEE_SCHEDULE),
        config,
        config.startingCash,
      );
      const opened = executePaper(store, scan, config.startingCash);
      output({
        mode: "OFFLINE FIXTURE / MOCK CLASSIFICATION",
        warning:
          "No live market data or Jev call was used. PAPER simulation only.",
        accepted: scan.accepted.length,
        rejected: scan.rejected,
        openedPaperPositionIds: opened,
        duplicatePrevention:
          opened.length === 0
            ? "existing fixture position was not duplicated"
            : "position recorded",
        database: config.dbPath,
      });
    } finally {
      store.close();
    }
  });
program
  .command("sync")
  .description("fetch and persist active binary Gamma markets")
  .action(async () => {
    const { config, store } = context();
    try {
      output({
        synced: await syncMarkets(store, config),
        source: config.gammaUrl,
      });
    } finally {
      store.close();
    }
  });
program
  .command("classify")
  .description("classify bounded candidate pairs with Jev")
  .option("-l, --limit <n>", "maximum pairs", "25")
  .action(async (opts: { limit: string }) => {
    const { config, store } = context();
    try {
      output({
        classified: await classifyMarkets(store, config, Number(opts.limit)),
        model: "typesafe-ai/jev",
      });
    } finally {
      store.close();
    }
  });
program
  .command("scan")
  .description(
    "scan persisted classifications against executable asks (no persistence)",
  )
  .action(async () => {
    const { config, store } = context();
    try {
      output(await scanStored(store, config));
    } finally {
      store.close();
    }
  });
program
  .command("run-once")
  .description("sync, Jev classify, scan, and record paper fills")
  .option("-l, --limit <n>", "maximum Jev pairs", "25")
  .action(async (opts: { limit: string }) => {
    const { config, store } = context();
    try {
      output(await runOnce(store, config, Number(opts.limit)));
    } finally {
      store.close();
    }
  });
program
  .command("watch")
  .description("repeat run-once at configured interval")
  .option("-l, --limit <n>", "maximum Jev pairs per cycle", "25")
  .action(async (opts: { limit: string }) => {
    const { config, store } = context();
    try {
      for (;;) {
        try {
          output({
            at: new Date().toISOString(),
            ...(await runOnce(store, config, Number(opts.limit))),
          });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
        }
        await sleep(config.watchIntervalSeconds * 1000);
      }
    } finally {
      store.close();
    }
  });
program
  .command("status")
  .description("show cash and mark open paper positions to executable bids")
  .action(async () => {
    const { config, store } = context();
    try {
      const clob = new ClobClient(config.clobUrl, config.httpTimeoutMs);
      const positions = [];
      for (const p of store.listPositions()) {
        let mark = new Decimal(0);
        let markStatus: "current" | "stale" | "unavailable" = "current";
        for (const leg of store.positionLegs(p.id)) {
          try {
            const book = await clob.getBook(leg.tokenId);
            const timestamp = Date.parse(book.timestamp);
            if (
              !Number.isFinite(timestamp) ||
              timestamp > Date.now() ||
              Date.now() - timestamp > config.maxBookAgeSeconds * 1000
            ) {
              markStatus = "stale";
              break;
            }
            const feeSchedule = leg.feesEnabled
              ? await clob.getFeeSchedule(leg.conditionId)
              : ZERO_FEE_SCHEDULE;
            const legMark = bidMark(book, leg.quantity, feeSchedule);
            if (legMark === null) {
              markStatus = "unavailable";
              break;
            }
            mark = mark.plus(legMark.netValue);
          } catch {
            markStatus = "unavailable";
            break;
          }
        }
        const complete = markStatus === "current";
        positions.push({
          ...p,
          markStatus,
          executableBidMark: complete ? mark.toFixed() : null,
          unrealizedPnl: complete
            ? mark.minus(p.gross_cost).minus(p.fee).toFixed()
            : null,
        });
      }
      output({
        startingCash: config.startingCash,
        spent: store.spent(),
        cash: new Decimal(config.startingCash).minus(store.spent()).toFixed(),
        openPositions: positions,
        note: "Marks use fresh displayed executable bids net of live platform fees; settlement is never invented.",
      });
    } finally {
      store.close();
    }
  });
program
  .command("doctor")
  .description("validate configuration and public read-only connectivity")
  .action(async () => {
    const { config, store } = context();
    try {
      const markets = await new GammaClient(
        config.gammaUrl,
        config.httpTimeoutMs,
      ).getActiveBinaryMarkets(1);
      let clob = "not tested (Gamma returned no binary market)";
      if (markets[0]) {
        const client = new ClobClient(config.clobUrl, config.httpTimeoutMs);
        const book = await client.getBook(markets[0].yesTokenId);
        const feeSchedule = markets[0].feesEnabled
          ? await client.getFeeSchedule(markets[0].conditionId)
          : ZERO_FEE_SCHEDULE;
        clob = `ok (${book.asks.length} asks, ${book.bids.length} bids, effective fee rate ${feeSchedule.rate}, exponent ${feeSchedule.exponent})`;
      }
      output({
        node: process.version,
        sqlite: "ok",
        gamma: `ok (${markets.length} binary market sample)`,
        clob,
        jev: process.env.AI_GATEWAY_API_KEY
          ? "configured"
          : "not configured (required only for classify/run-once/watch)",
        safety: "read-only APIs and paper persistence only",
      });
    } finally {
      store.close();
    }
  });

await program.parseAsync();

import { Decimal } from "decimal.js";
import type { Config } from "./config.js";
import { GammaClient } from "./gamma.js";
import { ClobClient } from "./clob.js";
import { generateCandidates } from "./candidates.js";
import { JevClassifier } from "./classifier.js";
import { scanRelations } from "./scanner.js";
import { executePaper } from "./paper.js";
import type { Store } from "./store.js";
import { notifyTelegram } from "./telegram.js";

export async function syncMarkets(
  store: Store,
  config: Config,
): Promise<number> {
  const markets = await new GammaClient(
    config.gammaUrl,
    config.httpTimeoutMs,
  ).getActiveBinaryMarkets(config.syncLimit);
  store.upsertMarkets(markets);
  return markets.length;
}
export async function classifyMarkets(
  store: Store,
  config: Config,
  limit = config.maxCandidates,
): Promise<number> {
  const candidates = generateCandidates(
    store.listMarkets(),
    Math.min(limit, config.maxCandidates),
    config.lexicalThreshold,
  );
  const classifier = new JevClassifier();
  for (const pair of candidates)
    store.saveClassification(await classifier.classify(pair));
  return candidates.length;
}
export async function scanStored(store: Store, config: Config) {
  const clob = new ClobClient(config.clobUrl, config.httpTimeoutMs);
  const cash = new Decimal(config.startingCash).minus(store.spent()).toFixed();
  return scanRelations(
    store.listMarkets(),
    store.listClassifications(),
    (id) => clob.getBook(id),
    config,
    cash,
  );
}
export async function runOnce(
  store: Store,
  config: Config,
  classificationLimit = config.maxCandidates,
): Promise<{
  synced: number;
  classified: number;
  accepted: number;
  opened: number[];
}> {
  const synced = await syncMarkets(store, config);
  const classified = await classifyMarkets(store, config, classificationLimit);
  const scan = await scanStored(store, config);
  const opened = executePaper(store, scan, config.startingCash);
  for (const id of opened)
    await notifyTelegram(
      `PolyGraph PAPER trade #${id} opened. Simulated only; no order was submitted.`,
    );
  return { synced, classified, accepted: scan.accepted.length, opened };
}

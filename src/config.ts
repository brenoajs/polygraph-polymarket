import "dotenv/config";

function numberEnv(name: string, fallback: number, minimum = 0): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum)
    throw new Error(`${name} must be a number >= ${minimum}`);
  return value;
}

export interface Config {
  dbPath: string;
  gammaUrl: string;
  clobUrl: string;
  syncLimit: number;
  maxCandidates: number;
  lexicalThreshold: number;
  minConfidence: number;
  maxClassificationAgeSeconds: number;
  maxBookAgeSeconds: number;
  startingCash: string;
  tradeCap: string;
  minNetEdge: string;
  /** Optional fee added to live platform fees as a conservative gross-cost buffer. */
  extraConservativeFeeBps: string;
  maxBookSlippageBps: string;
  watchIntervalSeconds: number;
  httpTimeoutMs: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    dbPath: process.env.POLYGRAPH_DB_PATH ?? "./data/polygraph.sqlite",
    gammaUrl:
      process.env.POLYGRAPH_GAMMA_URL ?? "https://gamma-api.polymarket.com",
    clobUrl: process.env.POLYGRAPH_CLOB_URL ?? "https://clob.polymarket.com",
    syncLimit: numberEnv("POLYGRAPH_SYNC_LIMIT", 100, 1),
    maxCandidates: numberEnv("POLYGRAPH_MAX_CANDIDATES", 100, 1),
    lexicalThreshold: numberEnv("POLYGRAPH_LEXICAL_THRESHOLD", 0.35),
    minConfidence: numberEnv("POLYGRAPH_MIN_CONFIDENCE", 0.85),
    maxClassificationAgeSeconds: numberEnv(
      "POLYGRAPH_MAX_CLASSIFICATION_AGE_SECONDS",
      86_400,
      1,
    ),
    maxBookAgeSeconds: numberEnv("POLYGRAPH_MAX_BOOK_AGE_SECONDS", 120, 1),
    startingCash: process.env.POLYGRAPH_STARTING_CASH ?? "1000",
    tradeCap: process.env.POLYGRAPH_TRADE_CAP ?? "25",
    minNetEdge: process.env.POLYGRAPH_MIN_NET_EDGE ?? "0.02",
    extraConservativeFeeBps:
      process.env.POLYGRAPH_EXTRA_CONSERVATIVE_FEE_BPS ?? "0",
    maxBookSlippageBps: process.env.POLYGRAPH_MAX_BOOK_SLIPPAGE_BPS ?? "500",
    watchIntervalSeconds: numberEnv("POLYGRAPH_WATCH_INTERVAL_SECONDS", 300, 1),
    httpTimeoutMs: numberEnv("POLYGRAPH_HTTP_TIMEOUT_MS", 15_000, 100),
    ...overrides,
  };
}

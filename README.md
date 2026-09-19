# PolyGraph

PolyGraph is research software that reads public Polymarket data, asks TypeSafe AI's Jev to classify logical relations between bounded candidate pairs, deterministically checks executable order-book depth, and records **paper-only** simulated fills in SQLite.

**Not financial advice. No wallet, signing dependency, private key, order construction, or order-submission path exists.**

## Requirements

- Node.js 22+
- An `AI_GATEWAY_API_KEY` only for live `classify`, `run-once`, and `watch`
- Public network access for all commands except `demo`

## Quick start

```bash
cp .env.example .env
npm install
npm test
npm run build
npm run demo -- --db ./data/demo.sqlite
```

The demo is explicitly labeled `OFFLINE FIXTURE / MOCK CLASSIFICATION`. It makes no network or Jev call. It persists a simulated two-leg paper position and demonstrates duplicate prevention if rerun against the same database.

## CLI

Global `--db <path>` overrides `POLYGRAPH_DB_PATH`.

```bash
polygraph demo                    # offline fixtures + mock classification + paper persistence
polygraph sync                    # public Gamma -> SQLite
polygraph classify --limit 25     # bounded candidates -> Jev (requires gateway key)
polygraph scan                    # executable CLOB asks, deterministic scan; no trade persistence
polygraph run-once --limit 25     # sync + classify + scan + paper records
polygraph watch --limit 25        # repeat run-once
polygraph status                  # cash, positions, executable CLOB bid marks
polygraph doctor                  # config/runtime and public API smoke check
```

`classify` never evaluates every possible pair without a bound. Candidate generation prioritizes markets in the same Gamma event, then lexical Jaccard similarity, and caps output with `POLYGRAPH_MAX_CANDIDATES`.

## Safety model

Jev (`experimental_evaluate`, model `typesafe-ai/jev`) only proposes one typed semantic relation and ambiguity metadata. Deterministic Decimal.js code maps relations to guaranteed-payoff baskets, consumes displayed asks at depth, retrieves each fee-bearing market's effective condition-level CLOB schedule (`fd`), applies `shares × rate × (price × (1-price))^exponent` at every consumed level, and gates stale books/classifications, confidence, ambiguity, minimum order size, slippage, depth, duplicate economic positions, cash, and net edge. `overlapping` and `unrelated` are never actionable.

Relations map to baskets as follows:

- equivalent: `A YES + B NO` or `A NO + B YES`
- A implies B: `A NO + B YES`
- B implies A: `A YES + B NO`
- mutually exclusive: `A NO + B NO`
- exhaustive: `A YES + B YES`

Every basket has a minimum logical payoff of $1 per matched share under its relation. Quotes are estimates from displayed liquidity, not execution promises. Paper fills and legs are immutable via SQLite triggers. Open positions are marked only to fresh displayed executable bids; PolyGraph does not invent settlement.

## Configuration

See [`.env.example`](.env.example). Defaults are deliberately bounded: $25 paper cap, 2% minimum net edge ratio, 85% relation confidence, 120-second book age, and 100 candidate maximum. Live platform fees are fetched fail-closed; `POLYGRAPH_EXTRA_CONSERVATIVE_FEE_BPS` can add a further safety buffer. Optional Telegram notification requires both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and only announces accepted paper records.

The MVP intentionally accepts only markets whose two outcomes are literally `Yes` and `No`. Named two-outcome contracts are rejected rather than silently relabeled into a potentially different proposition.

## Development and deployment

```bash
npm test
npm run lint
npm run typecheck
npm run build
docker build -t polygraph .
docker run --rm polygraph doctor
docker run --rm -v "$PWD/data:/data" polygraph demo
```

The GitHub Actions workflow runs tests, lint, typecheck, build, offline demo, and Docker build on Node 22. Public APIs can change; run `doctor` before unattended use. The AI SDK evaluation API is experimental and therefore pinned exactly in `package.json`.

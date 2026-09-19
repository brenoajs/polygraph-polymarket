# PolyGraph MVP specification

## Goal

Build a production-shaped, read-only Polymarket semantic-relation scanner that uses Jev for typed classification and records simulated paper trades only. It must never submit orders or require a wallet/private key.

## Stack

- TypeScript on Node.js 22, ESM, strict compiler settings.
- Vercel AI SDK `experimental_evaluate` with model `typesafe-ai/jev` and `AI_GATEWAY_API_KEY`.
- Public Polymarket Gamma and CLOB REST APIs using native `fetch`.
- SQLite via Node's built-in `node:sqlite`.
- Vitest, ESLint, Prettier; Docker and GitHub Actions.

## Functional requirements

1. Fetch active binary markets from Gamma, normalize outcomes/token IDs, rules, dates, liquidity and volume, and persist them.
2. Generate bounded candidate pairs using same-event pairing and lexical similarity. Never send all O(n²) pairs to Jev.
3. Classify each candidate with Jev into: equivalent, a_implies_b, b_implies_a, mutually_exclusive, exhaustive, overlapping, unrelated. Also return rule ambiguity and confidence. Persist source/model/timestamp.
4. Fetch executable order books for YES/NO tokens from CLOB. Use asks and displayed depth, not midpoint/last price, when estimating entry.
5. Deterministically derive guaranteed-payoff two-leg baskets for equivalent, implication, mutual-exclusion and exhaustive relations. Reject overlapping/unrelated, low-confidence, ambiguous, stale, insufficient-depth and non-positive-net-edge cases.
6. Paper engine has configurable starting cash and per-trade cap, records immutable simulated fills/legs, prevents duplicate positions, and never contains an order-placement path.
7. Mark open paper positions to executable bids; support status/reporting. No invented settlement.
8. Optional Telegram notification for accepted paper trades.
9. CLI: `demo`, `sync`, `classify`, `scan`, `run-once`, `watch`, `status`, `doctor`. `demo` must be fully offline and exercise relation scanning + paper trade persistence using fixtures/mock classifier.
10. Configuration through environment with `.env.example`; sensible safety thresholds.

## Safety and correctness

- No wallet secrets, signing dependencies, or live trading code.
- Decimal-safe calculations; avoid binary floating point for money/probabilities where practical (integer micros/cents or decimal library).
- Jev proposes semantic relations; deterministic code performs all payoff/edge calculations.
- Include confidence gating and human-review metadata.
- Clearly label this research software, not financial advice.

## Verification

- Unit/integration tests for Gamma parsing, candidate generation, Jev adapter mapping (mocked), relation payoff mapping, depth-aware fills, fees/slippage thresholding, duplicate prevention, persistence and offline demo.
- Live read-only smoke test against Polymarket public APIs.
- `npm test`, lint, typecheck, build, demo, Docker build all pass.

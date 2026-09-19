import type { Classification, Market, OrderBook } from "../types.js";

const now = () => new Date().toISOString();
export function demoMarkets(): [Market, Market] {
  return [
    {
      id: "fixture-a",
      eventId: "fixture-event",
      question: "Will Example City exceed 30 C on July 1?",
      description: "Offline fixture A",
      rules: "Resolves YES iff official temperature exceeds 30 C.",
      yesTokenId: "fixture-a-yes",
      noTokenId: "fixture-a-no",
      endDate: "2030-07-01T23:59:59Z",
      liquidity: "1000",
      volume: "5000",
      active: true,
      fetchedAt: now(),
    },
    {
      id: "fixture-b",
      eventId: "fixture-event",
      question: "Will Example City be at most 30 C on July 1?",
      description: "Offline fixture B",
      rules: "Resolves YES iff official temperature is at most 30 C.",
      yesTokenId: "fixture-b-yes",
      noTokenId: "fixture-b-no",
      endDate: "2030-07-01T23:59:59Z",
      liquidity: "1000",
      volume: "5000",
      active: true,
      fetchedAt: now(),
    },
  ];
}
export function demoClassification(): Classification {
  return {
    marketAId: "fixture-a",
    marketBId: "fixture-b",
    relation: "exhaustive",
    ambiguous: false,
    confidence: 0.99,
    rationale:
      "Explicit offline fixture/mock classification: complementary temperature predicates.",
    source: "fixture",
    model: "fixture/mock",
    classifiedAt: now(),
    humanReviewRequired: false,
  };
}
export function demoBooks(): Record<string, OrderBook> {
  const timestamp = now();
  return {
    "fixture-a-yes": {
      tokenId: "fixture-a-yes",
      timestamp,
      asks: [{ price: "0.42", size: "100" }],
      bids: [{ price: "0.40", size: "100" }],
    },
    "fixture-b-yes": {
      tokenId: "fixture-b-yes",
      timestamp,
      asks: [{ price: "0.44", size: "100" }],
      bids: [{ price: "0.42", size: "100" }],
    },
  };
}

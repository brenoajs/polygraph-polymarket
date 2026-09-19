export const RELATIONS = [
  "equivalent",
  "a_implies_b",
  "b_implies_a",
  "mutually_exclusive",
  "exhaustive",
  "overlapping",
  "unrelated",
] as const;

export type Relation = (typeof RELATIONS)[number];
export type Outcome = "YES" | "NO";

export interface Market {
  id: string;
  eventId: string | null;
  question: string;
  description: string;
  rules: string;
  yesTokenId: string;
  noTokenId: string;
  endDate: string | null;
  liquidity: string;
  volume: string;
  active: boolean;
  fetchedAt: string;
}

export interface CandidatePair {
  a: Market;
  b: Market;
  reason: "same_event" | "lexical";
  similarity: number;
}

export interface Classification {
  marketAId: string;
  marketBId: string;
  relation: Relation;
  ambiguous: boolean;
  confidence: number;
  rationale: string;
  source: "jev" | "fixture";
  model: string;
  classifiedAt: string;
  humanReviewRequired: boolean;
}

export interface Level {
  price: string;
  size: string;
}
export interface OrderBook {
  tokenId: string;
  timestamp: string;
  asks: Level[];
  bids: Level[];
}

export interface BasketLeg {
  marketId: string;
  tokenId: string;
  outcome: Outcome;
}
export interface Basket {
  key: string;
  relation: Relation;
  legs: [BasketLeg, BasketLeg];
  guaranteedPayoutPerShare: string;
}

export interface FillEstimate {
  quantity: string;
  grossCost: string;
  fee: string;
  netEdge: string;
  edgeRatio: string;
  slippageBps: string;
  legs: [
    BasketLeg & { averagePrice: string; cost: string },
    BasketLeg & { averagePrice: string; cost: string },
  ];
}

export interface ScanRejection {
  pair: string;
  reason: string;
}
export interface ScanResult {
  accepted: {
    classification: Classification;
    basket: Basket;
    fill: FillEstimate;
  }[];
  rejected: ScanRejection[];
}

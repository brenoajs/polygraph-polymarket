import type { Basket, BasketLeg, Market, Relation } from "./types.js";

function leg(market: Market, outcome: "YES" | "NO"): BasketLeg {
  return {
    marketId: market.id,
    tokenId: outcome === "YES" ? market.yesTokenId : market.noTokenId,
    outcome,
  };
}
function basket(
  relation: Relation,
  suffix: string,
  a: BasketLeg,
  b: BasketLeg,
): Basket {
  return {
    key: `${relation}:${suffix}`,
    relation,
    legs: [a, b],
    guaranteedPayoutPerShare: "1",
  };
}

export function basketsFor(relation: Relation, a: Market, b: Market): Basket[] {
  switch (relation) {
    case "equivalent":
      return [
        basket(relation, "a_yes+b_no", leg(a, "YES"), leg(b, "NO")),
        basket(relation, "a_no+b_yes", leg(a, "NO"), leg(b, "YES")),
      ];
    case "a_implies_b":
      return [basket(relation, "a_no+b_yes", leg(a, "NO"), leg(b, "YES"))];
    case "b_implies_a":
      return [basket(relation, "a_yes+b_no", leg(a, "YES"), leg(b, "NO"))];
    case "mutually_exclusive":
      return [basket(relation, "a_no+b_no", leg(a, "NO"), leg(b, "NO"))];
    case "exhaustive":
      return [basket(relation, "a_yes+b_yes", leg(a, "YES"), leg(b, "YES"))];
    case "overlapping":
    case "unrelated":
      return [];
  }
}

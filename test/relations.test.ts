import { describe, expect, it } from "vitest";
import { basketsFor } from "../src/relations.js";
import { demoMarkets } from "../src/fixtures/demo.js";

describe("relation payoff mapping", () => {
  const [a, b] = demoMarkets();
  it.each([
    [
      "equivalent",
      [
        ["YES", "NO"],
        ["NO", "YES"],
      ],
    ],
    ["a_implies_b", [["NO", "YES"]]],
    ["b_implies_a", [["YES", "NO"]]],
    ["mutually_exclusive", [["NO", "NO"]]],
    ["exhaustive", [["YES", "YES"]]],
    ["overlapping", []],
    ["unrelated", []],
  ] as const)("%s maps only to deterministic baskets", (relation, outcomes) => {
    expect(
      basketsFor(relation, a, b).map((x) => x.legs.map((l) => l.outcome)),
    ).toEqual(outcomes);
  });
});

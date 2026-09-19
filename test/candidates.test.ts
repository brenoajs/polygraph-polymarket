import { describe, expect, it } from "vitest";
import { generateCandidates, lexicalSimilarity } from "../src/candidates.js";
import { demoMarkets } from "../src/fixtures/demo.js";

describe("bounded candidates", () => {
  it("prioritizes same-event and obeys hard bound", () => {
    const [a, b] = demoMarkets();
    const c = { ...b, id: "c", eventId: null, question: a.question };
    const out = generateCandidates([a, b, c], 1, 0.2);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe("same_event");
  });
  it("uses deterministic lexical Jaccard", () => {
    expect(
      lexicalSimilarity(
        "Will Alpha win election?",
        "Will Alpha win the election?",
      ),
    ).toBe(1);
    expect(lexicalSimilarity("Alpha wins", "Beta rains")).toBe(0);
  });
});

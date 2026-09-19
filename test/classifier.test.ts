import { describe, expect, it, vi } from "vitest";
import type { JSONValue } from "@ai-sdk/provider";
import { JevClassifier } from "../src/classifier.js";
import { demoMarkets } from "../src/fixtures/demo.js";

describe("Jev adapter", () => {
  it("maps injected typed evaluation and review metadata", async () => {
    const [a, b] = demoMarkets();
    const mock = vi.fn((state: Record<string, JSONValue>) => {
      expect(state).toHaveProperty("propositionA.question", a.question);
      return Promise.resolve({
        relation: "exhaustive" as const,
        ambiguousProbability: 0.2,
        confidence: 0.87,
      });
    });
    const result = await new JevClassifier(mock).classify({
      a,
      b,
      reason: "same_event",
      similarity: 1,
    });
    expect(result).toMatchObject({
      relation: "exhaustive",
      ambiguous: false,
      confidence: 0.87,
      source: "jev",
      model: "typesafe-ai/jev",
      humanReviewRequired: true,
    });
    expect(mock).toHaveBeenCalledOnce();
    expect(mock.mock.calls[0]?.[0]).toHaveProperty(
      "propositionA.question",
      a.question,
    );
  });
  it("requires gateway key in live mode", async () => {
    const saved = process.env.AI_GATEWAY_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    const [a, b] = demoMarkets();
    await expect(
      new JevClassifier().classify({
        a,
        b,
        reason: "same_event",
        similarity: 1,
      }),
    ).rejects.toThrow("AI_GATEWAY_API_KEY");
    if (saved) process.env.AI_GATEWAY_API_KEY = saved;
  });
});

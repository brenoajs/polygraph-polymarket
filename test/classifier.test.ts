import { describe, expect, it, vi } from "vitest";
import type { JSONValue } from "@ai-sdk/provider";
import { JevClassifier, mapEvaluationResponse } from "../src/classifier.js";
import { demoMarkets } from "../src/fixtures/demo.js";

describe("Jev adapter", () => {
  it("sends full resolution context and maps review metadata", async () => {
    const [a, b] = demoMarkets();
    const mock = vi.fn((state: Record<string, JSONValue>) => {
      expect(state).toHaveProperty("propositionA.question", a.question);
      expect(state).toHaveProperty("propositionA.description", a.description);
      expect(state).toHaveProperty("propositionA.rules", a.rules);
      expect(state).toHaveProperty(
        "propositionA.resolutionSource",
        a.resolutionSource,
      );
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
  });
  it("maps dedicated Choice confidence instead of selected probability", () => {
    expect(
      mapEvaluationResponse({
        answers: {
          relation: {
            type: "choice",
            choice: "equivalent",
            probabilities: { equivalent: 0.99 },
          },
          ambiguous: { type: "boolean", probability: 0.2 },
        },
        providerMetadata: { typesafe: { confidence: { relation: 0.73 } } },
      }),
    ).toEqual({
      relation: "equivalent",
      ambiguousProbability: 0.2,
      confidence: 0.73,
    });
  });
  it.each([
    {
      answers: {
        relation: { choice: "equivalent" },
        ambiguous: { probability: 2 },
      },
      providerMetadata: { typesafe: { confidence: { relation: 0.9 } } },
    },
    {
      answers: {
        relation: { choice: "equivalent" },
        ambiguous: { probability: 0.2 },
      },
      providerMetadata: { typesafe: { confidence: { relation: -1 } } },
    },
    {
      answers: {
        relation: { choice: "equivalent" },
        ambiguous: { probability: 0.2 },
      },
    },
  ])("fails closed on malformed SDK output", (payload) => {
    expect(() => mapEvaluationResponse(payload)).toThrow(/invalid/i);
  });
  it("requires gateway key in live mode", async () => {
    const hadKey = Object.prototype.hasOwnProperty.call(
      process.env,
      "AI_GATEWAY_API_KEY",
    );
    const saved = process.env.AI_GATEWAY_API_KEY ?? "";
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
    if (hadKey) process.env.AI_GATEWAY_API_KEY = saved;
    else delete process.env.AI_GATEWAY_API_KEY;
  });
});

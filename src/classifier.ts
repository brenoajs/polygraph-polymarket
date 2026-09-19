import { experimental_evaluate as evaluate } from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import type { CandidatePair, Classification, Relation } from "./types.js";
import { RELATIONS } from "./types.js";

const MODEL = "typesafe-ai/jev";
interface EvalOutput {
  relation: Relation;
  ambiguousProbability: number;
  confidence: number;
}
export type EvaluatePair = (
  state: Record<string, JSONValue>,
) => Promise<EvalOutput>;

async function liveEvaluate(
  state: Record<string, JSONValue>,
): Promise<EvalOutput> {
  if (!process.env.AI_GATEWAY_API_KEY)
    throw new Error(
      "AI_GATEWAY_API_KEY is required for live Jev classification",
    );
  const result = await evaluate({
    model: MODEL,
    state,
    questions: {
      relation: {
        type: "choice",
        instructions:
          "Classify the logical relation between binary prediction market proposition A and proposition B using their exact wording, rules, and resolution dates. Do not infer a trade or calculate prices.",
        criteria: {
          equivalent:
            "A and B necessarily have the same truth value under their resolution rules.",
          a_implies_b:
            "Whenever A is true, B must be true, but not necessarily conversely.",
          b_implies_a:
            "Whenever B is true, A must be true, but not necessarily conversely.",
          mutually_exclusive: "A and B cannot both be true.",
          exhaustive: "A and B cannot both be false.",
          overlapping:
            "They overlap semantically but none of the stronger guaranteed relations applies.",
          unrelated: "No useful logical relation.",
        },
      },
      ambiguous: {
        type: "boolean",
        instructions:
          "Is the relation unsafe to automate due to ambiguous wording, differing sources, dates, edge cases, or resolution rules?",
      },
    },
  });
  const relation = result.answers.relation.choice;
  const selectedProbability = result.answers.relation.probabilities?.[relation];
  const metadata = result.providerMetadata?.typesafe as
    | Record<string, unknown>
    | undefined;
  const confidenceMap = metadata?.confidence as
    | Record<string, unknown>
    | undefined;
  const providerConfidence = confidenceMap?.relation;
  const confidence =
    typeof selectedProbability === "number"
      ? selectedProbability
      : typeof providerConfidence === "number"
        ? providerConfidence
        : 0;
  return {
    relation,
    ambiguousProbability: result.answers.ambiguous.probability,
    confidence,
  };
}

export class JevClassifier {
  constructor(private readonly evaluatePair: EvaluatePair = liveEvaluate) {}
  async classify(pair: CandidatePair): Promise<Classification> {
    const output = await this.evaluatePair({
      propositionA: {
        question: pair.a.question,
        rules: pair.a.rules || pair.a.description,
        endDate: pair.a.endDate,
      },
      propositionB: {
        question: pair.b.question,
        rules: pair.b.rules || pair.b.description,
        endDate: pair.b.endDate,
      },
    });
    if (
      !RELATIONS.includes(output.relation) ||
      output.confidence < 0 ||
      output.confidence > 1
    )
      throw new Error("Jev returned an invalid classification");
    const ambiguous = output.ambiguousProbability >= 0.5;
    return {
      marketAId: pair.a.id,
      marketBId: pair.b.id,
      relation: output.relation,
      ambiguous,
      confidence: output.confidence,
      rationale: `Jev typed evaluation; ambiguity probability=${output.ambiguousProbability.toFixed(4)}`,
      source: "jev",
      model: MODEL,
      classifiedAt: new Date().toISOString(),
      humanReviewRequired: ambiguous || output.confidence < 0.9,
    };
  }
}

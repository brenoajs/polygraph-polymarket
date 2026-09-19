import { experimental_evaluate as evaluate } from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import type { CandidatePair, Classification, Relation } from "./types.js";
import { RELATIONS } from "./types.js";

const MODEL = "typesafe-ai/jev";
export interface EvalOutput {
  relation: Relation;
  ambiguousProbability: number;
  confidence: number;
}
export type EvaluatePair = (
  state: Record<string, JSONValue>,
) => Promise<EvalOutput>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function probability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** Map the AI SDK response without conflating Choice probability with confidence. */
export function mapEvaluationResponse(input: unknown): EvalOutput {
  const root = record(input);
  const answers = record(root?.answers);
  const relationAnswer = record(answers?.relation);
  const ambiguousAnswer = record(answers?.ambiguous);
  const relation = relationAnswer?.choice;
  const metadata = record(root?.providerMetadata);
  const typesafe = record(metadata?.typesafe);
  const confidenceByQuestion = record(typesafe?.confidence);
  const confidence = confidenceByQuestion?.relation;
  const ambiguousProbability = ambiguousAnswer?.probability;
  if (
    typeof relation !== "string" ||
    !RELATIONS.includes(relation as Relation) ||
    !probability(confidence) ||
    !probability(ambiguousProbability)
  )
    throw new Error("Invalid Jev evaluation response");
  return {
    relation: relation as Relation,
    ambiguousProbability,
    confidence,
  };
}

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
          "Classify the logical relation between binary prediction market proposition A and proposition B using their complete descriptions, rules, resolution sources, and dates. Do not infer a trade or calculate prices.",
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
  return mapEvaluationResponse(result);
}

export class JevClassifier {
  constructor(private readonly evaluatePair: EvaluatePair = liveEvaluate) {}
  async classify(pair: CandidatePair): Promise<Classification> {
    const output = await this.evaluatePair({
      propositionA: {
        question: pair.a.question,
        description: pair.a.description,
        rules: pair.a.rules,
        resolutionSource: pair.a.resolutionSource,
        endDate: pair.a.endDate,
      },
      propositionB: {
        question: pair.b.question,
        description: pair.b.description,
        rules: pair.b.rules,
        resolutionSource: pair.b.resolutionSource,
        endDate: pair.b.endDate,
      },
    });
    if (
      !RELATIONS.includes(output.relation) ||
      !probability(output.confidence) ||
      !probability(output.ambiguousProbability)
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

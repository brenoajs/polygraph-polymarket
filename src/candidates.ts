import type { CandidatePair, Market } from "./types.js";

const STOP = new Set([
  "will",
  "the",
  "a",
  "an",
  "be",
  "is",
  "are",
  "to",
  "of",
  "in",
  "on",
  "by",
  "before",
  "after",
  "and",
  "or",
]);
function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length > 1 && !STOP.has(x)),
  );
}
export function lexicalSimilarity(a: string, b: string): number {
  const aa = terms(a);
  const bb = terms(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  for (const term of aa) if (bb.has(term)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

export function generateCandidates(
  markets: Market[],
  maxCandidates: number,
  lexicalThreshold: number,
): CandidatePair[] {
  const candidates: CandidatePair[] = [];
  for (let i = 0; i < markets.length; i++)
    for (let j = i + 1; j < markets.length; j++) {
      const a = markets[i];
      const b = markets[j];
      if (!a || !b) continue;
      const sameEvent = a.eventId !== null && a.eventId === b.eventId;
      const similarity = lexicalSimilarity(a.question, b.question);
      if (sameEvent || similarity >= lexicalThreshold)
        candidates.push({
          a,
          b,
          reason: sameEvent ? "same_event" : "lexical",
          similarity,
        });
    }
  return candidates
    .sort(
      (x, y) =>
        Number(y.reason === "same_event") - Number(x.reason === "same_event") ||
        y.similarity - x.similarity ||
        x.a.id.localeCompare(y.a.id) ||
        x.b.id.localeCompare(y.b.id),
    )
    .slice(0, maxCandidates);
}

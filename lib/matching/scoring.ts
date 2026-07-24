export interface OpportunityScoreInputs {
  eventRelevance: number;
  dealRelevance: number;
  priorContextStrength: number;
  evidenceQuality: number;
}

export type OpportunityConfidence = "low" | "medium" | "high";

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function weightedOpportunityScore(input: OpportunityScoreInputs) {
  const score =
    0.35 * bounded(input.eventRelevance)
    + 0.30 * bounded(input.dealRelevance)
    + 0.20 * bounded(input.priorContextStrength)
    + 0.15 * bounded(input.evidenceQuality);
  return Number(score.toFixed(4));
}

export function confidenceForScore(score: number): OpportunityConfidence {
  if (score >= 0.78) return "high";
  if (score >= 0.58) return "medium";
  return "low";
}

export function rankQualifiedMatches<T extends { score: number }>(matches: T[]) {
  return matches
    .map((match) => ({
      ...match,
      confidence: confidenceForScore(match.score),
    }))
    .filter((match) => match.confidence !== "low")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5) as Array<T & { confidence: Exclude<OpportunityConfidence, "low"> }>;
}


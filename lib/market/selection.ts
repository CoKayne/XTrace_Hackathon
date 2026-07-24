import type { MarketConfidence, NormalizedMarketEvent } from "./types";
import { classifyMarketEventForAnalysis } from "./classification";

export const MAX_MARKET_EVENTS_FOR_ANALYSIS = 20;

const CONFIDENCE_RANK: Record<MarketConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

export interface MarketEventSelection {
  events: NormalizedMarketEvent[];
  totalCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  droppedCount: number;
}

export function selectMarketEventsForAnalysis(
  events: NormalizedMarketEvent[],
  limit = MAX_MARKET_EVENTS_FOR_ANALYSIS,
): MarketEventSelection {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("Market analysis event limit must be a positive integer.");
  }

  const eligible = events.flatMap((event) => {
    const classified = classifyMarketEventForAnalysis(event);
    return classified ? [classified] : [];
  });
  const ranked = eligible.sort((left, right) => {
    const confidenceDifference =
      CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
    if (confidenceDifference !== 0) return confidenceDifference;

    const publicationDifference =
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    if (publicationDifference !== 0) return publicationDifference;

    const sourceDifference = right.sources.length - left.sources.length;
    if (sourceDifference !== 0) return sourceDifference;

    return left.id.localeCompare(right.id);
  });
  const selected = ranked.slice(0, limit);

  return {
    events: selected,
    totalCount: events.length,
    eligibleCount: ranked.length,
    ineligibleCount: events.length - ranked.length,
    droppedCount: events.length - selected.length,
  };
}

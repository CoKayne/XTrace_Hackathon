import type { MarketEvent, SourceRef } from "../../lib/contracts/domain";
import type {
  MatchingDeal,
  MatchingMemoryContext,
  MatchingReasoner,
} from "../../lib/matching/service";
import { createMatchingService } from "../../lib/matching/service";

export async function matchOpportunityStage(input: {
  deals: MatchingDeal[];
  events: MarketEvent[];
  memoryContexts: MatchingMemoryContext[];
  sources: SourceRef[];
  reasoner: MatchingReasoner;
}) {
  return createMatchingService(input.reasoner).match(input);
}

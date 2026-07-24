import {
  OpportunityReportItemSchema,
  type DealStatus,
  type MarketEvent,
  type OpportunityReportItem,
  type SourceRef,
} from "../contracts/domain";
import {
  rankQualifiedMatches,
  weightedOpportunityScore,
  type OpportunityScoreInputs,
} from "./scoring";

export interface MatchingDeal {
  id: string;
  companyName: string;
  status: DealStatus;
}

export interface MatchingMemoryContext {
  dealId: string;
  text: string;
  sourceIds: string[];
  fixtureIds: string[];
}

export interface ReasonedMatch {
  dealId: string;
  whyNow: string;
  previousContext: string;
  positiveImplications: string[];
  negativeImplications: string[];
  nextStep: string;
  citedSourceIds: string[];
  demoFixtureIds: string[];
  scoreInputs: OpportunityScoreInputs;
  claimSourceIds: Record<string, string[]>;
}

export interface MatchingInput {
  deals: MatchingDeal[];
  events: MarketEvent[];
  memoryContexts: MatchingMemoryContext[];
  sources: SourceRef[];
}

export interface MatchingReasoner {
  reason(input: MatchingInput): Promise<ReasonedMatch[]>;
}

function supportedClaims(match: ReasonedMatch, validSourceIds: Set<string>) {
  return Object.entries(match.claimSourceIds)
    .filter(([, sourceIds]) =>
      sourceIds.length > 0 && sourceIds.every((sourceId) => validSourceIds.has(sourceId))
    )
    .map(([claim]) => claim);
}

function groundedWhyNow(match: ReasonedMatch, validSourceIds: Set<string>) {
  const claims = supportedClaims(match, validSourceIds);
  if (claims.length === 0) return "";
  const matchedClaims = claims.filter((claim) => match.whyNow.includes(claim));
  return matchedClaims.join(" ");
}

export function createMatchingService(reasoner: MatchingReasoner) {
  return {
    async match(input: MatchingInput): Promise<OpportunityReportItem[]> {
      const sourceById = new Map(input.sources.map((source) => [source.id, source]));
      const raw = await reasoner.reason(input);
      const grounded = raw.flatMap((match) => {
        const validSourceIds = new Set(
          match.citedSourceIds.filter((sourceId) => sourceById.has(sourceId)),
        );
        const whyNow = groundedWhyNow(match, validSourceIds);
        if (!whyNow || validSourceIds.size === 0) return [];
        const score = weightedOpportunityScore(match.scoreInputs);
        return [{
          ...match,
          whyNow,
          score,
          sources: [...validSourceIds].map((sourceId) => sourceById.get(sourceId)!),
        }];
      });

      return rankQualifiedMatches(grounded).map((match, index) =>
        OpportunityReportItemSchema.parse({
          rank: index + 1,
          dealId: match.dealId,
          confidence: match.confidence,
          score: match.score,
          whyNow: match.whyNow,
          previousContext: match.previousContext,
          implications: {
            positive: match.positiveImplications,
            negative: match.negativeImplications,
          },
          nextStep: match.nextStep,
          sources: match.sources,
          demoFixtureIds: match.demoFixtureIds,
        })
      );
    },
  };
}


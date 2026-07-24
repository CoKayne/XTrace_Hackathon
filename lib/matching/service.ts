import {
  OpportunityReportItemSchema,
  type DealStatus,
  type MarketEvent,
  type OpportunityReportItem,
  type SourceRef,
} from "../contracts/domain";
import {
  confidenceForScore,
  rankQualifiedMatches,
  weightedOpportunityScore,
  type OpportunityScoreInputs,
} from "./scoring";
import { nextStepForDealStatus } from "../reports/next-step-policy";

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

export interface GroundedMatch {
  dealId: string;
  confidence: "low" | "medium" | "high";
  score: number;
  whyNow: string;
  previousContext: string;
  implications: {
    positive: string[];
    negative: string[];
  };
  nextStep: string;
  relationship: "satisfies" | "contradicts" | "related";
  events: Array<{
    id: string;
    title: string;
    eventType: string;
    publishedAt: string;
    sourceIds: string[];
  }>;
  sources: SourceRef[];
  demoFixtureIds: string[];
}

interface GroundedClaim {
  text: string;
  sourceIds: string[];
}

function supportedClaims(
  match: ReasonedMatch,
  validSourceIds: Set<string>,
  sourceById: Map<string, SourceRef>,
): GroundedClaim[] {
  return Object.entries(match.claimSourceIds)
    .filter(([claim, sourceIds]) =>
      sourceIds.length > 0 && sourceIds.every((sourceId) => {
        const source = sourceById.get(sourceId);
        return validSourceIds.has(sourceId)
          && Boolean(source?.excerpt.includes(claim));
      })
    )
    .map(([text, sourceIds]) => ({ text, sourceIds }));
}

function groundedText(
  text: string,
  match: ReasonedMatch,
  validSourceIds: Set<string>,
  sourceById: Map<string, SourceRef>,
): GroundedClaim {
  const claims = supportedClaims(match, validSourceIds, sourceById);
  const matchedClaims = claims.filter((claim) => text.includes(claim.text));
  return {
    text: matchedClaims.map((claim) => claim.text).join(" "),
    sourceIds: [...new Set(matchedClaims.flatMap((claim) => claim.sourceIds))],
  };
}

const OVERLAP_STOP_WORDS = new Set([
  "about", "ai", "company", "data", "deal", "digital", "from",
  "enterprise", "funding", "into", "investment", "market", "platform", "regulation",
  "regulatory", "services", "software", "source", "startup", "technology",
  "that", "their", "this", "with",
]);

function evidenceTokens(value: string): Set<string> {
  return new Set(
    value.toLocaleLowerCase()
      .split(/[^\p{L}\p{N}+.-]+/u)
      .filter((token) =>
        token.length > 1 && !OVERLAP_STOP_WORDS.has(token)
      ),
  );
}

function overlapStrength(
  publicSourceIds: string[],
  dealSourceIds: string[],
  sourceById: Map<string, SourceRef>,
  deal: MatchingDeal,
  events: MarketEvent[],
): number {
  const publicTokens = evidenceTokens(
    publicSourceIds.map((sourceId) => sourceById.get(sourceId)?.excerpt ?? "").join(" "),
  );
  const dealTokens = evidenceTokens(
    dealSourceIds.map((sourceId) => sourceById.get(sourceId)?.excerpt ?? "").join(" "),
  );
  const overlapCount = [...publicTokens].filter((token) => dealTokens.has(token)).length;
  const companyTokens = evidenceTokens(deal.companyName);
  const explicitCompanyMatch = companyTokens.size > 0
    && [...companyTokens].every((token) => publicTokens.has(token));
  const relevantEvents = events.filter((event) =>
    event.sources.some((source) => publicSourceIds.includes(source.id))
  );
  const eventMetadataTokens = evidenceTokens(
    relevantEvents.flatMap((event) => [...event.sectors, ...event.themes]).join(" "),
  );
  const explicitMetadataMatch = [...eventMetadataTokens]
    .some((token) => dealTokens.has(token));

  if (overlapCount < 2 && !explicitCompanyMatch && !explicitMetadataMatch) return 0;
  return Math.min(
    0.9,
    0.6 + Math.min(Math.max(overlapCount - 2, 0), 2) * 0.15,
  );
}

export function createMatchingService(reasoner: MatchingReasoner) {
  const analyze = async (input: MatchingInput): Promise<GroundedMatch[]> => {
      const sourceById = new Map(input.sources.map((source) => [source.id, source]));
      const contextByDeal = new Map(input.memoryContexts.map((context) => [
        context.dealId,
        context,
      ]));
      const raw = await reasoner.reason(input);
      const grounded = raw.flatMap((match) => {
        const context = contextByDeal.get(match.dealId);
        const deal = input.deals.find((candidate) => candidate.id === match.dealId);
        if (!context || !deal) return [];
        const dealLineageIds = new Set([
          ...context.sourceIds,
          ...context.fixtureIds,
        ]);
        const validSourceIds = new Set(
          match.citedSourceIds.filter((sourceId) => sourceById.has(sourceId)),
        );
        const publicSourceIds = [...validSourceIds].filter((sourceId) =>
          sourceById.get(sourceId)?.provenance === "public_web"
        );
        const dealSourceIds = [...validSourceIds].filter((sourceId) =>
          dealLineageIds.has(sourceId)
        );
        if (!publicSourceIds.length || !dealSourceIds.length) return [];
        const deterministicRelevance = overlapStrength(
          publicSourceIds,
          dealSourceIds,
          sourceById,
          deal,
          input.events,
        );
        if (deterministicRelevance === 0) return [];

        const whyNow = groundedText(
          match.whyNow,
          match,
          new Set(publicSourceIds),
          sourceById,
        );
        const previousContext = groundedText(
          match.previousContext,
          match,
          dealLineageIds,
          sourceById,
        );
        if (!whyNow.text || !previousContext.text) return [];
        const groundedImplications = [
          ...match.positiveImplications,
          ...match.negativeImplications,
        ].map((claim) => groundedText(claim, match, validSourceIds, sourceById));
        const positiveImplications = match.positiveImplications.filter((claim) =>
          groundedImplications.some((grounded) => grounded.text === claim)
        );
        const negativeImplications = match.negativeImplications.filter((claim) =>
          groundedImplications.some((grounded) => grounded.text === claim)
        );
        const usedSourceIds = new Set([
          ...whyNow.sourceIds,
          ...previousContext.sourceIds,
          ...groundedImplications.flatMap((claim) => claim.sourceIds),
        ]);
        const demoFixtureIds = match.demoFixtureIds.filter((fixtureId) =>
          context.fixtureIds.includes(fixtureId) && usedSourceIds.has(fixtureId)
        );
        const score = weightedOpportunityScore({
          ...match.scoreInputs,
          eventRelevance: Math.min(
            match.scoreInputs.eventRelevance,
            deterministicRelevance,
          ),
          dealRelevance: Math.min(
            match.scoreInputs.dealRelevance,
            deterministicRelevance,
          ),
        });
        const events = input.events.flatMap((event) => {
          const sourceIds = event.sources
            .map((source) => source.id)
            .filter((sourceId) => usedSourceIds.has(sourceId));
          return sourceIds.length > 0
            ? [{
                id: event.id,
                title: event.title,
                eventType: event.eventType,
                publishedAt: event.publishedAt,
                sourceIds,
              }]
            : [];
        });
        const confidence = confidenceForScore(score);
        const relationship = positiveImplications.length > 0
          && negativeImplications.length === 0
          ? "satisfies" as const
          : negativeImplications.length > 0
            && positiveImplications.length === 0
          ? "contradicts" as const
          : "related" as const;
        return [{
          dealId: match.dealId,
          confidence,
          score,
          whyNow: whyNow.text,
          previousContext: previousContext.text,
          implications: {
            positive: positiveImplications,
            negative: negativeImplications,
          },
          nextStep: nextStepForDealStatus(deal.status),
          relationship,
          events,
          demoFixtureIds,
          sources: [...usedSourceIds].map((sourceId) => sourceById.get(sourceId)!),
        }];
      });

      return grounded.sort((left, right) => right.score - left.score);
  };

  return {
    analyze,
    async match(input: MatchingInput): Promise<OpportunityReportItem[]> {
      const grounded = await analyze(input);
      return rankQualifiedMatches(grounded).map((match, index) =>
        OpportunityReportItemSchema.parse({
          rank: index + 1,
          dealId: match.dealId,
          confidence: match.confidence,
          score: match.score,
          whyNow: match.whyNow,
          previousContext: match.previousContext,
          implications: match.implications,
          nextStep: match.nextStep,
          sources: match.sources,
          demoFixtureIds: match.demoFixtureIds,
        })
      );
    },
  };
}

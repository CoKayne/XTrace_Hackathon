import { z } from "zod";

import type { ClaudeClient } from "../claude/client";
import type {
  MatchingInput,
  MatchingReasoner,
  ReasonedMatch,
} from "./service";

const ScoreInputsSchema = z.object({
  eventRelevance: z.number().min(0).max(1),
  dealRelevance: z.number().min(0).max(1),
  priorContextStrength: z.number().min(0).max(1),
  evidenceQuality: z.number().min(0).max(1),
});

const ReasonedMatchSchema = z.object({
  dealId: z.string().min(1),
  whyNow: z.string().min(1),
  previousContext: z.string().min(1),
  positiveImplications: z.array(z.string()),
  negativeImplications: z.array(z.string()),
  nextStep: z.string().min(1),
  citedSourceIds: z.array(z.string()),
  demoFixtureIds: z.array(z.string()),
  scoreInputs: ScoreInputsSchema,
  claimSourceIds: z.record(z.string(), z.array(z.string())),
});

const ReasonedMatchesSchema = z.array(ReasonedMatchSchema).max(20);

export function createClaudeMatchingReasoner(
  client: ClaudeClient,
): MatchingReasoner {
  return {
    async reason(input: MatchingInput): Promise<ReasonedMatch[]> {
      if (!input.events.length || !input.deals.length) return [];
      const system = [
          "You are an evidence-constrained venture-capital research analyst.",
          "Find overlaps between recent public market events and previously reviewed Deals.",
          "Do not invent company progress, revenue, customers, fundraising, or current status.",
          "Use only the supplied memory context and source catalog.",
          "Every sentence in whyNow and previousContext, and every implication, must appear verbatim as a key in claimSourceIds.",
          "Every claim must be copied verbatim from every cited SourceRef.excerpt; a source ID alone is not evidence.",
          "Synthetic fixture records are internal demo context, never external company facts.",
          "nextStep must be a human research, review, diligence, or follow-up action; never recommend investing or committing capital.",
          "Return JSON only: an array matching the requested schema. Return [] when the evidence is insufficient.",
        ].join(" ");
      const requestContent = JSON.stringify({
        task: "Rank credible Deal/event overlaps for human follow-up.",
        outputSchema: {
          dealId: "candidate Deal id",
          whyNow: "one or more evidence-backed sentences",
          previousContext: "prior local context, clearly identifying synthetic records",
          positiveImplications: ["bounded implications"],
          negativeImplications: ["bounded implications"],
          nextStep: "human review action, not an investment decision",
          citedSourceIds: ["valid source IDs only"],
          demoFixtureIds: ["fixture IDs used"],
          scoreInputs: {
            eventRelevance: "0..1",
            dealRelevance: "0..1",
            priorContextStrength: "0..1",
            evidenceQuality: "0..1",
          },
          claimSourceIds: {
            "exact sentence copied from whyNow": ["valid source IDs"],
          },
        },
        deals: input.deals,
        marketEvents: input.events,
        memoryContexts: input.memoryContexts,
        sources: input.sources,
      });
      let response = await client.complete({
        system,
        messages: [{
          role: "user",
          content: requestContent,
        }],
        maxTokens: 6_000,
      });
      let parsed;
      try {
        parsed = ReasonedMatchesSchema.parse(parseJson(response));
      } catch {
        response = await client.complete({
          system,
          messages: [{
            role: "user",
            content: [
              requestContent,
              "The previous response failed JSON/schema validation.",
              "Repair it once. Return only a complete JSON array matching outputSchema.",
              `Previous response: ${response.slice(0, 12_000)}`,
            ].join("\n"),
          }],
          maxTokens: 6_000,
        });
        parsed = ReasonedMatchesSchema.parse(parseJson(response));
      }
      const allowedDeals = new Set(input.deals.map((deal) => deal.id));
      const allowedSources = new Set(input.sources.map((source) => source.id));
      return parsed
        .filter((match) => allowedDeals.has(match.dealId))
        .map((match) => ({
          ...match,
          citedSourceIds: unique(match.citedSourceIds)
            .filter((sourceId) => allowedSources.has(sourceId)),
          demoFixtureIds: unique(match.demoFixtureIds),
          claimSourceIds: Object.fromEntries(
            Object.entries(match.claimSourceIds).map(([claim, sourceIds]) => [
              claim,
              unique(sourceIds).filter((sourceId) => allowedSources.has(sourceId)),
            ]),
          ),
        }));
    },
  };
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

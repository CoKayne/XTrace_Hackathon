import { ClaudeReasonedMatchesSchema } from "./schemas";
import type { ClaudeClient } from "./client";
import type { MatchingInput, ReasonedMatch } from "../matching/service";

function evidencePrompt(input: MatchingInput) {
  return JSON.stringify({
    deals: input.deals,
    events: input.events,
    memoryContexts: input.memoryContexts,
    sources: input.sources.map((source) => ({
      id: source.id,
      provenance: source.provenance,
      title: source.title,
      excerpt: source.excerpt,
      publishedAt: source.publishedAt,
    })),
  });
}

function parseJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse((fenced?.[1] ?? text).trim()) as unknown;
}

export function createClaudeReasoner(client: ClaudeClient) {
  return {
    async reason(input: MatchingInput): Promise<ReasonedMatch[]> {
      const system = [
        "You are an evidence-grounded VC analyst.",
        "Use only the supplied evidence.",
        "Separate external facts from Demo fixture decision context.",
        "Every factual sentence must have source IDs in claimSourceIds.",
        "Return JSON only. Return [] when evidence is insufficient.",
      ].join(" ");
      const prompt = `Assess which historical Deals deserve review.\n${evidencePrompt(input)}`;
      let text = await client.complete({
        system,
        messages: [{ role: "user", content: prompt }],
      });
      let parsed: unknown;
      try {
        parsed = parseJson(text);
        return ClaudeReasonedMatchesSchema.parse(parsed);
      } catch (error) {
        text = await client.complete({
          system,
          messages: [{
            role: "user",
            content: `${prompt}\nYour previous output failed validation: ${String(error)}. Return valid JSON only.`,
          }],
        });
        parsed = parseJson(text);
        return ClaudeReasonedMatchesSchema.parse(parsed);
      }
    },
  };
}


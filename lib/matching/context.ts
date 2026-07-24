import type {
  DealMemoryBundle,
  MarketEvent,
  SourceRef,
} from "../contracts/domain";
import type { MatchingMemoryContext } from "./service";

export function buildStructuredMemoryContexts(
  bundles: DealMemoryBundle[],
): MatchingMemoryContext[] {
  return bundles.map((bundle) => ({
    dealId: bundle.dealId,
    sourceIds: unique(bundle.facts.flatMap((fact) =>
      fact.sources.map((source) => source.id)
    )),
    fixtureIds: unique(bundle.interactions.map((interaction) => interaction.id)),
    text: [
      `${bundle.companyName} is currently recorded as ${bundle.status}.`,
      ...bundle.facts.map((fact) => `Source-backed fact: ${fact.text}`),
      ...bundle.interactions.map((interaction) => [
        `${interaction.label}.`,
        `Summary: ${interaction.summary}`,
        `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
        `Revisit conditions: ${interaction.revisitConditions.join(" ") || "None recorded."}`,
      ].join(" ")),
    ].join("\n"),
  }));
}

export function buildMatchingSources(
  bundles: DealMemoryBundle[],
  events: MarketEvent[],
  baselineSources: SourceRef[] = [],
): SourceRef[] {
  const sources = [
    ...bundles.flatMap((bundle) =>
      bundle.facts.flatMap((fact) => fact.sources)
    ),
    ...bundles.flatMap((bundle) =>
      bundle.interactions.map((interaction): SourceRef => ({
        id: interaction.id,
        provenance: interaction.provenance,
        title: interaction.label,
        excerpt: [
          interaction.label,
          interaction.summary,
          `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
          `Revisit conditions: ${interaction.revisitConditions.join(" ") || "None recorded."}`,
        ].join(". "),
      }))
    ),
    ...events.flatMap((event) => event.sources),
    ...baselineSources,
  ];
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

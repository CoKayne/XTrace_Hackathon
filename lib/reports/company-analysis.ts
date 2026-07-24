import {
  CompanyAnalysisSchema,
  type CompanyAnalysis,
  type CompanyAnalysisCounts,
  type DealMemoryBundle,
  type EvidenceField,
  type SourceRef,
} from "../contracts/domain";
import type { GroundedMatch } from "../matching/service";
import type { MemoryContext } from "../xtrace/service";

const UNAVAILABLE = "Not available in current evidence" as const;
const NO_CHANGE =
  "No material market evidence matched this company during the current 14-day scan.";
const CONTINUE_MONITORING =
  "No immediate follow-up recommended. Continue monitoring.";
const ANALYSIS_UNAVAILABLE =
  "Analysis unavailable because XTrace did not return verified investment memory for this company.";

export function buildCompanyAnalyses(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundles: DealMemoryBundle[];
  contextsByDeal: ReadonlyMap<string, MemoryContext[]>;
  recallFailures: ReadonlySet<string>;
  groundedMatches: GroundedMatch[];
}): CompanyAnalysis[] {
  const groundedByDeal = new Map(
    input.groundedMatches.map((match) => [match.dealId, match]),
  );

  return input.bundles.map((bundle) => {
    const contexts = input.contextsByDeal.get(bundle.dealId);
    if (
      input.recallFailures.has(bundle.dealId)
      || !contexts
      || contexts.length === 0
    ) {
      return unavailableAnalysis({
        reportId: input.reportId,
        runId: input.runId,
        createdAt: input.createdAt,
        bundle,
      });
    }

    return completeAnalysis({
      reportId: input.reportId,
      runId: input.runId,
      createdAt: input.createdAt,
      bundle,
      contexts,
      match: groundedByDeal.get(bundle.dealId),
    });
  });
}

export function countCompanyAnalyses(
  analyses: readonly CompanyAnalysis[],
): CompanyAnalysisCounts {
  return {
    companyCount: analyses.length,
    beliefRevised: analyses.filter(
      (analysis) => analysis.outcome === "belief_revised",
    ).length,
    monitor: analyses.filter((analysis) => analysis.outcome === "monitor")
      .length,
    noMaterialChange: analyses.filter(
      (analysis) => analysis.outcome === "no_material_change",
    ).length,
    analysisUnavailable: analyses.filter(
      (analysis) => analysis.outcome === "analysis_unavailable",
    ).length,
  };
}

function completeAnalysis(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundle: DealMemoryBundle;
  contexts: MemoryContext[];
  match?: GroundedMatch;
}): CompanyAnalysis {
  const { bundle, contexts, match } = input;
  const interaction = latestInteraction(bundle);
  const localSources = bundleSources(bundle);
  const sources = uniqueSources([
    ...localSources,
    ...(match?.sources ?? []),
  ]);
  const publicSourceIds = sources
    .filter((source) => source.provenance === "public_web")
    .map((source) => source.id);
  const outcome = match
    ? match.confidence === "low" ? "monitor" : "belief_revised"
    : "no_material_change";
  const confidence = match?.confidence ?? "low";
  const marketEvidence = match
    ? {
        relationship: match.relationship,
        explanation: match.whyNow,
        eventIds: match.events.map((event) => event.id),
        events: match.events,
        sourceIds: publicSourceIds,
      }
    : {
        relationship: "none" as const,
        explanation: NO_CHANGE,
        eventIds: [],
        events: [],
        sourceIds: [],
      };

  return CompanyAnalysisSchema.parse({
    id: `${input.reportId}:${bundle.dealId}`,
    reportId: input.reportId,
    runId: input.runId,
    dealId: bundle.dealId,
    companyName: bundle.companyName,
    dealStatus: bundle.status,
    outcome,
    confidence,
    score: match?.score ?? 0,
    verifiedSourceCount: sources.length,
    investmentMemory: {
      previousMeetingSummary:
        interaction?.summary ?? "No previous meeting summary was recorded.",
      decisionReason:
        interaction?.decisionReason ?? "No previous decision reason was recorded.",
      concerns: interaction?.concerns ?? [],
      revisitConditions: interaction?.revisitConditions ?? [],
      lastEvaluatedAt: interaction?.occurredAt ?? null,
      memoryIds: unique(contexts.map((context) => context.memoryId)),
      sourceIds: unique(localSources.map((source) => source.id)),
      fixtureIds: unique([
        ...bundle.interactions.map((item) => item.id),
        ...contexts.flatMap((context) => context.fixtureIds),
      ]),
    },
    marketEvidence,
    implications: match?.implications ?? { positive: [], negative: [] },
    recommendedNextMove: outcome === "belief_revised"
      ? match!.nextStep
      : CONTINUE_MONITORING,
    companyBrief: buildCompanyBrief(bundle, sources),
    sources,
    createdAt: input.createdAt,
  });
}

function unavailableAnalysis(input: {
  reportId: string;
  runId: string;
  createdAt: string;
  bundle: DealMemoryBundle;
}): CompanyAnalysis {
  return CompanyAnalysisSchema.parse({
    id: `${input.reportId}:${input.bundle.dealId}`,
    reportId: input.reportId,
    runId: input.runId,
    dealId: input.bundle.dealId,
    companyName: input.bundle.companyName,
    dealStatus: input.bundle.status,
    outcome: "analysis_unavailable",
    confidence: "low",
    score: 0,
    verifiedSourceCount: 0,
    investmentMemory: {
      previousMeetingSummary: ANALYSIS_UNAVAILABLE,
      decisionReason: ANALYSIS_UNAVAILABLE,
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: null,
      memoryIds: [],
      sourceIds: [],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "unavailable",
      explanation: ANALYSIS_UNAVAILABLE,
      eventIds: [],
      events: [],
      sourceIds: [],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove:
      "Review system activity before relying on this company analysis.",
    companyBrief: {
      icSnapshot: [],
      traction: unavailableTraction(),
      dealTerms: unavailableDealTerms(),
      risks: [],
      decisionHistory: [],
      sourceLineage: [],
    },
    sources: [],
    createdAt: input.createdAt,
  });
}

function buildCompanyBrief(
  bundle: DealMemoryBundle,
  sources: SourceRef[],
): CompanyAnalysis["companyBrief"] {
  const interaction = latestInteraction(bundle);
  const fixtureId = interaction?.id;
  const firstFact = bundle.facts[0];

  return {
    icSnapshot: [
      ...(firstFact
        ? [{
            label: "Company overview",
            value: firstFact.text,
            unavailableReason: null,
            sourceIds: unique(
              firstFact.sources.map((source) => source.id),
            ),
          }]
        : []),
      ...(fixtureId
        ? [{
            label: "Deal status",
            value: bundle.status,
            unavailableReason: null,
            sourceIds: [fixtureId],
          }, {
            label: "Decision reason",
            value: interaction!.decisionReason,
            unavailableReason: null,
            sourceIds: [fixtureId],
          }]
        : []),
    ],
    traction: [
      exactEvidenceField(
        "ARR",
        /\bARR\b(?:\s*(?:of|:|=))?\s*\$[\d,.]+(?:[KMB])?/i,
        bundle,
      ),
      exactEvidenceField(
        "Customers / users",
        /\b[\d,.]+\+?\s+(?:customers|users)\b/i,
        bundle,
      ),
      exactEvidenceField(
        "Growth",
        /\b\d+(?:\.\d+)?%\s+(?:[A-Za-z-]+\s+){0,3}(?:growth|gains?|increase)\b/i,
        bundle,
      ),
    ],
    dealTerms: [
      exactEvidenceField(
        "Round",
        /\b(?:pre-seed|seed|series\s+[A-Z])\b/i,
        bundle,
      ),
      exactEvidenceField(
        "Raise",
        /\b(?:raising|raise|seeking)\s+\$[\d,.]+(?:[KMB])?\b/i,
        bundle,
      ),
      exactEvidenceField(
        "Valuation",
        /\b(?:valuation|valued at)\s*(?:of|:|=|at)?\s*\$[\d,.]+(?:[KMB])?\b/i,
        bundle,
      ),
    ],
    risks: interaction
      ? interaction.concerns.map((concern) => ({
          severity: "medium" as const,
          title: "Recorded Partner concern",
          detail: concern,
          nextQuestion: interaction.revisitConditions[0]
            ?? "What new source-backed evidence addresses this concern?",
          sourceIds: [interaction.id],
        }))
      : [],
    decisionHistory: interaction
      ? [{
          occurredAt: interaction.occurredAt,
          title: `${bundle.status} decision`,
          summary: interaction.decisionReason,
          sourceIds: [interaction.id],
        }]
      : [],
    sourceLineage: sources,
  };
}

function exactEvidenceField(
  label: string,
  pattern: RegExp,
  bundle: DealMemoryBundle,
): EvidenceField {
  for (const source of bundle.facts.flatMap((fact) => fact.sources)) {
    const match = source.excerpt.match(pattern);
    if (match?.[0]) {
      return {
        label,
        value: match[0],
        unavailableReason: null,
        sourceIds: [source.id],
      };
    }
  }
  return unavailableField(label);
}

function unavailableTraction(): EvidenceField[] {
  return [
    unavailableField("ARR"),
    unavailableField("Customers / users"),
    unavailableField("Growth"),
  ];
}

function unavailableDealTerms(): EvidenceField[] {
  return [
    unavailableField("Round"),
    unavailableField("Raise"),
    unavailableField("Valuation"),
  ];
}

function unavailableField(label: string): EvidenceField {
  return {
    label,
    value: null,
    unavailableReason: UNAVAILABLE,
    sourceIds: [],
  };
}

function latestInteraction(bundle: DealMemoryBundle) {
  return [...bundle.interactions].sort(
    (left, right) => right.occurredAt.localeCompare(left.occurredAt),
  )[0];
}

function bundleSources(bundle: DealMemoryBundle): SourceRef[] {
  return uniqueSources([
    ...bundle.facts.flatMap((fact) => fact.sources),
    ...bundle.interactions.map((interaction): SourceRef => ({
      id: interaction.id,
      provenance: interaction.provenance,
      title: interaction.label,
      excerpt: [
        interaction.label,
        interaction.summary,
        `Decision reason: ${interaction.decisionReason}`,
        `Concerns: ${interaction.concerns.join(" ") || "None recorded."}`,
        `Revisit conditions: ${
          interaction.revisitConditions.join(" ") || "None recorded."
        }`,
      ].join(". "),
    })),
  ]);
}

function uniqueSources(sources: SourceRef[]): SourceRef[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

import { evidenceQueryTokens } from "../demo/search";
import {
  CompanyAnalysisSchema,
  type CompanyAnalysis,
  type SourceRef,
} from "../contracts/domain";
import {
  sanitizeCompanyAnalysisNextStep,
  sanitizeReportOpportunities,
} from "../reports/next-step-policy";
import type { ChatEvidence } from "./service";

export interface PersistedReportForChat {
  id: string;
  opportunities: unknown;
  companyAnalyses?: unknown;
}

export function buildPersistedReportEvidence(input: {
  question: string;
  reports: readonly PersistedReportForChat[];
  companyByDeal: ReadonlyMap<string, string>;
}): ChatEvidence[] {
  const tokens = evidenceQueryTokens(input.question);
  const normalizedQuestion = input.question.toLocaleLowerCase();

  return input.reports.flatMap((report, reportIndex) => {
    const companyAnalyses = parseCompanyAnalyses(report.companyAnalyses)
      .filter((analysis) => analysis.outcome !== "analysis_unavailable");
    if (companyAnalyses.length > 0) {
      return companyAnalyses.flatMap((analysis, analysisIndex) =>
        companyAnalysisEvidence({
          analysis,
          analysisIndex,
          reportId: report.id,
          reportIndex,
          tokens,
          normalizedQuestion,
          companyName:
            input.companyByDeal.get(analysis.dealId) ?? analysis.companyName,
        })
      );
    }
    return sanitizeReportOpportunities(report.opportunities).flatMap((opportunity, opportunityIndex) => {
      const companyName =
        input.companyByDeal.get(opportunity.dealId) ?? opportunity.dealId;
      const haystack = [
        opportunity.dealId,
        companyName,
        opportunity.whyNow,
        opportunity.previousContext,
        opportunity.nextStep,
        "report recommendation recommend recommended previous context next step",
        reportIndex === 0 ? "latest" : "",
      ].join(" ").toLocaleLowerCase();
      const searchableTokens = new Set(evidenceQueryTokens(haystack));
      if (!tokens.every((token) => searchableTokens.has(token))) return [];
      const fields = [
        {
          key: "why-now",
          label: "why now",
          text: opportunity.whyNow,
        },
        {
          key: "previous-context",
          label: "previous context",
          text: opportunity.previousContext,
        },
        {
          key: "recommendation",
          label: "recommendation",
          text: opportunity.nextStep,
        },
      ];
      if (/\b(recommend|recommended|recommendation|next\s+step)\b/.test(normalizedQuestion)) {
        fields.unshift(fields.pop()!);
      } else if (/\b(previous|history|context)\b/.test(normalizedQuestion)) {
        fields.unshift(fields.splice(1, 1)[0]);
      }
      const conclusionEvidence = fields.map((field) => ({
        text: field.text,
        sources: [{
          id: `report:${report.id}:opportunity:${reportIndex}:${opportunityIndex}:${opportunity.dealId}:${field.key}`,
          provenance: "model_inference" as const,
          title: `Persisted report ${field.label} · ${companyName} · ${report.id} · opportunity ${opportunityIndex + 1}`,
          excerpt: field.text,
        }],
      }));
      const supportingEvidence = opportunity.sources.map((source) => ({
        text: source.excerpt,
        sources: [source],
      }));
      return [...conclusionEvidence, ...supportingEvidence];
    });
  });
}

function parseCompanyAnalyses(value: unknown): CompanyAnalysis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((analysis) => {
    const parsed = CompanyAnalysisSchema.safeParse(analysis);
    return parsed.success ? [parsed.data] : [];
  });
}

function companyAnalysisEvidence(input: {
  analysis: CompanyAnalysis;
  analysisIndex: number;
  reportId: string;
  reportIndex: number;
  tokens: string[];
  normalizedQuestion: string;
  companyName: string;
}): ChatEvidence[] {
  const analysis = input.analysis;
  const haystack = [
    analysis.dealId,
    input.companyName,
    analysis.outcome.replaceAll("_", " "),
    analysis.investmentMemory.previousMeetingSummary,
    analysis.investmentMemory.decisionReason,
    ...analysis.investmentMemory.concerns,
    ...analysis.investmentMemory.revisitConditions,
    analysis.marketEvidence.explanation,
    analysis.recommendedNextMove,
    "latest analysis outcome decision reason was there material market evidence recommended next move",
    input.reportIndex === 0 ? "latest" : "",
  ].join(" ").toLocaleLowerCase();
  const searchableTokens = new Set(evidenceQueryTokens(haystack));
  if (!input.tokens.every((token) => searchableTokens.has(token))) return [];

  const outcomeText =
    `The latest analysis outcome for ${input.companyName} is ${
      analysis.outcome.replaceAll("_", " ")
    }.`;
  const fields = [
    {
      key: "outcome",
      label: "analysis outcome",
      text: outcomeText,
      sourceIds: analysis.sources.map((source) => source.id),
    },
    {
      key: "decision-reason",
      label: "decision reason",
      text: analysis.investmentMemory.decisionReason,
      sourceIds: analysis.investmentMemory.sourceIds,
    },
    {
      key: "market-evidence",
      label: "market evidence",
      text: analysis.marketEvidence.explanation,
      sourceIds: analysis.marketEvidence.sourceIds,
    },
    {
      key: "next-move",
      label: "recommended next move",
      text: sanitizeCompanyAnalysisNextStep({
        outcome: analysis.outcome,
        value: analysis.recommendedNextMove,
      }),
      sourceIds: analysis.sources.map((source) => source.id),
    },
  ];
  const preferredKey = /\bdecision\s+reason\b/.test(input.normalizedQuestion)
    ? "decision-reason"
    : /\b(material|market)\b/.test(input.normalizedQuestion)
    ? "market-evidence"
    : /\b(recommend|recommended|next\s+move|next\s+step)\b/.test(
        input.normalizedQuestion,
      )
    ? "next-move"
    : "outcome";
  fields.sort((left, right) =>
    Number(right.key === preferredKey) - Number(left.key === preferredKey)
  );
  const sourceById = new Map(
    analysis.sources.map((source) => [source.id, source]),
  );
  const conclusionEvidence = fields.map((field) => {
    const inference: SourceRef = {
      id:
        `report:${input.reportId}:analysis:${input.reportIndex}:${input.analysisIndex}:${analysis.dealId}:${field.key}`,
      provenance: "model_inference",
      title:
        `Persisted report ${field.label} · ${input.companyName} · ${input.reportId}`,
      excerpt: field.text,
    };
    return {
      text: field.text,
      sources: [
        inference,
        ...field.sourceIds.flatMap((sourceId) => {
          const source = sourceById.get(sourceId);
          return source ? [source] : [];
        }),
      ],
    };
  });
  const supportingEvidence = analysis.sources.map((source) => ({
    text: source.excerpt,
    sources: [source],
  }));
  return [...conclusionEvidence, ...supportingEvidence];
}

import { evidenceQueryTokens } from "../demo/search";
import { sanitizeReportOpportunities } from "../reports/next-step-policy";
import type { ChatEvidence } from "./service";

export interface PersistedReportForChat {
  id: string;
  opportunities: unknown;
}

export function buildPersistedReportEvidence(input: {
  question: string;
  reports: readonly PersistedReportForChat[];
  companyByDeal: ReadonlyMap<string, string>;
}): ChatEvidence[] {
  const tokens = evidenceQueryTokens(input.question);
  const normalizedQuestion = input.question.toLocaleLowerCase();

  return input.reports.flatMap((report, reportIndex) =>
    sanitizeReportOpportunities(report.opportunities).flatMap((opportunity) => {
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
          id: `report:${report.id}:opportunity:${opportunity.dealId}:${field.key}`,
          provenance: "model_inference" as const,
          title: `Persisted report ${field.label} · ${companyName} · ${report.id}`,
          excerpt: field.text,
        }],
      }));
      const supportingEvidence = opportunity.sources.map((source) => ({
        text: source.excerpt,
        sources: [source],
      }));
      return [...conclusionEvidence, ...supportingEvidence];
    })
  );
}

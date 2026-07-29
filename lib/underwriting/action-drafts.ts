import {
  ActionDraftSchema,
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  MissingEvidenceItemSchema,
  type ActionDraft,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type MissingEvidenceItem,
} from "../contracts/underwriting";
import {
  renderAdvisoryDiligenceRequests,
  renderExperimentalAdvisoryOpinions,
  renderIndependentAdvisoryConflicts,
} from "./advisory-rendering";

export interface ActionDraftGenerator {
  generate(input: {
    candidateRunId: string;
    decision: DecisionResult;
    missingEvidence: MissingEvidenceItem[];
    recommendedNextSteps: string[];
    judgments?: FrameworkJudgment[];
    disagreements?: FrameworkDisagreement[];
  }): ActionDraft[];
}

export function createActionDraftGenerator(options: {
  workspaceId: string;
  now?: () => Date;
}): ActionDraftGenerator {
  const workspaceId = requireId(options.workspaceId, "workspaceId");
  const now = options.now ?? (() => new Date());
  return {
    generate(rawInput) {
      const candidateRunId = requireId(
        rawInput.candidateRunId,
        "candidateRunId",
      );
      const decision = DecisionResultSchema.parse(rawInput.decision);
      const missingEvidence = rawInput.missingEvidence.map((item) =>
        MissingEvidenceItemSchema.parse(item)
      );
      const recommendedNextSteps = rawInput.recommendedNextSteps.map(
        (step) => requireText(step, "recommendedNextStep"),
      );
      const judgments = (rawInput.judgments ?? []).map((judgment) =>
        FrameworkJudgmentSchema.parse(judgment)
      );
      const disagreements = (rawInput.disagreements ?? []).map(
        (disagreement) => FrameworkDisagreementSchema.parse(disagreement),
      );
      const timestamp = now().toISOString();
      const decisionLabel = decision.decision ?? "Unavailable";
      const missing = missingEvidenceText(missingEvidence);
      const nextSteps = listText(
        recommendedNextSteps,
        "No next step is supported by the saved analysis.",
      );
      const common = [
        `Formal decision: ${decisionLabel}`,
        `Decision ceiling: ${decision.decisionCeiling ?? "Unavailable"}`,
        `Confidence: ${decision.confidence}`,
      ].join("\n");
      const advisoryDraftSections = judgments.some(
          ({ frameworkMetadata }) => frameworkMetadata !== undefined,
        )
        ? [
          "",
          "EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY",
          renderExperimentalAdvisoryOpinions(judgments),
          "",
          "INDEPENDENT ADVISORY CONFLICTS",
          renderIndependentAdvisoryConflicts(disagreements, judgments),
          "",
          "ADVISORY DILIGENCE REQUESTS",
          renderAdvisoryDiligenceRequests(judgments),
        ]
        : [];
      const definitions = [
        {
          channel: "email" as const,
          audienceType: "founder" as const,
          body: [
            `Subject: Follow-up on underwriting evidence`,
            "",
            common,
            "",
            "Evidence to clarify:",
            missing,
            "",
            "Proposed next steps:",
            nextSteps,
          ].join("\n"),
        },
        {
          channel: "sms" as const,
          audienceType: "founder" as const,
          body: [
            `Underwriting follow-up draft — ${decisionLabel}.`,
            `Evidence to clarify: ${inlineEvidence(missingEvidence)}.`,
            `Next step: ${recommendedNextSteps[0] ?? "Review the saved analysis."}`,
          ].join(" "),
        },
        {
          channel: "linkedin" as const,
          audienceType: "founder" as const,
          body: [
            "Follow-up message draft",
            common,
            "Evidence to clarify:",
            missing,
            "Proposed next steps:",
            nextSteps,
          ].join("\n"),
        },
        {
          channel: "internal_memo" as const,
          audienceType: "internal" as const,
          body: [
            "INTERNAL UNDERWRITING ACTION MEMO",
            common,
            `Company Quality: ${decision.companyQuality}`,
            `Price Attractiveness: ${decision.priceAttractiveness}`,
            `Fund Fit: ${decision.fundFit}`,
            "",
            "Blocking or missing evidence:",
            missing,
            "",
            "Recommended internal work:",
            nextSteps,
            ...advisoryDraftSections,
          ].join("\n"),
        },
        {
          channel: "dd_request" as const,
          audienceType: "founder" as const,
          body: [
            "DUE DILIGENCE REQUEST DRAFT",
            common,
            "",
            "Requested evidence:",
            missing,
            "",
            "Review sequence:",
            nextSteps,
            ...advisoryDraftSections,
          ].join("\n"),
        },
      ];

      return definitions.map((definition) =>
        ActionDraftSchema.parse({
          id: [
            "action_draft",
            candidateRunId,
            definition.channel,
          ].join(":"),
          workspaceId,
          candidateRunId,
          channel: definition.channel,
          audienceType: definition.audienceType,
          body: definition.body,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      );
    },
  };
}

function missingEvidenceText(items: MissingEvidenceItem[]): string {
  if (items.length === 0) {
    return "No missing evidence item was saved.";
  }
  return items.map((item) => [
    `- ${item.label}`,
    `  Reason: ${item.reasonCode}`,
    `  Likely decision impact: ${item.mostLikelyDecisionImpact}`,
  ].join("\n")).join("\n");
}

function inlineEvidence(items: MissingEvidenceItem[]): string {
  return items.length === 0
    ? "no saved missing-evidence item"
    : items.map(({ label }) => label).join("; ");
}

function listText(items: string[], fallback: string): string {
  return items.length === 0
    ? fallback
    : items.map((item) => `- ${item}`).join("\n");
}

function requireId(value: string, label: string): string {
  if (value.trim() !== value || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty normalized ID.`);
  }
  return value;
}

function requireText(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty.`);
  }
  return value;
}

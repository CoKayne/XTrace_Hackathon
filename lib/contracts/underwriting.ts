import { z } from "zod";

import { ClaimEdgeSchema } from "./evidence";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const IsoDateSchema = z.iso.date();
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const ConfidenceSchema = z.enum(["low", "medium", "high"]);
const ScenarioNameSchema = z.enum(["bear", "base", "bull"]);
const DecisionLabelSchema = z.enum([
  "Pass",
  "Watch",
  "Advance",
  "Invest Candidate",
]);

export const FundPolicySnapshotSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  version: z.number().int().positive(),
  source: z.enum(["recommended_policy", "user_custom"]),
  values: z.record(
    z.string(),
    z.union([
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.null(),
      z.record(z.string(), z.unknown()),
    ]),
  ),
  createdByUserId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const ResolvedUnderwritingContextSchema = z.strictObject({
  id: IdSchema,
  contextVersion: z.string().min(1),
  stage: z.enum(["seed", "series_a"]),
  businessModel: z.enum(["b2b_saas", "enterprise_ai"]),
  geography: z.enum(["us", "global"]),
  securityType: z.literal("preferred"),
  asOfDate: IsoDateSchema,
  criticalEvidenceProfileId: IdSchema,
  benchmarkPackId: IdSchema.nullable(),
  benchmarkCompatibility: z.enum([
    "exact",
    "broad_compatible",
    "adjacent_only",
    "unavailable",
  ]),
  valuationMethodPolicyId: IdSchema,
  decisionPolicyId: IdSchema,
  frameworkPackId: IdSchema,
});

export const FrameworkConfidenceSchema = z.strictObject({
  sourceReliability: ConfidenceSchema,
  evidenceStrength: ConfidenceSchema,
  evidenceCoverage: ConfidenceSchema,
  applicability: ConfidenceSchema,
  judgment: ConfidenceSchema,
});

export const FrameworkJudgmentSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("framework_judgment"),
  frameworkCardId: IdSchema,
  frameworkVersion: z.string().min(1),
  applicability: z.enum(["applicable", "not_applicable", "unavailable"]),
  conclusion: z.enum(["supportive", "mixed", "negative", "abstain"]),
  supportEvidenceItemIds: z.array(IdSchema),
  counterEvidenceItemIds: z.array(IdSchema),
  unusedEvidenceItemIds: z.array(IdSchema),
  strongestSupport: z.string().min(1).nullable(),
  strongestCounterargument: z.string().min(1).nullable(),
  unknowns: z.array(z.string().min(1)),
  limitations: z.array(z.string().min(1)),
  confidence: FrameworkConfidenceSchema,
  claimEdges: z.array(ClaimEdgeSchema),
  fingerprint: z.string().min(1),
}).superRefine((judgment, context) => {
  if (
    judgment.claimEdges.some((edge) => edge.claimItemId !== judgment.id)
  ) {
    context.addIssue({
      code: "custom",
      message: "Framework claim edges must belong to the saved judgment",
    });
  }
});

export const FrameworkDisagreementSchema = z.strictObject({
  id: IdSchema,
  leftJudgmentId: IdSchema,
  rightJudgmentId: IdSchema,
  topic: z.enum([
    "growth_vs_revenue_quality",
    "fde_moat_vs_services_burden",
    "tam_vs_willingness_to_pay",
    "company_quality_vs_price",
    "contrarian_insight_vs_adoption",
  ]),
  explanation: z.string().min(1),
  evidenceItemIds: z.array(IdSchema),
});

export const ValuationScenarioSchema = z.strictObject({
  name: ScenarioNameSchema,
  valuation: z.string().min(1).nullable(),
  calculationIds: z.array(IdSchema),
});

export const ValuationEvaluationSchema = z.strictObject({
  id: IdSchema,
  status: z.enum(["completed", "partial", "unavailable"]),
  scenarios: z.array(ValuationScenarioSchema),
  currentAsk: z.string().min(1).nullable(),
  maximumAcceptablePreMoney: z.string().min(1).nullable(),
  initialOwnership: z.string().min(1).nullable(),
  postDilutionOwnership: z.string().min(1).nullable(),
  grossMoic: z.string().min(1).nullable(),
  grossIrr: z.string().min(1).nullable(),
  pricingPremium: z.string().min(1).nullable(),
  calculationIds: z.array(IdSchema),
  blockerCodes: z.array(z.string().min(1)),
});

export const ScenarioInputFieldSchema = z.enum([
  "revenue_path",
  "arr_path",
  "growth",
  "gross_margin",
  "contribution_margin",
  "operating_expenses",
  "burn",
  "cash",
  "runway",
  "future_financing",
  "future_dilution",
  "exit_timing",
  "exit_method",
  "exit_multiple",
  "success_conditions",
  "failure_conditions",
  "probability",
]);

export const ScenarioInputSchema = z.strictObject({
  id: IdSchema,
  scenario: ScenarioNameSchema,
  field: ScenarioInputFieldSchema,
  value: z.string().min(1).nullable(),
  unit: z.string().min(1).nullable(),
  evidenceItemId: IdSchema.nullable(),
  assumptionItemId: IdSchema.nullable(),
  unavailableReason: z.string().min(1).nullable(),
}).superRefine((input, context) => {
  const referenceCount = Number(input.evidenceItemId !== null)
    + Number(input.assumptionItemId !== null);

  if (
    input.value === null
    && (
      referenceCount !== 0
      || input.unavailableReason === null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Unavailable scenario inputs require a reason and no lineage",
    });
  }

  if (
    input.value !== null
    && (
      referenceCount !== 1
      || input.unavailableReason !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Available scenario inputs require exactly one lineage reference",
    });
  }
});

export const ScenarioModelEntrySchema = z.strictObject({
  name: ScenarioNameSchema,
  inputs: z.array(ScenarioInputSchema),
});

const requiredScenarioFields = new Set(ScenarioInputFieldSchema.options);

export const ScenarioModelSchema = z.strictObject({
  id: IdSchema,
  candidateRunId: IdSchema,
  formulaPolicyVersion: z.string().min(1),
  scenarios: z.array(ScenarioModelEntrySchema),
  probabilityWeighted: z.boolean(),
}).superRefine((model, context) => {
  const scenarioNames = model.scenarios.map((scenario) => scenario.name);
  if (
    model.scenarios.length !== ScenarioNameSchema.options.length
    || ScenarioNameSchema.options.some(
      (name) => scenarioNames.filter((item) => item === name).length !== 1,
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "ScenarioModel requires exactly Bear, Base, and Bull",
    });
  }

  for (const scenario of model.scenarios) {
    const fieldNames = scenario.inputs.map((input) => input.field);
    if (
      scenario.inputs.some((input) => input.scenario !== scenario.name)
      || fieldNames.length !== requiredScenarioFields.size
      || [...requiredScenarioFields].some(
        (field) => fieldNames.filter((item) => item === field).length !== 1,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Each scenario requires one matching input for every scenario field",
      });
    }
  }
});

export const FiredRuleSchema = z.strictObject({
  ruleId: IdSchema,
  inputRefs: z.array(IdSchema),
  result: z.enum(["pass", "fail", "not_applicable"]),
  appliedCeiling: z.string().min(1).nullable(),
  veto: z.boolean(),
});

export const DecisionResultSchema = z.strictObject({
  id: IdSchema,
  analysisType: z.literal("final_synthesis"),
  companyQuality: z.enum(["pass", "mixed", "fail", "unavailable"]),
  priceAttractiveness: z.enum(["pass", "mixed", "fail", "unavailable"]),
  fundFit: z.enum(["pass", "mixed", "fail", "unavailable"]),
  decision: DecisionLabelSchema.nullable(),
  decisionCeiling: DecisionLabelSchema.nullable(),
  hardVeto: z.boolean(),
  firedRules: z.array(FiredRuleSchema),
  blockingEvidenceItemIds: z.array(IdSchema),
  claimEdges: z.array(ClaimEdgeSchema),
  confidence: ConfidenceSchema,
}).superRefine((decision, context) => {
  if (decision.claimEdges.some((edge) => edge.claimItemId !== decision.id)) {
    context.addIssue({
      code: "custom",
      message: "Final synthesis claim edges must belong to the saved decision",
    });
  }
});

export const FinalSynthesisSchema = DecisionResultSchema;

export const UnderwritingBatchSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  scanRunId: IdSchema,
  status: z.enum(["queued", "running", "partial", "completed", "failed"]),
  batchInputFingerprint: z.string().min(1),
  fundPolicySnapshotId: IdSchema,
  rerunOfId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const UnderwritingSelectionSchema = z.strictObject({
  batchId: IdSchema,
  dealId: IdSchema,
  status: z.enum(["selected", "not_selected"]),
  rank: z.number().int().positive().nullable(),
  reason: z.string().min(1),
}).superRefine((selection, context) => {
  if (
    (selection.status === "selected" && selection.rank === null)
    || (selection.status === "not_selected" && selection.rank !== null)
  ) {
    context.addIssue({
      code: "custom",
      message: "Selection rank must match selection status",
    });
  }
});

export const CandidateRunSchema = z.strictObject({
  id: IdSchema,
  batchId: IdSchema,
  workspaceId: IdSchema,
  dealId: IdSchema,
  status: z.enum([
    "queued",
    "running",
    "partial",
    "completed",
    "unavailable",
    "failed",
  ]),
  candidateAnalysisFingerprint: z.string().min(1),
  rerunOfId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  finalizedAt: IsoDateTimeSchema.nullable(),
});

export const CandidateCheckpointSchema = z.strictObject({
  candidateRunId: IdSchema,
  stage: z.enum([
    "evidence_pack",
    "context_router",
    "valuation",
    "framework_lenses",
    "decision",
    "narrative_drafts",
    "finalization",
  ]),
  status: z.enum(["running", "completed", "failed"]),
  artifactFingerprint: z.string().min(1),
  publicReason: z.string().min(1).nullable(),
  savedAt: IsoDateTimeSchema,
});

export const XTraceLineageSnapshotSchema = z.strictObject({
  memoryIds: z.array(IdSchema),
  sourceRevisionIds: z.array(IdSchema),
  sourceIds: z.array(IdSchema),
  fixtureIds: z.array(IdSchema),
  capturedAt: IsoDateTimeSchema,
});

export const MissingEvidenceItemSchema = z.strictObject({
  fieldId: IdSchema,
  label: z.string().min(1),
  reasonCode: z.string().min(1),
  mostLikelyDecisionImpact: z.string().min(1),
});

export const ActionDraftSchema = z.strictObject({
  id: IdSchema,
  workspaceId: IdSchema,
  candidateRunId: IdSchema,
  channel: z.enum([
    "email",
    "sms",
    "linkedin",
    "internal_memo",
    "dd_request",
  ]),
  audienceType: z.enum(["founder", "customer", "internal"]),
  body: z.string().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export type FundPolicySnapshot = z.infer<typeof FundPolicySnapshotSchema>;
export type ResolvedUnderwritingContext = z.infer<
  typeof ResolvedUnderwritingContextSchema
>;
export type FrameworkConfidence = z.infer<typeof FrameworkConfidenceSchema>;
export type FrameworkJudgment = z.infer<typeof FrameworkJudgmentSchema>;
export type FrameworkDisagreement = z.infer<
  typeof FrameworkDisagreementSchema
>;
export type ValuationEvaluation = z.infer<typeof ValuationEvaluationSchema>;
export type ScenarioInputField = z.infer<typeof ScenarioInputFieldSchema>;
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;
export type ScenarioModel = z.infer<typeof ScenarioModelSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export type FinalSynthesis = DecisionResult;
export type UnderwritingBatch = z.infer<typeof UnderwritingBatchSchema>;
export type UnderwritingSelection = z.infer<
  typeof UnderwritingSelectionSchema
>;
export type CandidateRun = z.infer<typeof CandidateRunSchema>;
export type CandidateCheckpoint = z.infer<typeof CandidateCheckpointSchema>;
export type XTraceLineageSnapshot = z.infer<
  typeof XTraceLineageSnapshotSchema
>;
export type MissingEvidenceItem = z.infer<typeof MissingEvidenceItemSchema>;
export type ActionDraft = z.infer<typeof ActionDraftSchema>;

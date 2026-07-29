import {
  AssumptionSchema,
  CalculationSchema,
  FactSchema,
  type Assumption,
  type Calculation,
  type Fact,
} from "../contracts/evidence";
import {
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
} from "../contracts/underwriting";

export interface UnderwritingNarrativeInput {
  facts: Fact[];
  assumptions: Assumption[];
  calculations: Calculation[];
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
  decision: DecisionResult;
}

/**
 * Renders only persisted underwriting artifacts. There is intentionally no
 * free-form model text input and no path back into the formal decision.
 */
export function buildUnderwritingNarrative(
  rawInput: UnderwritingNarrativeInput,
): string {
  const input = parseInput(rawInput);
  return [
    "FORMAL RESULT",
    `Formal decision: ${input.decision.decision ?? "Unavailable"}`,
    `Decision ceiling: ${input.decision.decisionCeiling ?? "Unavailable"}`,
    `Hard veto: ${input.decision.hardVeto ? "active" : "not active"}`,
    `Decision confidence: ${input.decision.confidence}`,
    "",
    "INDEPENDENT DIMENSIONS",
    `Company Quality: ${input.decision.companyQuality}`,
    `Price Attractiveness: ${input.decision.priceAttractiveness}`,
    `Fund Fit: ${input.decision.fundFit}`,
    "",
    "PERSISTED FACTS",
    renderFacts(input.facts),
    "",
    "PERSISTED ASSUMPTIONS",
    renderAssumptions(input.assumptions),
    "",
    "PERSISTED CALCULATIONS",
    renderCalculations(input.calculations),
    "",
    "FRAMEWORK JUDGMENTS",
    renderJudgments(input.judgments),
    "",
    "FRAMEWORK DISAGREEMENTS",
    renderDisagreements(input.disagreements),
    "",
    "DECISION TRACE",
    renderDecisionTrace(input.decision),
    "",
    "BLOCKING EVIDENCE",
    renderList(input.decision.blockingEvidenceItemIds),
  ].join("\n");
}

function parseInput(
  input: UnderwritingNarrativeInput,
): UnderwritingNarrativeInput {
  return {
    facts: input.facts.map((item) => FactSchema.parse(item)),
    assumptions: input.assumptions.map((item) =>
      AssumptionSchema.parse(item)
    ),
    calculations: input.calculations.map((item) =>
      CalculationSchema.parse(item)
    ),
    judgments: input.judgments.map((item) =>
      FrameworkJudgmentSchema.parse(item)
    ),
    disagreements: input.disagreements.map((item) =>
      FrameworkDisagreementSchema.parse(item)
    ),
    decision: DecisionResultSchema.parse(input.decision),
  };
}

function renderFacts(facts: Fact[]): string {
  if (facts.length === 0) return "Unavailable";
  return facts.map((fact) => [
    `- ${fact.field}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`,
    `  Source revision: ${fact.sourceRevisionId}`,
    `  Assertion: ${fact.assertionStatus}; freshness: ${fact.freshness}; accepted for gate: ${fact.acceptedForGate ? "yes" : "no"}`,
  ].join("\n")).join("\n");
}

function renderAssumptions(assumptions: Assumption[]): string {
  if (assumptions.length === 0) return "Unavailable";
  return assumptions.map((assumption) => [
    `- ${assumption.field}: ${assumption.value}${assumption.unit ? ` ${assumption.unit}` : ""}`,
    `  Scenario: ${assumption.scenario}; origin: ${assumption.provenanceOrigin}`,
    `  Rationale: ${assumption.rationale}`,
    `  Input references: ${renderInlineList(assumption.inputRefIds)}`,
    `  Sensitivity: ${assumption.sensitivity}; confirmation required: ${assumption.requiresConfirmation ? "yes" : "no"}`,
  ].join("\n")).join("\n");
}

function renderCalculations(calculations: Calculation[]): string {
  if (calculations.length === 0) return "Unavailable";
  return calculations.map((calculation) => [
    `- ${calculation.formulaId}: ${calculation.output} ${calculation.unit}`,
    `  Formula version: ${calculation.formulaVersion}; status: ${calculation.status}`,
    `  Input references: ${renderInlineList(
      calculation.inputRefs.map(({ itemId }) => itemId),
    )}`,
  ].join("\n")).join("\n");
}

function renderJudgments(judgments: FrameworkJudgment[]): string {
  if (judgments.length === 0) return "Unavailable";
  return judgments.map((judgment) => [
    `- Framework: ${judgment.frameworkCardId}`,
    `  Framework version: ${judgment.frameworkVersion}`,
    `  Applicability: ${judgment.applicability}; conclusion: ${judgment.conclusion}`,
    `  Strongest support: ${judgment.strongestSupport ?? "Unavailable"}`,
    `  Strongest counterargument: ${judgment.strongestCounterargument ?? "Unavailable"}`,
    `  Supporting evidence: ${renderInlineList(judgment.supportEvidenceItemIds)}`,
    `  Counter evidence: ${renderInlineList(judgment.counterEvidenceItemIds)}`,
    `  Unused evidence: ${renderInlineList(judgment.unusedEvidenceItemIds)}`,
    `  Unknowns: ${renderInlineList(judgment.unknowns)}`,
    `  Limitations: ${renderInlineList(judgment.limitations)}`,
    [
      "  Confidence:",
      `source reliability=${judgment.confidence.sourceReliability}`,
      `evidence strength=${judgment.confidence.evidenceStrength}`,
      `evidence coverage=${judgment.confidence.evidenceCoverage}`,
      `applicability=${judgment.confidence.applicability}`,
      `judgment=${judgment.confidence.judgment}`,
    ].join(" "),
    `  Lineage dependencies: ${renderInlineList(
      judgment.claimEdges.map(({ dependencyItemId }) => dependencyItemId),
    )}`,
  ].join("\n")).join("\n");
}

function renderDisagreements(
  disagreements: FrameworkDisagreement[],
): string {
  if (disagreements.length === 0) return "Unavailable";
  return disagreements.map((disagreement) => [
    `- Topic: ${disagreement.topic}`,
    `  Frameworks: ${disagreement.leftJudgmentId}; ${disagreement.rightJudgmentId}`,
    `  Explanation: ${disagreement.explanation}`,
    `  Evidence: ${renderInlineList(disagreement.evidenceItemIds)}`,
  ].join("\n")).join("\n");
}

function renderDecisionTrace(decision: DecisionResult): string {
  if (decision.firedRules.length === 0) return "Unavailable";
  return decision.firedRules.map((rule) => [
    `- Rule: ${rule.ruleId}`,
    `  Result: ${rule.result}; ceiling: ${rule.appliedCeiling ?? "none"}; veto: ${rule.veto ? "yes" : "no"}`,
    `  Inputs: ${renderInlineList(rule.inputRefs)}`,
  ].join("\n")).join("\n");
}

function renderList(values: string[]): string {
  return values.length === 0
    ? "None"
    : values.map((value) => `- ${value}`).join("\n");
}

function renderInlineList(values: string[]): string {
  return values.length === 0 ? "None" : values.join("; ");
}

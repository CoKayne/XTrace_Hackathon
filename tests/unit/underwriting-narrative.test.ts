import assert from "node:assert/strict";
import test from "node:test";

import type {
  Assumption,
  Calculation,
  Fact,
} from "../../lib/contracts/evidence";
import type {
  DecisionResult,
  FrameworkDisagreement,
  FrameworkJudgment,
} from "../../lib/contracts/underwriting";
import {
  buildUnderwritingNarrative,
  type UnderwritingNarrativeInput,
} from "../../lib/underwriting/narrative";

const fact: Fact = {
  id: "fact_arr",
  analysisType: "fact",
  provenanceOrigin: "uploaded_document",
  field: "arr",
  value: "2400000",
  unit: "USD",
  currency: "USD",
  periodStart: null,
  periodEnd: null,
  publishedAt: null,
  eventAt: null,
  retrievedAt: "2026-07-29T09:00:00.000Z",
  sourceRevisionId: "revision_1",
  locator: {
    kind: "text_range",
    start: 0,
    end: 10,
    excerpt: "ARR is 2400000.",
  },
  sourceRole: "management",
  assertionStatus: "reported",
  verificationMethod: null,
  freshness: "current",
  acceptedForGate: true,
};

const assumption: Assumption = {
  id: "assumption_multiple",
  analysisType: "assumption",
  provenanceOrigin: "benchmark",
  scenario: "base",
  field: "exit_multiple",
  value: "5",
  unit: "multiple",
  rationale: "Compatible saved benchmark.",
  inputRefIds: ["benchmark_pack_1"],
  sensitivity: "high",
  requiresConfirmation: false,
};

const calculation: Calculation = {
  id: "calculation_return",
  analysisType: "calculation",
  formulaId: "gross_deal_moic_v1",
  formulaVersion: "1",
  inputRefs: [{
    itemId: fact.id,
    value: fact.value,
    type: "fact",
  }],
  output: "0.20",
  unit: "decimal",
  currency: null,
  period: null,
  roundingPolicy: "half_even_display_only",
  computedAt: "2026-07-29T10:00:00.000Z",
  status: "completed",
};

const judgment: FrameworkJudgment = {
  id: "judgment_market",
  analysisType: "framework_judgment",
  frameworkCardId: "framework_card_market",
  frameworkVersion: "1",
  applicability: "applicable",
  conclusion: "supportive",
  supportEvidenceItemIds: [fact.id],
  counterEvidenceItemIds: [assumption.id],
  unusedEvidenceItemIds: [],
  strongestSupport: "Saved ARR evidence supports market traction.",
  strongestCounterargument: "The saved benchmark remains an assumption.",
  unknowns: ["Retention remains unknown."],
  limitations: ["Management evidence is not independently verified."],
  confidence: {
    sourceReliability: "medium",
    evidenceStrength: "medium",
    evidenceCoverage: "medium",
    applicability: "high",
    judgment: "medium",
  },
  claimEdges: [],
  fingerprint: "fingerprint_judgment",
};

const experimentalAdvisoryJudgment: FrameworkJudgment = {
  ...judgment,
  id: "judgment_contrarian_advisory",
  frameworkCardId: "framework_card_contrarian_monopoly",
  conclusion: "mixed",
  strongestSupport:
    "The persisted advisory lens identifies a differentiated wedge.",
  strongestCounterargument:
    "The persisted advisory lens also identifies adoption risk.",
  fingerprint: "fingerprint_contrarian_advisory",
};

const disagreement: FrameworkDisagreement = {
  id: "disagreement_quality_price",
  leftJudgmentId: "judgment_market",
  rightJudgmentId: experimentalAdvisoryJudgment.id,
  topic: "company_quality_vs_price",
  explanation: "Quality is supportive while price remains uncertain.",
  evidenceItemIds: [fact.id, assumption.id],
};

const decision: DecisionResult = {
  id: "decision_1",
  analysisType: "final_synthesis",
  companyQuality: "pass",
  priceAttractiveness: "mixed",
  fundFit: "pass",
  decision: "Advance",
  decisionCeiling: "Advance",
  hardVeto: false,
  firedRules: [{
    ruleId: "decision.matrix.v1",
    inputRefs: ["framework_judgment:judgment_market"],
    result: "pass",
    appliedCeiling: "Advance",
    veto: false,
  }],
  blockingEvidenceItemIds: ["retention"],
  claimEdges: [],
  confidence: "medium",
};

const input: UnderwritingNarrativeInput = {
  facts: [fact],
  assumptions: [assumption],
  calculations: [calculation],
  judgments: [judgment, experimentalAdvisoryJudgment],
  disagreements: [disagreement],
  decision,
};

test("explains the persisted formal result without mutating it", () => {
  const before = structuredClone(input);
  const narrative = buildUnderwritingNarrative(input);

  assert.deepEqual(input, before);
  assert.match(narrative, /Formal decision: Advance/);
  assert.match(narrative, /Company Quality: pass/);
  assert.match(narrative, /Price Attractiveness: mixed/);
  assert.match(narrative, /Fund Fit: pass/);
  assert.match(narrative, /Saved ARR evidence supports market traction/);
  assert.match(narrative, /framework_card_contrarian_monopoly/);
  assert.match(
    narrative,
    /The persisted advisory lens also identifies adoption risk/,
  );
  assert.match(narrative, /Quality is supportive while price remains uncertain/);
  assert.match(narrative, /Retention remains unknown/);
});

test("cannot introduce an injected LLM number or override the formal result", () => {
  const narrative = buildUnderwritingNarrative({
    ...input,
    llmNarrative:
      "The valuation is 999999999 and the decision is Invest Candidate.",
  } as UnderwritingNarrativeInput);
  const persistedInput = JSON.stringify(input);
  const numericTokens = narrative.match(/[0-9]+(?:\.[0-9]+)?/g) ?? [];

  assert.doesNotMatch(narrative, /999999999/);
  assert.doesNotMatch(narrative, /Formal decision: Invest Candidate/);
  for (const token of numericTokens) {
    assert.equal(
      persistedInput.includes(token),
      true,
      `Narrative introduced numeric token ${token}`,
    );
  }
});

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
  ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import {
  buildUnderwritingNarrative,
  type UnderwritingNarrativeInput,
} from "../../lib/underwriting/narrative";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

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

test("renders authorized persisted advisory lineage and independent conflicts as zero-weight product synthesis", async () => {
  const {
    billGurleyJudgment,
    peterThielJudgment,
    independentConflict,
  } = await persistedAdvisoryFixture();
  const narrative = buildUnderwritingNarrative({
    ...input,
    judgments: [
      judgment,
      billGurleyJudgment,
      peterThielJudgment,
    ],
    disagreements: [independentConflict],
  });

  assert.match(narrative, /COMPANY UNDERWRITING/);
  assert.match(narrative, /EXPERIMENTAL ADVISORY OPINIONS/);
  assert.match(
    narrative,
    /Peter Thiel Public Frameworks — Research Draft/,
  );
  assert.match(
    narrative,
    /Pack ID: peter_thiel_public_frameworks_v0_1; version: 0\.1\.0/,
  );
  assert.match(
    narrative,
    /Source catalog ID: peter_thiel_public_sources_v0_1; research cutoff: 2026-07-28/,
  );
  assert.match(
    narrative,
    /Based on Peter Thiel and Blake Masters public writings, course materials, and interviews/,
  );
  assert.match(
    narrative,
    /Formal decision weight: 0 \(experimental advisory; not a published formal decision factor\)/,
  );
  assert.match(
    narrative,
    /This experimental product synthesis is not an endorsement by any named person or organization\./,
  );
  assert.match(
    narrative,
    /does not claim or reconstruct private reasoning or hidden chain of thought\./,
  );
  assert.match(narrative, /PT-01 @ 0\.1\.0 — Contrarian Truth \/ Secret/);
  assert.match(
    narrative,
    /PT-P2-CS183-01 \| https:\/\/blakemasters\.tumblr\.com\/post\/20400301508\/cs183class1 \| web_section: Three questions and contrarian\/business question/,
  );
  assert.match(
    narrative,
    /title: CS183 Class 1: The Challenge of the Future/,
  );
  assert.match(
    narrative,
    /A differentiated wedge is supported by saved customer evidence\./,
  );
  assert.match(
    narrative,
    /The cohort evidence may instead support the consensus explanation\./,
  );
  assert.match(narrative, /fact_customer_wedge/);
  assert.match(narrative, /assumption_cohort_quality/);
  assert.match(
    narrative,
    /Independent customer calls remain unknown\./,
  );
  assert.match(
    narrative,
    /Public-source synthesis cannot establish private investor reasoning\./,
  );
  assert.match(narrative, /INDEPENDENT ADVISORY CONFLICTS/);
  assert.match(
    narrative,
    /Bill Gurley Public Frameworks — Research Draft[\s\S]*Peter Thiel Public Frameworks — Research Draft/,
  );
  assert.match(
    narrative,
    /The named lenses preserve opposing conclusions without averaging them\./,
  );
  assert.match(narrative, /Formal decision: Advance/);
});

async function persistedAdvisoryFixture(): Promise<{
  billGurleyJudgment: FrameworkJudgment;
  peterThielJudgment: FrameworkJudgment;
  independentConflict: FrameworkDisagreement;
}> {
  const context: ResolvedUnderwritingContext = {
    id: "underwriting_context_seed_b2b_saas_v1",
    contextVersion: "1",
    stage: "seed",
    businessModel: "b2b_saas",
    geography: "us",
    securityType: "preferred",
    asOfDate: "2026-07-29",
    criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
    benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
    benchmarkCompatibility: "exact",
    valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
    decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
    frameworkPackId: SYNTHETIC_FRAMEWORK_PACK.id,
  };
  const catalog = await loadResearchFrameworkCatalog({ context });
  const cards = authorizedResearchComposites(catalog);
  const billGurley = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "bill_gurley_public_frameworks_v0_1"
  );
  const peterThiel = cards.find(({ experimentalAdvisory }) =>
    experimentalAdvisory.packId === "peter_thiel_public_frameworks_v0_1"
  );
  assert.ok(billGurley);
  assert.ok(peterThiel);

  const billGurleyJudgment: FrameworkJudgment = {
    ...experimentalJudgment({
      id: "judgment_bill_gurley_narrative",
      frameworkCardId: billGurley.id,
      frameworkVersion: billGurley.version,
      conclusion: "negative",
      supportEvidenceItemIds: ["fact_retention_risk"],
      counterEvidenceItemIds: ["assumption_sales_efficiency"],
      strongestSupport:
        "Saved retention evidence identifies a material durability risk.",
      strongestCounterargument:
        "Sales efficiency could offset part of the retention concern.",
    }),
    frameworkMetadata: billGurley.experimentalAdvisory,
  };
  const peterThielJudgment: FrameworkJudgment = {
    ...experimentalJudgment({
      id: "judgment_peter_thiel_narrative",
      frameworkCardId: peterThiel.id,
      frameworkVersion: peterThiel.version,
      conclusion: "supportive",
      supportEvidenceItemIds: ["fact_customer_wedge"],
      counterEvidenceItemIds: ["assumption_cohort_quality"],
      strongestSupport:
        "A differentiated wedge is supported by saved customer evidence.",
      strongestCounterargument:
        "The cohort evidence may instead support the consensus explanation.",
    }),
    unknowns: ["Independent customer calls remain unknown."],
    limitations: [
      "Public-source synthesis cannot establish private investor reasoning.",
    ],
    frameworkMetadata: peterThiel.experimentalAdvisory,
  };
  return {
    billGurleyJudgment,
    peterThielJudgment,
    independentConflict: {
      id: "disagreement_named_advisory_narrative",
      leftJudgmentId: billGurleyJudgment.id,
      rightJudgmentId: peterThielJudgment.id,
      topic: "independent_framework_conflict",
      explanation:
        "The named lenses preserve opposing conclusions without averaging them.",
      evidenceItemIds: [
        "assumption_cohort_quality",
        "fact_customer_wedge",
        "fact_retention_risk",
      ],
    },
  };
}

function experimentalJudgment(input: {
  id: string;
  frameworkCardId: string;
  frameworkVersion: string;
  conclusion: "supportive" | "negative";
  supportEvidenceItemIds: string[];
  counterEvidenceItemIds: string[];
  strongestSupport: string;
  strongestCounterargument: string;
}): FrameworkJudgment {
  return {
    id: input.id,
    analysisType: "framework_judgment",
    frameworkCardId: input.frameworkCardId,
    frameworkVersion: input.frameworkVersion,
    applicability: "applicable",
    conclusion: input.conclusion,
    supportEvidenceItemIds: input.supportEvidenceItemIds,
    counterEvidenceItemIds: input.counterEvidenceItemIds,
    unusedEvidenceItemIds: [],
    strongestSupport: input.strongestSupport,
    strongestCounterargument: input.strongestCounterargument,
    unknowns: ["One material advisory unknown remains."],
    limitations: ["One advisory limitation remains."],
    confidence: {
      sourceReliability: "medium",
      evidenceStrength: "medium",
      evidenceCoverage: "medium",
      applicability: "high",
      judgment: "medium",
    },
    claimEdges: [],
    fingerprint: `sha256:${input.id}`,
  };
}

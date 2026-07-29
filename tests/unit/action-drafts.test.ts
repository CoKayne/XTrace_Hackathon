import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionDraftSchema,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type MissingEvidenceItem,
  type ResolvedUnderwritingContext,
} from "../../lib/contracts/underwriting";
import {
  createActionDraftGenerator,
} from "../../lib/underwriting/action-drafts";
import {
  authorizedResearchComposites,
  loadResearchFrameworkCatalog,
} from "../../lib/underwriting/frameworks/research-loader";
import { SYNTHETIC_FRAMEWORK_PACK } from "../../seed/underwriting/framework-pack-v1";

const decision: DecisionResult = {
  id: "decision_1",
  analysisType: "final_synthesis",
  companyQuality: "pass",
  priceAttractiveness: "mixed",
  fundFit: "pass",
  decision: "Advance",
  decisionCeiling: "Advance",
  hardVeto: false,
  firedRules: [],
  blockingEvidenceItemIds: ["retention"],
  claimEdges: [],
  confidence: "medium",
};

const missingEvidence: MissingEvidenceItem[] = [{
  fieldId: "retention",
  label: "Current net revenue retention",
  reasonCode: "MISSING_CRITICAL_EVIDENCE",
  mostLikelyDecisionImpact: "Could change Price Attractiveness.",
}];

const generator = createActionDraftGenerator({
  workspaceId: "workspace_1",
  now: () => new Date("2026-07-29T12:00:00.000Z"),
});

test("creates exactly five deterministic editable draft-only artifacts", () => {
  const input = {
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: [
      "Request a current cohort-retention table.",
      "Schedule an internal pricing review.",
    ],
  };
  const first = generator.generate(input);
  const second = generator.generate(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ channel }) => channel), [
    "email",
    "sms",
    "linkedin",
    "internal_memo",
    "dd_request",
  ]);
  assert.deepEqual(first.map(({ audienceType }) => audienceType), [
    "founder",
    "founder",
    "founder",
    "internal",
    "founder",
  ]);
  assert.equal(
    first.every((draft) => ActionDraftSchema.safeParse(draft).success),
    true,
  );
  assert.match(first[0]!.body, /Advance/);
  assert.match(first[4]!.body, /Current net revenue retention/);
});

test("never persists addressing, delivery, sending, or provider fields", () => {
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
  });
  const forbidden = new Set([
    "recipient",
    "recipients",
    "to",
    "handle",
    "deliveryState",
    "deliveryStatus",
    "send",
    "sendMethod",
    "provider",
    "providerId",
    "publishedAt",
    "sentAt",
  ]);

  for (const draft of drafts) {
    assert.deepEqual(Object.keys(draft).sort(), [
      "audienceType",
      "body",
      "candidateRunId",
      "channel",
      "createdAt",
      "id",
      "updatedAt",
      "workspaceId",
    ]);
    assert.equal(
      Object.keys(draft).some((key) => forbidden.has(key)),
      false,
    );
  }
});

test("keeps email, SMS, and LinkedIn bodies unchanged when advisory artifacts are supplied", async () => {
  const advisory = await persistedAdvisoryFixture();
  const baseInput = {
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
  };
  const baseline = generator.generate(baseInput);
  const withAdvisory = generator.generate({
    ...baseInput,
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });

  assert.deepEqual(
    withAdvisory.slice(0, 3).map(({ body }) => body),
    baseline.slice(0, 3).map(({ body }) => body),
  );
});

test("renders authorized persisted advisory lineage and conflicts only in draft-only memo and diligence request", async () => {
  const advisory = await persistedAdvisoryFixture();
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });
  const internalMemo = drafts.find(({ channel }) =>
    channel === "internal_memo"
  );
  const diligenceRequest = drafts.find(({ channel }) =>
    channel === "dd_request"
  );
  assert.ok(internalMemo);
  assert.ok(diligenceRequest);

  for (const draft of [internalMemo, diligenceRequest]) {
    assert.match(
      draft.body,
      /EXPERIMENTAL ADVISORY OPINIONS — DRAFT ONLY/,
    );
    assert.match(
      draft.body,
      /Peter Thiel Public Frameworks — Research Draft/,
    );
    assert.match(
      draft.body,
      /Pack ID: peter_thiel_public_frameworks_v0_1; version: 0\.1\.0/,
    );
    assert.match(
      draft.body,
      /Source catalog ID: peter_thiel_public_sources_v0_1; research cutoff: 2026-07-28/,
    );
    assert.match(
      draft.body,
      /Formal decision weight: 0 \(experimental advisory; not a published formal decision factor\)/,
    );
    assert.match(
      draft.body,
      /This experimental product synthesis is not an endorsement by any named person or organization\./,
    );
    assert.match(
      draft.body,
      /does not claim or reconstruct private reasoning or hidden chain of thought\./,
    );
    assert.match(draft.body, /PT-01 @ 0\.1\.0 — Contrarian Truth \/ Secret/);
    assert.match(
      draft.body,
      /PT-P2-CS183-01 \| https:\/\/blakemasters\.tumblr\.com\/post\/20400301508\/cs183class1 \| web_section: Three questions and contrarian\/business question/,
    );
    assert.match(
      draft.body,
      /Advisory support: A differentiated wedge is supported by saved customer evidence\./,
    );
    assert.match(
      draft.body,
      /Advisory counterevidence: The cohort evidence may instead support the consensus explanation\./,
    );
    assert.match(
      draft.body,
      /Independent customer calls remain unknown\./,
    );
    assert.match(
      draft.body,
      /Public-source synthesis cannot establish private investor reasoning\./,
    );
    assert.match(draft.body, /INDEPENDENT ADVISORY CONFLICTS/);
    assert.match(
      draft.body,
      /Bill Gurley Public Frameworks — Research Draft[\s\S]*Peter Thiel Public Frameworks — Research Draft/,
    );
    assert.match(
      draft.body,
      /The named lenses preserve opposing conclusions without averaging them\./,
    );
  }
});

test("derives draft-only diligence requests from advisory unknowns, counterevidence, and limitations", async () => {
  const advisory = await persistedAdvisoryFixture();
  const drafts = generator.generate({
    candidateRunId: "candidate_1",
    decision,
    missingEvidence,
    recommendedNextSteps: ["Review the saved evidence."],
    judgments: advisory.judgments,
    disagreements: advisory.disagreements,
  });
  const diligenceRequest = drafts.find(({ channel }) =>
    channel === "dd_request"
  );
  assert.ok(diligenceRequest);

  assert.match(diligenceRequest.body, /ADVISORY DILIGENCE REQUESTS/);
  assert.match(
    diligenceRequest.body,
    /Resolve advisory unknown \[Peter Thiel Public Frameworks — Research Draft\]: Independent customer calls remain unknown\./,
  );
  assert.match(
    diligenceRequest.body,
    /Test advisory counterevidence \[Peter Thiel Public Frameworks — Research Draft\]: The cohort evidence may instead support the consensus explanation\. \(evidence IDs: assumption_cohort_quality\)/,
  );
  assert.match(
    diligenceRequest.body,
    /Address advisory limitation \[Peter Thiel Public Frameworks — Research Draft\]: Public-source synthesis cannot establish private investor reasoning\./,
  );
});

let persistedAdvisoryPromise:
  | Promise<{
    judgments: FrameworkJudgment[];
    disagreements: FrameworkDisagreement[];
  }>
  | undefined;

function persistedAdvisoryFixture(): Promise<{
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
}> {
  persistedAdvisoryPromise ??= buildPersistedAdvisoryFixture();
  return persistedAdvisoryPromise;
}

async function buildPersistedAdvisoryFixture(): Promise<{
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
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
      id: "judgment_bill_gurley_draft",
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
      id: "judgment_peter_thiel_draft",
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
  const disagreement: FrameworkDisagreement = {
    id: "disagreement_named_advisory_draft",
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
  };
  return {
    judgments: [billGurleyJudgment, peterThielJudgment],
    disagreements: [disagreement],
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

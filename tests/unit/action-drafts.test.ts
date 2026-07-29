import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionDraftSchema,
  type DecisionResult,
  type MissingEvidenceItem,
} from "../../lib/contracts/underwriting";
import {
  createActionDraftGenerator,
} from "../../lib/underwriting/action-drafts";

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

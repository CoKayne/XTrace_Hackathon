import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchInputFingerprint,
  createCandidateAnalysisFingerprint,
  type BatchFingerprintInput,
  type CandidateFingerprintInput,
} from "../../lib/underwriting/fingerprints";

function batchInput(): BatchFingerprintInput {
  return {
    workspaceId: "workspace_1",
    window: {
      days: 14,
      startsAt: "2026-07-15T00:00:00.000Z",
      endsAt: "2026-07-29T00:00:00.000Z",
    },
    marketSnapshot: {
      id: "market_snapshot_1",
      fingerprint: `sha256:${"1".repeat(64)}`,
    },
    eligibleDealRevisions: [
      {
        dealId: "deal_b",
        status: "screening",
        sourceRevisionIds: ["revision_2", "revision_1"],
        fingerprint: `sha256:${"2".repeat(64)}`,
      },
      {
        dealId: "deal_a",
        status: "passed",
        sourceRevisionIds: ["revision_3"],
        fingerprint: `sha256:${"3".repeat(64)}`,
      },
    ],
    xtraceLineage: {
      memoryIds: ["memory_2", "memory_1"],
      sourceRevisionIds: ["revision_3", "revision_1"],
      sourceIds: ["source_2", "source_1"],
      fixtureIds: ["fixture_1"],
      capturedAt: "2026-07-29T00:00:00.000Z",
    },
    selectedEvents: [
      {
        id: "event_b",
        fingerprint: `sha256:${"4".repeat(64)}`,
      },
      {
        id: "event_a",
        fingerprint: `sha256:${"5".repeat(64)}`,
      },
    ],
    matching: {
      providerModel: "claude-sonnet-4-5",
      promptVersion: "matching-prompt-v1",
      schemaVersion: "matching-schema-v1",
      scoringPolicyVersion: "score-v1",
      selectionPolicyVersion: "top-five-v1",
      judgmentFingerprint: `sha256:${"6".repeat(64)}`,
    },
    fundPolicySnapshot: {
      id: "fund_policy_1",
      version: 1,
      fingerprint: `sha256:${"7".repeat(64)}`,
    },
    frameworkPack: {
      id: "framework_pack_1",
      version: "1",
    },
    routerVersion: "router-v1",
    decisionPolicy: {
      id: "decision_policy_1",
      version: "1",
    },
  };
}

function candidateInput(): CandidateFingerprintInput {
  return {
    workspaceId: "workspace_1",
    batchInputFingerprint: createBatchInputFingerprint(batchInput()),
    dealRevision: {
      dealId: "deal_a",
      status: "passed",
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"8".repeat(64)}`,
    },
    evidencePack: {
      id: "evidence_pack_1",
      version: 1,
      sourceRevisionIds: ["revision_3", "revision_1"],
      fingerprint: `sha256:${"9".repeat(64)}`,
    },
    evidenceSourceIds: ["source_2", "source_1"],
    context: {
      id: "context_1",
      contextVersion: "1",
      criticalEvidenceProfileId: "critical_1",
      benchmarkPackId: "benchmark_1",
      valuationMethodPolicyId: "valuation_policy_1",
      frameworkPackId: "framework_pack_1",
      decisionPolicyId: "decision_policy_1",
    },
    criticalEvidenceProfile: { id: "critical_1", version: "1" },
    benchmarkPack: { id: "benchmark_1", version: "1" },
    valuationMethodPolicy: { id: "valuation_policy_1", version: "1" },
    formulaVersions: [
      "venture_return_method_v1@1",
      "market_comps_v1@1",
    ],
    providerModel: "claude-sonnet-4-5",
    promptVersion: "underwriting-prompt-v1",
    schemaVersion: "underwriting-schema-v1",
    settingsFingerprint: `sha256:${"a".repeat(64)}`,
    applicationCommit: "0002f6b",
  };
}

test("batch fingerprint is canonical over unordered revision, event, and lineage sets", () => {
  const left = batchInput();
  const right = batchInput();
  right.eligibleDealRevisions.reverse();
  right.eligibleDealRevisions[0].sourceRevisionIds.reverse();
  right.selectedEvents.reverse();
  right.xtraceLineage.memoryIds.reverse();
  right.xtraceLineage.sourceRevisionIds.reverse();
  right.xtraceLineage.sourceIds.reverse();

  const fingerprint = createBatchInputFingerprint(left);
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createBatchInputFingerprint(right), fingerprint);
});

test("batch fingerprint changes for every required execution dimension", () => {
  const baseline = createBatchInputFingerprint(batchInput());
  const mutations: Array<(input: BatchFingerprintInput) => void> = [
    (input) => {
      input.workspaceId = "workspace_2";
    },
    (input) => {
      input.window.startsAt = "2026-07-14T00:00:00.000Z";
    },
    (input) => {
      input.marketSnapshot.fingerprint = `sha256:${"b".repeat(64)}`;
    },
    (input) => {
      input.eligibleDealRevisions[0].fingerprint =
        `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.xtraceLineage.memoryIds.push("memory_3");
    },
    (input) => {
      input.selectedEvents[0].fingerprint = `sha256:${"d".repeat(64)}`;
    },
    (input) => {
      input.matching.providerModel = "claude-opus-4-1";
    },
    (input) => {
      input.matching.promptVersion = "matching-prompt-v2";
    },
    (input) => {
      input.matching.schemaVersion = "matching-schema-v2";
    },
    (input) => {
      input.matching.scoringPolicyVersion = "score-v2";
    },
    (input) => {
      input.matching.selectionPolicyVersion = "top-five-v2";
    },
    (input) => {
      input.matching.judgmentFingerprint = `sha256:${"e".repeat(64)}`;
    },
    (input) => {
      input.fundPolicySnapshot.fingerprint = `sha256:${"f".repeat(64)}`;
    },
    (input) => {
      input.frameworkPack.version = "2";
    },
    (input) => {
      input.routerVersion = "router-v2";
    },
    (input) => {
      input.decisionPolicy.version = "2";
    },
  ];

  for (const mutate of mutations) {
    const input = batchInput();
    mutate(input);
    assert.notEqual(createBatchInputFingerprint(input), baseline);
  }
});

test("candidate fingerprint is canonical and binds all candidate-specific versions", () => {
  const baselineInput = candidateInput();
  const reordered = candidateInput();
  reordered.dealRevision.sourceRevisionIds.reverse();
  reordered.evidencePack.sourceRevisionIds.reverse();
  reordered.evidenceSourceIds.reverse();
  reordered.formulaVersions.reverse();

  const baseline = createCandidateAnalysisFingerprint(baselineInput);
  assert.match(baseline, /^sha256:[0-9a-f]{64}$/);
  assert.equal(createCandidateAnalysisFingerprint(reordered), baseline);

  const mutations: Array<(input: CandidateFingerprintInput) => void> = [
    (input) => {
      input.batchInputFingerprint = `sha256:${"b".repeat(64)}`;
    },
    (input) => {
      input.dealRevision.fingerprint = `sha256:${"c".repeat(64)}`;
    },
    (input) => {
      input.evidencePack.fingerprint = `sha256:${"d".repeat(64)}`;
    },
    (input) => {
      input.evidenceSourceIds.push("source_3");
    },
    (input) => {
      input.context.contextVersion = "2";
    },
    (input) => {
      input.criticalEvidenceProfile.version = "2";
    },
    (input) => {
      input.benchmarkPack = null;
    },
    (input) => {
      input.valuationMethodPolicy.version = "2";
    },
    (input) => {
      input.formulaVersions.push("future_dilution_v1@2");
    },
    (input) => {
      input.providerModel = "claude-opus-4-1";
    },
    (input) => {
      input.promptVersion = "underwriting-prompt-v2";
    },
    (input) => {
      input.schemaVersion = "underwriting-schema-v2";
    },
    (input) => {
      input.settingsFingerprint = `sha256:${"e".repeat(64)}`;
    },
    (input) => {
      input.applicationCommit = "different";
    },
  ];
  for (const mutate of mutations) {
    const input = candidateInput();
    mutate(input);
    assert.notEqual(createCandidateAnalysisFingerprint(input), baseline);
  }
});

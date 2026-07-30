import assert from "node:assert/strict";
import test from "node:test";

import {
  describeUploadState,
  lineageForClaim,
  orderUnderwritingSelections,
  versionRows,
} from "../../app/underwriting-view-model";
import {
  toProductSearchMessage,
} from "../../app/product-search-view-model";

test("underwriting selections retain every explicit state while ranking selected Deals first", () => {
  const ordered = orderUnderwritingSelections([
    {
      dealId: "deal_not_selected",
      underwritingStatus: "not_selected",
      rank: null,
      candidateRunId: null,
      decision: null,
    },
    {
      dealId: "deal_partial",
      underwritingStatus: "partial",
      rank: 2,
      candidateRunId: "candidate_partial",
      decision: "Watch",
    },
    {
      dealId: "deal_queued",
      underwritingStatus: "queued",
      rank: 1,
      candidateRunId: "candidate_queued",
      decision: null,
    },
  ]);

  assert.deepEqual(
    ordered.map(({ dealId, underwritingStatus }) => [
      dealId,
      underwritingStatus,
    ]),
    [
      ["deal_queued", "queued"],
      ["deal_partial", "partial"],
      ["deal_not_selected", "not_selected"],
    ],
  );
});

test("upload presentation distinguishes retryable memory failure from terminal extraction failure", () => {
  assert.deepEqual(describeUploadState({
    status: "confirmed",
    failure: "Memory ingestion failed. Retry is available.",
  }), {
    label: "Retryable memory failure",
    tone: "warning",
    description: "Memory ingestion failed. Retry is available.",
    retryable: true,
  });
  assert.deepEqual(describeUploadState({
    status: "failed",
    failure: "Document processing failed.",
  }), {
    label: "Terminal extraction failure",
    tone: "error",
    description: "Document processing failed.",
    retryable: false,
  });
});

test("formal-claim lineage resolves the upstream calculation chain to exact source revisions", () => {
  const result = lineageForClaim({
    claimItemId: "decision_1",
    facts: [{
      id: "fact_1",
      sourceRevisionId: "revision_1",
    }],
    claimEdges: [
      {
        claimItemId: "decision_1",
        dependencyItemId: "judgment_1",
        dependencyType: "framework_judgment",
      },
      {
        claimItemId: "judgment_1",
        dependencyItemId: "calculation_1",
        dependencyType: "calculation",
      },
      {
        claimItemId: "calculation_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      },
    ],
  });

  assert.deepEqual(result, {
    dependencyItemIds: ["judgment_1", "calculation_1", "fact_1"],
    sourceRevisionIds: ["revision_1"],
  });
});

test("version rows expose every public pin and mark intentionally private pins unavailable", () => {
  const rows = versionRows({
    fundPolicyId: "policy_v3",
    benchmarkPackId: null,
    benchmarkEntryId: null,
    benchmarkDefinitionFingerprint: null,
    frameworkPackId: "framework_v1",
    frameworkPackDefinitionFingerprint: "sha256:framework",
    routerVersion: "router-v2",
    criticalEvidenceProfileId: "critical_v1",
    criticalEvidenceProfileDefinitionFingerprint: "sha256:critical",
    valuationMethodPolicyId: "valuation_v1",
    valuationMethodPolicyDefinitionFingerprint: "sha256:valuation",
    decisionPolicyId: "decision_v1",
    decisionPolicyDefinitionFingerprint: "sha256:decision",
    referenceCatalogFingerprint: "sha256:catalog",
    formulaVersions: ["returns@1", "ownership@2"],
    schemaVersion: "schema-v4",
  });

  assert.deepEqual(
    rows.map(({ label }) => label),
    [
      "Policy",
      "Benchmark",
      "Framework",
      "Research catalog",
      "Router",
      "Critical Evidence",
      "Valuation Method",
      "Decision",
      "Formula",
      "Model",
      "Prompt",
      "Schema",
      "Settings",
      "Application commit",
    ],
  );
  assert.equal(
    rows.find(({ label }) => label === "Benchmark")?.value,
    "Unavailable — no compatible benchmark was pinned",
  );
  assert.equal(
    rows.find(({ label }) => label === "Framework")?.value,
    "framework_v1 · sha256:framework",
  );
  assert.equal(
    rows.find(({ label }) => label === "Decision")?.value,
    "decision_v1 · sha256:decision",
  );
  for (const label of ["Model", "Prompt", "Settings", "Application commit"]) {
    assert.equal(
      rows.find((row) => row.label === label)?.value,
      "Not exposed by server",
    );
  }
});

test("product search presents only finalized artifact results with exact Source Revision citations", () => {
  const message = toProductSearchMessage([
    {
      itemId: "fact_1",
      candidateRunId: "candidate_1",
      dealId: "deal_1",
      analysisType: "fact",
      text: "arr: 2400000 USD",
      sourceRevisionIds: ["revision_1"],
      claimEdges: [],
    },
    {
      itemId: "calculation_1",
      candidateRunId: "candidate_1",
      dealId: "deal_1",
      analysisType: "calculation",
      text: "venture_method: 19200000 money",
      sourceRevisionIds: ["revision_1", "revision_2"],
      claimEdges: [{
        claimItemId: "calculation_1",
        dependencyItemId: "fact_1",
        dependencyType: "fact",
      }],
    },
  ]);

  assert.equal(
    message.text,
    "fact: arr: 2400000 USD\n\n"
      + "calculation: venture_method: 19200000 money",
  );
  assert.deepEqual(
    message.citations.map(({ id, url }) => [id, url]),
    [
      ["revision_1", "/api/source-revisions/revision_1/access"],
      ["revision_2", "/api/source-revisions/revision_2/access"],
    ],
  );
});

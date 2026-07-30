import assert from "node:assert/strict";
import test from "node:test";

import { GET as getReport } from "../../app/api/reports/[id]/route";
import { GET as getUnderwriting } from "../../app/api/reports/[id]/underwriting/[dealId]/route";
import { GET as search } from "../../app/api/search/route";
import {
  createMemoryIntelligenceRepository,
} from "../../db/repositories/intelligence";
import {
  createMemoryUnderwritingArtifactsRepository,
  type CandidateArtifactBundle,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type { RouteDependencies } from "../../lib/api/route-dependencies";

const WORKSPACE_ID = "workspace_read_api";
const REPORT_ID = "report_read_api";
const RUN_ID = "run_read_api";

function productDependencies(
  overrides: Partial<RouteDependencies> = {},
): RouteDependencies {
  return {
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: {
          userId: "user_read_api",
          email: "reader@example.test",
        },
        workspaceId: WORKSPACE_ID,
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    ...overrides,
  };
}

function params(id: string, dealId?: string) {
  return {
    params: Promise.resolve({
      id,
      ...(dealId ? { dealId } : {}),
    }),
  };
}

function finalizedBundle(input: {
  candidateRunId: string;
  workspaceId?: string;
  dealId?: string;
}): CandidateArtifactBundle {
  const workspaceId = input.workspaceId ?? WORKSPACE_ID;
  const dealId = input.dealId ?? "deal_selected";
  const sourceRevisionId = "revision_searchable";
  const factId = "fact_searchable";
  const assumptionId = "assumption_searchable";
  const calculationId = "calculation_searchable";
  const judgmentId = "judgment_searchable";
  const decisionId = "decision_searchable";
  return {
    candidateRunId: input.candidateRunId,
    workspaceId,
    dealId,
    candidateAnalysisFingerprint: `sha256:${"a".repeat(64)}`,
    evidencePack: {
      id: "pack_searchable",
      version: 1,
      workspaceId,
      dealId,
      asOfDate: "2026-07-29",
      sourceRevisionIds: [sourceRevisionId],
      facts: [{
        id: factId,
        analysisType: "fact",
        provenanceOrigin: "uploaded_document",
        field: "annual_recurring_revenue",
        value: "$2.4m carrier revenue",
        unit: "USD",
        currency: "USD",
        periodStart: null,
        periodEnd: null,
        publishedAt: null,
        eventAt: null,
        retrievedAt: "2026-07-29T12:00:00.000Z",
        sourceRevisionId,
        locator: {
          kind: "text_range",
          start: 0,
          end: 20,
          excerpt: "Carrier revenue is $2.4m.",
        },
        sourceRole: "management",
        assertionStatus: "reported",
        verificationMethod: null,
        freshness: "current",
        acceptedForGate: true,
      }],
      assumptions: [{
        id: assumptionId,
        analysisType: "assumption",
        provenanceOrigin: "recommended_policy",
        scenario: "base",
        field: "exit_multiple",
        value: "8",
        unit: "multiple",
        rationale: "Pinned policy assumption",
        inputRefIds: [],
        sensitivity: "high",
        requiresConfirmation: false,
      }],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: true,
        criticalEvidenceComplete: true,
        missingFieldIds: [],
        blockingConflictIds: [],
        decisionCeiling: "Invest Candidate",
        underwritingStatus: "available",
        reasonCodes: [],
      },
      createdAt: "2026-07-29T12:00:00.000Z",
    },
    context: {
      id: "context_searchable",
      contextVersion: "1",
      stage: "seed",
      businessModel: "b2b_saas",
      geography: "us",
      securityType: "preferred",
      asOfDate: "2026-07-29",
      criticalEvidenceProfileId: "critical_profile_1",
      benchmarkPackId: "benchmark_1",
      benchmarkCompatibility: "exact",
      valuationMethodPolicyId: "valuation_policy_1",
      decisionPolicyId: "decision_policy_1",
      frameworkPackId: "framework_pack_1",
    },
    scenarioModel: {
      id: "scenario_searchable",
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_policy_1",
      scenarios: [],
      probabilityWeighted: false,
    },
    calculations: [{
      id: calculationId,
      analysisType: "calculation",
      formulaId: "formula_searchable",
      formulaVersion: "1",
      inputRefs: [{
        itemId: factId,
        value: "2400000",
        type: "fact",
      }],
      output: "19200000",
      unit: "money",
      currency: "USD",
      period: null,
      roundingPolicy: "half_even_display_only",
      computedAt: "2026-07-29T12:00:00.000Z",
      status: "completed",
    }],
    calculationClaimEdges: [],
    judgments: [{
      id: judgmentId,
      analysisType: "framework_judgment",
      frameworkCardId: "framework_searchable",
      frameworkVersion: "1",
      applicability: "applicable",
      conclusion: "supportive",
      supportEvidenceItemIds: [factId],
      counterEvidenceItemIds: [],
      unusedEvidenceItemIds: [],
      strongestSupport: "Carrier revenue supports early demand.",
      strongestCounterargument: null,
      unknowns: [],
      limitations: ["Management-reported evidence."],
      confidence: {
        sourceReliability: "medium",
        evidenceStrength: "medium",
        evidenceCoverage: "medium",
        applicability: "high",
        judgment: "medium",
      },
      claimEdges: [{
        claimItemId: judgmentId,
        dependencyItemId: factId,
        dependencyType: "fact",
      }],
      fingerprint: `sha256:${"b".repeat(64)}`,
    }],
    disagreements: [],
    valuation: {
      id: "valuation_searchable",
      status: "completed",
      scenarios: [
        { name: "bear", valuation: "12000000", calculationIds: [calculationId] },
        { name: "base", valuation: "19200000", calculationIds: [calculationId] },
        { name: "bull", valuation: "28000000", calculationIds: [calculationId] },
      ],
      currentAsk: "18000000",
      maximumAcceptablePreMoney: "19200000",
      initialOwnership: "0.12",
      postDilutionOwnership: "0.09",
      grossMoic: "4",
      grossIrr: "0.32",
      pricingPremium: "-0.0625",
      calculationIds: [calculationId],
      blockerCodes: [],
    },
    decision: {
      id: decisionId,
      analysisType: "final_synthesis",
      companyQuality: "pass",
      priceAttractiveness: "pass",
      fundFit: "pass",
      decision: "Advance",
      decisionCeiling: "Invest Candidate",
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [{
        claimItemId: decisionId,
        dependencyItemId: judgmentId,
        dependencyType: "framework_judgment",
      }],
      confidence: "medium",
    },
    narrative: "Carrier revenue supports advancing source-grounded diligence.",
    actionDrafts: [],
    versionSnapshot: {
      fundPolicyId: "fund_policy_1",
      benchmarkPackId: "benchmark_1",
      benchmarkEntryId: "benchmark_entry_1",
      benchmarkDefinitionFingerprint: `sha256:${"1".repeat(64)}`,
      frameworkPackId: "framework_pack_1",
      frameworkPackDefinitionFingerprint: `sha256:${"2".repeat(64)}`,
      routerVersion: "router-v1",
      criticalEvidenceProfileId: "critical_profile_1",
      criticalEvidenceProfileDefinitionFingerprint:
        `sha256:${"3".repeat(64)}`,
      valuationMethodPolicyId: "valuation_policy_1",
      valuationMethodPolicyDefinitionFingerprint:
        `sha256:${"4".repeat(64)}`,
      decisionPolicyId: "decision_policy_1",
      decisionPolicyDefinitionFingerprint: `sha256:${"5".repeat(64)}`,
      referenceCatalogFingerprint: `sha256:${"6".repeat(64)}`,
      formulaVersions: ["formula-v1"],
      providerModel: "private-provider-model",
      promptVersion: "private-prompt-version",
      schemaVersion: "schema-v1",
      settingsFingerprint: "private-settings-fingerprint",
      applicationCommit: "private-application-commit",
    },
    claimEdges: [
      {
        claimItemId: judgmentId,
        dependencyItemId: factId,
        dependencyType: "fact",
      },
      {
        claimItemId: decisionId,
        dependencyItemId: judgmentId,
        dependencyType: "framework_judgment",
      },
    ],
  } as CandidateArtifactBundle;
}

async function readRepositories() {
  let sequence = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    idGenerator(kind) {
      sequence += 1;
      return `${kind}_read_${sequence}`;
    },
    artifacts,
  });
  const intelligence = createMemoryIntelligenceRepository();
  await intelligence.saveReport({
    id: REPORT_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    createdAt: "2026-07-29T12:00:00.000Z",
    marketSummary: "Persisted market summary",
    opportunities: [],
  });
  const batch = await runs.createOrReuseBatch({
    workspaceId: WORKSPACE_ID,
    scanRunId: RUN_ID,
    batchInputFingerprint: `sha256:${"7".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await runs.saveSelections({
    batchId: batch.id,
    selections: [
      {
        dealId: "deal_selected",
        status: "selected",
        rank: 1,
        reason: "Top-ranked persisted match",
      },
      {
        dealId: "deal_not_selected",
        status: "not_selected",
        rank: null,
        reason: "Outside the Top 5",
      },
    ],
  });
  const [candidate] = await runs.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_selected"],
  });
  artifacts.commitPrepared(finalizedBundle({
    candidateRunId: candidate.id,
  }));
  return { artifacts, runs, intelligence, batch, candidate };
}

test("report detail attaches an explicit persisted underwriting batch summary", async () => {
  const repositories = await readRepositories();
  const response = await getReport(
    new Request(`https://vsee.test/api/reports/${REPORT_ID}`),
    params(REPORT_ID),
    productDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      underwritingBatch: {
        batchId: string;
        selections: Array<Record<string, unknown>>;
      };
    };
  };
  assert.equal(payload.data.underwritingBatch.batchId, repositories.batch.id);
  assert.deepEqual(payload.data.underwritingBatch.selections, [
    {
      dealId: "deal_selected",
      underwritingStatus: "queued",
      rank: 1,
      candidateRunId: repositories.candidate.id,
      decision: null,
    },
    {
      dealId: "deal_not_selected",
      underwritingStatus: "not_selected",
      rank: null,
      candidateRunId: null,
      decision: null,
    },
  ]);
});

test("candidate detail returns persisted artifacts and hides internal provider metadata", async () => {
  const repositories = await readRepositories();
  const response = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    productDependencies({
      intelligence: repositories.intelligence,
      underwritingRuns: repositories.runs,
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: Record<string, unknown> & {
      sourceRevisionIds: string[];
      versionSnapshot: Record<string, unknown>;
    };
  };
  assert.deepEqual(payload.data.sourceRevisionIds, ["revision_searchable"]);
  assert.equal(payload.data.dealId, "deal_selected");
  assert.equal("providerModel" in payload.data.versionSnapshot, false);
  assert.equal("promptVersion" in payload.data.versionSnapshot, false);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /private-provider|private-prompt|private-settings|private-application/,
  );
});

test("search reads finalized persisted analysis items only and retains citations", async () => {
  const repositories = await readRepositories();
  const response = await search(
    new Request("https://vsee.test/api/search?q=2.4m%20carrier%20revenue"),
    undefined,
    productDependencies({
      underwritingArtifacts: repositories.artifacts,
    }),
  );

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: {
      results: Array<{
        itemId: string;
        analysisType: string;
        sourceRevisionIds: string[];
      }>;
    };
  };
  assert.deepEqual(payload.data.results.map((result) => result.itemId), [
    "fact_searchable",
  ]);
  assert.equal(payload.data.results[0].analysisType, "fact");
  assert.deepEqual(
    payload.data.results[0].sourceRevisionIds,
    ["revision_searchable"],
  );
});

test("new persisted-underwriting reads cannot cross organization scope", async () => {
  const repositories = await readRepositories();
  const foreign = productDependencies({
    async resolveRequestContext() {
      return {
        mode: "product",
        principal: { userId: "user_foreign", email: "foreign@example.test" },
        workspaceId: "workspace_foreign",
        role: "associate",
        permissions: {
          readWorkspace: true,
          readPrivateSources: true,
          mutateSources: false,
          managePolicy: false,
          administerFrameworks: false,
        },
      };
    },
    intelligence: repositories.intelligence,
    underwritingRuns: repositories.runs,
    underwritingArtifacts: repositories.artifacts,
  });
  const detail = await getUnderwriting(
    new Request(
      `https://vsee.test/api/reports/${REPORT_ID}/underwriting/deal_selected`,
    ),
    params(REPORT_ID, "deal_selected") as {
      params: Promise<{ id: string; dealId: string }>;
    },
    foreign,
  );
  const searchResponse = await search(
    new Request("https://vsee.test/api/search?q=carrier"),
    undefined,
    foreign,
  );
  assert.equal(detail.status, 404);
  assert.deepEqual(
    (await searchResponse.json() as {
      data: { results: unknown[] };
    }).data.results,
    [],
  );
});

test("public demo cannot query product underwriting search", async () => {
  const response = await search(
    new Request("https://vsee.test/api/search?q=carrier"),
    undefined,
    {
      async resolveRequestContext() {
        return {
          mode: "public_demo",
          principal: null,
          workspaceId: "workspace_demo",
          role: "demo",
          permissions: {
            readWorkspace: true,
            readPrivateSources: false,
            mutateSources: false,
            managePolicy: false,
            administerFrameworks: false,
          },
        };
      },
    },
  );
  assert.equal(response.status, 403);
});

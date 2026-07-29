import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDataClient,
  type RunRecord,
} from "../../db/client";
import {
  createMemoryIntelligenceRepository,
  type IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import {
  createMemoryDealRegistry,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import {
  createMemorySourceRegistry,
} from "../../db/repositories/source-registry";
import { createRunsRepository } from "../../db/repositories/runs";
import {
  createMemoryUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingRunsRepository,
  type CandidateFinalization,
} from "../../db/repositories/underwriting-runs";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
import {
  ScenarioInputFieldSchema,
  type FundPolicySnapshot,
} from "../../lib/contracts/underwriting";
import {
  createUnderwritingOrchestrator,
  createSyntheticCandidateExecutor,
} from "../../lib/underwriting/orchestrator";
import { BALANCED_POLICY_VALUES } from "../../seed/underwriting/balanced-policy-v1";
import { processClaimedRun } from "../../worker/process-run";

const NOW = new Date("2026-07-29T12:00:00.000Z");

const policy: FundPolicySnapshot = {
  id: "fund_policy:workspace_1:v1",
  workspaceId: "workspace_1",
  version: 1,
  source: "recommended_policy",
  values: structuredClone(
    BALANCED_POLICY_VALUES,
  ) as unknown as FundPolicySnapshot["values"],
  createdByUserId: null,
  createdAt: NOW.toISOString(),
};

const scanRun: RunRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "workspace_1",
  mode: "structured",
  windowDays: 14,
  status: "running",
  currentStage: "report",
  warningCount: 0,
  warnings: [],
  workerId: "worker_1",
  createdAt: "2026-07-29T11:00:00.000Z",
  startedAt: "2026-07-29T11:00:01.000Z",
  completedAt: null,
  leaseExpiresAt: "2026-07-29T12:05:00.000Z",
};

function analysis(
  dealId: string,
  score: number,
  input: Partial<Pick<
    CompanyAnalysis,
    "outcome" | "confidence"
  >> = {},
): CompanyAnalysis {
  const sourceId = `source_${dealId}`;
  return {
    id: `analysis_${dealId}`,
    reportId: "report_1",
    runId: scanRun.id,
    dealId,
    companyName: `Company ${dealId}`,
    dealStatus: "passed",
    outcome: input.outcome ?? "belief_revised",
    confidence: input.confidence ?? "high",
    score,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "Prior meeting",
      decisionReason: "The market was too early.",
      concerns: [],
      revisitConditions: ["Revisit after a market change."],
      lastEvaluatedAt: "2026-01-01T00:00:00.000Z",
      memoryIds: [],
      sourceIds: [sourceId],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: "satisfies",
      explanation: "The saved market evidence changes the prior timing belief.",
      eventIds: ["event_1"],
      events: [{
        id: "event_1",
        title: "Market event",
        eventType: "funding",
        publishedAt: "2026-07-28T00:00:00.000Z",
        sourceIds: [sourceId],
      }],
      sourceIds: [sourceId],
    },
    implications: {
      positive: ["The market may now support adoption."],
      negative: [],
    },
    recommendedNextMove: "Review the saved evidence.",
    companyBrief: {
      icSnapshot: [],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: "2026-01-01T00:00:00.000Z",
        title: "Passed",
        summary: "The market was too early.",
        sourceIds: [sourceId],
      }],
      sourceLineage: [{
        id: sourceId,
        provenance: "source_document",
        title: `Source ${dealId}`,
        documentId: `document_${dealId}`,
        excerpt: "Saved source evidence.",
      }],
    },
    sources: [{
      id: sourceId,
      provenance: "source_document",
      title: `Source ${dealId}`,
      documentId: `document_${dealId}`,
      excerpt: "Saved source evidence.",
    }],
    createdAt: NOW.toISOString(),
  };
}

function deal(id: string): RegisteredDeal {
  return {
    id,
    workspaceId: "workspace_1",
    companyId: `company_${id}`,
    companyName: `Company ${id}`,
    status: "passed",
    analysisEligibleAt: "2026-07-01T00:00:00.000Z",
    activeSourceRevisionFingerprint:
      `sha256:${id.padEnd(64, "0").slice(0, 64)}`,
    activeSourceRevisionIds: [`revision_${id}`],
  };
}

function report(analyses: CompanyAnalysis[]): IntelligenceReportRecord {
  return {
    id: "report_1",
    workspaceId: "workspace_1",
    runId: scanRun.id,
    createdAt: NOW.toISOString(),
    marketSummary: "A source-grounded market change was detected.",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 1,
      excludedPublicItems: 0,
      truncatedPublicEvents: 0,
      recalledDealCount: analyses.length,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: analyses.length,
      beliefRevised: analyses.filter(
        ({ outcome }) => outcome === "belief_revised",
      ).length,
      monitor: 0,
      noMaterialChange: 0,
      analysisUnavailable: 0,
    },
    priorityDealId: analyses[0]?.dealId ?? null,
    companyAnalyses: analyses,
  };
}

function finalization(input: {
  candidateRunId: string;
  dealId: string;
  workerId: string;
  leaseToken: string;
}): CandidateFinalization {
  return {
    workerId: input.workerId,
    leaseToken: input.leaseToken,
    candidateRunId: input.candidateRunId,
    candidateAnalysisFingerprint:
      `sha256:${input.dealId.padEnd(64, "a").slice(0, 64)}`,
    evidencePack: {
      id: `evidence_pack_${input.dealId}`,
      version: 1,
      workspaceId: "workspace_1",
      dealId: input.dealId,
      asOfDate: "2026-07-29",
      sourceRevisionIds: [`revision_${input.dealId}`],
      facts: [],
      assumptions: [],
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: false,
        criticalEvidenceComplete: false,
        missingFieldIds: ["company_identity"],
        blockingConflictIds: [],
        decisionCeiling: null,
        underwritingStatus: "unavailable",
        reasonCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
      },
      createdAt: NOW.toISOString(),
    },
    context: {
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
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
    },
    scenarioModel: {
      id: `scenario_model_${input.dealId}`,
      candidateRunId: input.candidateRunId,
      formulaPolicyVersion: "valuation_method_seed_b2b_saas_v1",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        inputs: ScenarioInputFieldSchema.options.map((field) => ({
          id: `${input.dealId}:${name}:${field}`,
          scenario: name,
          field,
          value: null,
          unit: null,
          evidenceItemId: null,
          assumptionItemId: null,
          unavailableReason: `${field} is unavailable.`,
        })),
      })),
      probabilityWeighted: false,
    },
    calculations: [],
    calculationClaimEdges: [],
    judgments: [],
    disagreements: [],
    valuation: {
      id: `valuation_${input.dealId}`,
      status: "unavailable",
      scenarios: (["bear", "base", "bull"] as const).map((name) => ({
        name,
        valuation: null,
        calculationIds: [],
      })),
      currentAsk: null,
      maximumAcceptablePreMoney: null,
      initialOwnership: null,
      postDilutionOwnership: null,
      grossMoic: null,
      grossIrr: null,
      pricingPremium: null,
      calculationIds: [],
      blockerCodes: ["MISSING_MINIMUM_MODEL_INPUTS"],
    },
    decision: {
      id: `decision_${input.dealId}`,
      analysisType: "final_synthesis",
      companyQuality: "unavailable",
      priceAttractiveness: "unavailable",
      fundFit: "unavailable",
      decision: null,
      decisionCeiling: null,
      hardVeto: false,
      firedRules: [],
      blockingEvidenceItemIds: [],
      claimEdges: [],
      confidence: "low",
    },
    narrative: "Underwriting unavailable because minimum evidence is missing.",
    actionDrafts: [],
    versionSnapshot: {
      fundPolicyId: policy.id,
      benchmarkPackId: "benchmark_pack_synthetic_us_software_v1",
      frameworkPackId:
        "framework_pack_synthetic_universal_saas_ai_v1",
      routerVersion: "context-router-v1",
      criticalEvidenceProfileId: "critical_evidence_seed_b2b_saas_v1",
      valuationMethodPolicyId: "valuation_method_seed_b2b_saas_v1",
      decisionPolicyId: "decision_policy_seed_b2b_saas_v1",
      formulaVersions: [],
      providerModel: "synthetic-test-lens",
      promptVersion: "framework-lens-v1",
      schemaVersion: "framework-judgment-v1",
      settingsFingerprint: `sha256:${"b".repeat(64)}`,
      applicationCommit: "task13-test",
    },
  };
}

async function uploadedDealRegistry() {
  const sources = createMemorySourceRegistry();
  await sources.createInitialRevision({
    id: "revision_uploaded",
    workspaceId: "workspace_1",
    sourceId: "document_uploaded",
    contentHash: `sha256:${"c".repeat(64)}`,
    objectKey: "private/uploads/uploaded-acme.md",
    objectVersion: "object:uploaded-acme:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:00:00.000Z",
    createdAt: "2026-07-29T10:00:01.000Z",
  });
  const registry = createMemoryDealRegistry({ sourceRegistry: sources });
  await registry.confirmSourceAssignment({
    requestId: "confirm_uploaded",
    workspaceId: "workspace_1",
    dealId: "deal_uploaded",
    companyId: "company_uploaded",
    companyName: "Uploaded Acme",
    status: "passed",
    sourceRevisionId: "revision_uploaded",
    assignedByUserId: "user_1",
    reason: "User confirmed the extracted upload and Deal assignment.",
    confirmedAt: "2026-07-29T10:01:00.000Z",
    memoryBundle: {
      dealId: "deal_uploaded",
      companyName: "Uploaded Acme",
      status: "passed",
      facts: [{
        text:
          "Uploaded Acme provides clinical workflow automation for health systems.",
        sources: [{
          id: "source_uploaded",
          provenance: "source_document",
          title: "Uploaded Acme founder memo",
          documentId: "document_uploaded",
          excerpt:
            "Uploaded Acme provides clinical workflow automation for health systems.",
        }],
      }],
      interactions: [],
    },
    memoryLineage: {
      evidence: {
        source_uploaded: {
          workspaceId: "workspace_1",
          dealId: "deal_uploaded",
          sourceId: "document_uploaded",
          sourceRevisionId: "revision_uploaded",
        },
      },
      interactions: {},
    },
  });
  return { registry, sources };
}

test("selects at most five medium/high belief revisions and records every eligible Deal", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const analyses = [
    analysis("deal_a", 0.99),
    analysis("deal_b", 0.95),
    analysis("deal_c", 0.90),
    analysis("deal_d", 0.85),
    analysis("deal_e", 0.80),
    analysis("deal_f", 0.75),
    analysis("deal_g", 0.70, {
      outcome: "monitor",
      confidence: "medium",
    }),
  ];
  const eligibleDeals = analyses.map(({ dealId }) => deal(dealId));

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals,
    forceRefresh: false,
  });

  const state = runs.inspect();
  assert.equal(batch.workspaceId, "workspace_1");
  assert.equal(state.selections.length, 7);
  assert.deepEqual(
    state.selections.filter(({ status }) => status === "selected")
      .map(({ dealId, rank }) => [dealId, rank]),
    [
      ["deal_a", 1],
      ["deal_b", 2],
      ["deal_c", 3],
      ["deal_d", 4],
      ["deal_e", 5],
    ],
  );
  assert.deepEqual(
    state.selections.filter(({ status }) => status === "not_selected")
      .map(({ dealId }) => dealId)
      .sort(),
    ["deal_f", "deal_g"],
  );
  assert.equal(state.candidates.length, 5);
  assert.equal(
    state.candidates.some(({ dealId }) => dealId === "deal_f"),
    false,
    "rank six is not a candidate and must never be converted into Pass",
  );
  assert.match(
    state.selections.find(({ dealId }) => dealId === "deal_f")?.reason ?? "",
    /truncation warning/i,
    "the candidate cap is a visible warning, not negative evidence",
  );
});

test("reuses the same immutable batch input without creating duplicate candidates", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const first = await orchestrator.createBatchAndSelections(input);
  const replay = await orchestrator.createBatchAndSelections(input);

  assert.equal(replay.id, first.id);
  assert.equal(runs.inspect().batches.length, 1);
  assert.equal(runs.inspect().candidates.length, 1);
});

test("changes the batch fingerprint when exact XTrace source lineage changes", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
  });
  const firstAnalysis = analysis("deal_a", 0.99);
  const revisedAnalysis = structuredClone(firstAnalysis);
  revisedAnalysis.investmentMemory.sourceIds.push("source_xtrace_new");

  const first = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([firstAnalysis]),
    analyses: [firstAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });
  const changed = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report([revisedAnalysis]),
    analyses: [revisedAnalysis],
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  });

  assert.notEqual(changed.id, first.id);
});

test("force refresh creates a linked batch and linked CandidateRun", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    autoProcessCandidates: false,
    refreshNonce: () => `refresh_${++sequence}`,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const baseInput = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
  };

  const first = await orchestrator.createBatchAndSelections({
    ...baseInput,
    forceRefresh: false,
  });
  const refreshed = await orchestrator.createBatchAndSelections({
    ...baseInput,
    forceRefresh: true,
  });

  assert.notEqual(refreshed.id, first.id);
  assert.equal(refreshed.rerunOfId, first.id);
  const candidates = runs.inspect().candidates;
  assert.equal(candidates.length, 2);
  assert.equal(
    candidates.find(({ batchId }) => batchId === refreshed.id)?.rerunOfId,
    candidates.find(({ batchId }) => batchId === first.id)?.id,
  );
});

test("a candidate failure preserves a completed predecessor and leaves the batch partial", async () => {
  let sequence = 0;
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    candidateExecutor: async ({ candidate, workerId, leaseToken }) => {
      if (candidate.dealId === "deal_b") {
        throw new Error("provider returned private diagnostic detail");
      }
      return finalization({
        candidateRunId: candidate.id,
        dealId: candidate.dealId,
        workerId,
        leaseToken,
      });
    },
    candidateMaxAttempts: 1,
  });
  const analyses = [
    analysis("deal_a", 0.99),
    analysis("deal_b", 0.95),
  ];

  const batch = await orchestrator.createBatchAndSelections({
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: analyses.map(({ dealId }) => deal(dealId)),
    forceRefresh: false,
  });

  const state = runs.inspect();
  assert.deepEqual(
    state.candidates.map(({ dealId, status }) => [dealId, status]),
    [
      ["deal_a", "completed"],
      ["deal_b", "failed"],
    ],
  );
  assert.equal(
    state.batches.find(({ id }) => id === batch.id)?.status,
    "partial",
  );
  assert.equal(batch.status, "partial");
  assert.equal(
    Object.values(state.failureReasons)[0],
    "Candidate underwriting failed after bounded retries.",
    "private provider diagnostics must not be persisted",
  );
});

test("runs the source-grounded candidate chain once and persists communication channels as drafts", async () => {
  let sequence = 0;
  let lensExecutions = 0;
  const artifacts = createMemoryUnderwritingArtifactsRepository();
  const runs = createMemoryUnderwritingRunsRepository({
    now: () => NOW,
    idGenerator: (kind) => `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
    artifacts,
  });
  const orchestrator = createUnderwritingOrchestrator({
    runs,
    activeFundPolicy: async () => policy,
    candidateExecutor: createSyntheticCandidateExecutor({
      frameworkLenses: {
        async runAll() {
          lensExecutions += 1;
          return { judgments: [], disagreements: [] };
        },
      },
      now: () => NOW,
      execution: {
        providerModel: "synthetic-test-lens",
        promptVersion: "framework-lens-v1",
        schemaVersion: "framework-judgment-v1",
        settingsFingerprint: `sha256:${"b".repeat(64)}`,
        applicationCommit: "task13-test",
      },
    }),
    now: () => NOW,
  });
  const analyses = [analysis("deal_a", 0.99)];
  const input = {
    scanRun,
    report: report(analyses),
    analyses,
    eligibleDeals: [deal("deal_a")],
    forceRefresh: false,
  };

  const first = await orchestrator.createBatchAndSelections(input);
  const replay = await orchestrator.createBatchAndSelections(input);

  assert.equal(replay.id, first.id);
  assert.equal(first.status, "completed");
  assert.equal(replay.status, "completed");
  assert.equal(lensExecutions, 1);
  assert.equal(runs.inspect().candidates[0]?.status, "completed");
  const saved = artifacts.inspect();
  assert.equal(saved.bundles.length, 1);
  assert.deepEqual(
    saved.bundles[0]?.actionDrafts.map(({ channel }) => channel).sort(),
    ["dd_request", "email", "internal_memo", "linkedin", "sms"],
  );
  assert.equal(
    saved.bundles[0]?.actionDrafts.every((draft) =>
      !("sentAt" in draft) && !("deliveryId" in draft)
    ),
    true,
  );
});

test("processes a confirmed uploaded Deal from the authoritative registry before underwriting", async () => {
  const { registry } = await uploadedDealRegistry();
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "structured",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);
  let underwritingInput:
    | Parameters<
      ReturnType<
        typeof createUnderwritingOrchestrator
      >["createBatchAndSelections"]
    >[0]
    | undefined;

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({ now: () => NOW }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return {
          status: "completed" as const,
          window: {
            from: "2026-07-15T12:00:00.000Z",
            to: NOW.toISOString(),
            days: 14 as const,
          },
          providers: [{
            providerId: "official",
            providerName: "Official source",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: NOW.toISOString(),
          }],
          events: [{
            id: "market_uploaded",
            title:
              "Uploaded Acme raises Series B for clinical workflow automation",
            eventType: "funding",
            sectors: ["healthcare"],
            themes: ["clinical", "workflow", "automation"],
            summary:
              "Uploaded Acme raised funding to expand clinical workflow automation for health systems.",
            positiveImplications: [
              "The expansion may satisfy the saved revisit condition.",
            ],
            negativeImplications: [],
            publishedAt: "2026-07-28T00:00:00.000Z",
            confidence: "high" as const,
            sources: [{
              id: "market_source_uploaded",
              provenance: "public_web" as const,
              title:
                "Uploaded Acme raises Series B for clinical workflow automation",
              url: "https://example.com/uploaded-acme-expansion",
              publishedAt: "2026-07-28T00:00:00.000Z",
              excerpt:
                "Uploaded Acme raised funding to expand clinical workflow automation for health systems.",
            }],
            canonicalUrl:
              "https://example.com/uploaded-acme-expansion",
            contentChecksum: "uploaded-acme-market-v1",
            retrievedAt: NOW.toISOString(),
            providerId: "official",
            entityKeys: ["uploaded-acme"],
          }],
        };
      },
    },
    reasoner: {
      async reason() {
        return [{
          dealId: "deal_uploaded",
          whyNow:
            "Uploaded Acme raised funding to expand clinical workflow automation for health systems.",
          previousContext:
            "Uploaded Acme provides clinical workflow automation for health systems.",
          positiveImplications: [
            "The expansion may satisfy the saved revisit condition.",
          ],
          negativeImplications: [],
          nextStep: "Review the uploaded source and market expansion.",
          citedSourceIds: [
            "market_source_uploaded",
            "source_uploaded",
          ],
          demoFixtureIds: [],
          scoreInputs: {
            eventRelevance: 0.9,
            dealRelevance: 0.9,
            priorContextStrength: 0.8,
            evidenceQuality: 0.9,
          },
          claimSourceIds: {
            "Uploaded Acme raised funding to expand clinical workflow automation for health systems.": [
              "market_source_uploaded",
            ],
            "Uploaded Acme provides clinical workflow automation for health systems.": [
              "source_uploaded",
            ],
            "The expansion may satisfy the saved revisit condition.": [
              "market_source_uploaded",
              "source_uploaded",
            ],
          },
        }];
      },
    },
    underwriting: {
      async createBatchAndSelections(input) {
        underwritingInput = input;
        return {
          id: "batch_uploaded",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"d".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("The process-run seam owns automatic processing.");
      },
    },
    now: () => NOW,
  });

  assert.equal(result.report.companyAnalyses.length, 1);
  assert.equal(result.report.companyAnalyses[0]?.dealId, "deal_uploaded");
  assert.equal(result.report.companyAnalyses[0]?.outcome, "belief_revised");
  assert.deepEqual(
    underwritingInput?.eligibleDeals.map(({ id }) => id),
    ["deal_uploaded"],
  );
  assert.equal(
    underwritingInput?.analyses[0]?.dealId,
    "deal_uploaded",
  );
});

test("keeps XTrace partial recall visible while underwriting receives every eligible Deal analysis", async () => {
  const { registry, sources } = await uploadedDealRegistry();
  await sources.createInitialRevision({
    id: "revision_seeded",
    workspaceId: "workspace_1",
    sourceId: "document_seeded",
    contentHash: `sha256:${"e".repeat(64)}`,
    objectKey: "private/seed/seeded-beta.md",
    objectVersion: "object:seeded-beta:v1",
    contentType: "text/markdown",
    extractorId: "plain_text_v1",
    extractorVersion: "1",
    extractedAt: "2026-07-29T10:02:00.000Z",
    createdAt: "2026-07-29T10:02:01.000Z",
  });
  await registry.confirmSourceAssignment({
    requestId: "confirm_seeded",
    workspaceId: "workspace_1",
    dealId: "deal_seeded",
    companyId: "company_seeded",
    companyName: "Seeded Beta",
    status: "watchlist",
    sourceRevisionId: "revision_seeded",
    assignedByUserId: "user_1",
    reason: "Seed fixture backfill confirmation.",
    confirmedAt: "2026-07-29T10:03:00.000Z",
    memoryBundle: {
      dealId: "deal_seeded",
      companyName: "Seeded Beta",
      status: "watchlist",
      facts: [{
        text: "Seeded Beta supports clinical operations.",
        sources: [{
          id: "source_seeded",
          provenance: "source_document",
          title: "Seeded Beta memo",
          documentId: "document_seeded",
          excerpt: "Seeded Beta supports clinical operations.",
        }],
      }],
      interactions: [],
    },
    memoryLineage: {
      evidence: {
        source_seeded: {
          workspaceId: "workspace_1",
          dealId: "deal_seeded",
          sourceId: "document_seeded",
          sourceRevisionId: "revision_seeded",
        },
      },
      interactions: {},
    },
  });
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => NOW,
  }));
  await runs.create({
    workspaceId: "workspace_1",
    mode: "xtrace",
    windowDays: 14,
  });
  const claimed = await runs.claimNext("worker_1");
  assert.ok(claimed);
  let underwritingAnalyses: CompanyAnalysis[] = [];

  const result = await processClaimedRun(claimed, {
    runs,
    intelligence: createMemoryIntelligenceRepository({ now: () => NOW }),
    dealRegistry: registry,
    importGate: { async assertReady() {} },
    market: {
      async scanMarketWindow() {
        return {
          status: "completed" as const,
          window: {
            from: "2026-07-15T12:00:00.000Z",
            to: NOW.toISOString(),
            days: 14 as const,
          },
          providers: [],
          events: [],
        };
      },
    },
    reasoner: {
      async reason(input) {
        assert.deepEqual(
          input.deals.map(({ id }) => id),
          ["deal_uploaded"],
        );
        return [];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No pending jobs expected.");
      },
      async recallDealContext(input) {
        const dealId = input.candidateDealIds[0];
        if (dealId === "deal_seeded") {
          throw new Error("XTrace recall unavailable");
        }
        return [{
          dealId: "deal_uploaded",
          memoryId: "memory_uploaded",
          memoryType: "semantic" as const,
          text: "Uploaded Acme historical source context.",
          score: 0.9,
          provenance: "source_document" as const,
          sourceIds: ["source_uploaded"],
          fixtureIds: [],
        }];
      },
    },
    underwriting: {
      async createBatchAndSelections(input) {
        underwritingAnalyses = input.analyses;
        return {
          id: "batch_xtrace_partial",
          workspaceId: "workspace_1",
          scanRunId: claimed.id,
          status: "completed",
          batchInputFingerprint: `sha256:${"f".repeat(64)}`,
          fundPolicySnapshotId: policy.id,
          rerunOfId: null,
          createdAt: NOW.toISOString(),
        };
      },
      async processCandidate() {
        throw new Error("No candidates are selected in this fixture.");
      },
    },
    now: () => NOW,
  });

  assert.equal(result.run.status, "partial");
  assert.equal(result.report.companyAnalyses.length, 2);
  assert.equal(result.report.counts.analysisUnavailable, 1);
  assert.equal(underwritingAnalyses.length, 2);
  assert.equal(
    underwritingAnalyses.find(({ dealId }) => dealId === "deal_seeded")
      ?.outcome,
    "analysis_unavailable",
  );
  assert.ok(result.run.warnings.some((warning) =>
    /XTrace recall was unavailable for 1 Deal/i.test(warning)
  ));
});

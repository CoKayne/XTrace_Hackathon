import { createHash, randomUUID } from "node:crypto";

import type {
  CandidateFinalization,
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type {
  RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type { RunRecord } from "../../db/client";
import type {
  IntelligenceReportRecord,
} from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../contracts/domain";
import {
  EvidencePackSchema,
  type Assumption,
  type EvidencePack,
  type Fact,
} from "../contracts/evidence";
import type {
  CandidateRun,
  FundPolicySnapshot,
  MissingEvidenceItem,
  ResolvedUnderwritingContext,
  UnderwritingBatch,
} from "../contracts/underwriting";
import {
  canonicalJson,
  createCandidateAnalysisFingerprint,
} from "./fingerprints";
import {
  createContextRouter,
  type ContextRouter,
} from "./router";
import { createValuationEngine } from "./valuation/service";
import type { ValuationEngine } from "./valuation/contracts";
import type { FrameworkLensService } from "./frameworks/service";
import {
  createDecisionEngine,
  type DecisionEngine,
} from "./decision/engine";
import { DECISION_POLICY_V1 } from "./decision/rules";
import { buildUnderwritingNarrative } from "./narrative";
import { createActionDraftGenerator } from "./action-drafts";
import {
  BALANCED_POLICY_VALUES,
} from "../../seed/underwriting/balanced-policy-v1";

const MAX_AUTOMATIC_CANDIDATES = 5;
const SELECTION_POLICY_VERSION = "top-five-belief-revised-v1";
const DEFAULT_CANDIDATE_TIMEOUT_MS = 30_000;
const DEFAULT_CANDIDATE_MAX_ATTEMPTS = 2;
const DEFAULT_CANDIDATE_LEASE_SECONDS = 120;
const DEFAULT_CANDIDATE_COST_UNITS = 5;
const ORCHESTRATOR_WORKER_ID = "underwriting-orchestrator-v1";

export interface CandidateExecutionBudget {
  timeoutMs: number;
  maxAttempts: number;
  maxCostUnits: number;
  maxConcurrency: 1;
}

export type CandidateFinalizationPayload = Omit<
  CandidateFinalization,
  "workerId" | "leaseToken" | "candidateRunId"
>;

export interface CandidateExecutorInput {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  fundPolicy: FundPolicySnapshot;
  batchInputFingerprint: string;
  workerId: string;
  leaseToken: string;
  budget: CandidateExecutionBudget;
  signal: AbortSignal;
}

interface PlannedCandidate {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  fundPolicy: FundPolicySnapshot;
  batchInputFingerprint: string;
}

export interface SyntheticCandidateExecutionSettings {
  providerModel: string;
  promptVersion: string;
  schemaVersion: string;
  settingsFingerprint: string;
  applicationCommit: string;
}

export interface UnderwritingOrchestrator {
  createBatchAndSelections(input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    forceRefresh: boolean;
  }): Promise<UnderwritingBatch>;
  processCandidate(candidateRunId: string): Promise<CandidateRun>;
}

export function createUnderwritingOrchestrator(options: {
  runs: UnderwritingRunsRepository;
  activeFundPolicy(
    workspaceId: string,
  ): Promise<FundPolicySnapshot>;
  autoProcessCandidates?: boolean;
  refreshNonce?: () => string;
  candidateExecutor?: (
    input: CandidateExecutorInput,
  ) => Promise<CandidateFinalization | CandidateFinalizationPayload>;
  candidateTimeoutMs?: number;
  candidateMaxAttempts?: number;
  candidateLeaseSeconds?: number;
  candidateCostUnits?: number;
  onWarning?: (warning: string) => void;
  now?: () => Date;
}): UnderwritingOrchestrator {
  const refreshNonce = options.refreshNonce ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const budget: CandidateExecutionBudget = {
    timeoutMs: positiveInteger(
      options.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS,
      "Candidate timeout",
    ),
    maxAttempts: positiveInteger(
      options.candidateMaxAttempts ?? DEFAULT_CANDIDATE_MAX_ATTEMPTS,
      "Candidate attempts",
    ),
    maxCostUnits: positiveInteger(
      options.candidateCostUnits ?? DEFAULT_CANDIDATE_COST_UNITS,
      "Candidate cost budget",
    ),
    maxConcurrency: 1,
  };
  const leaseSeconds = positiveInteger(
    options.candidateLeaseSeconds ?? DEFAULT_CANDIDATE_LEASE_SECONDS,
    "Candidate lease",
  );
  const plannedCandidates = new Map<string, PlannedCandidate>();

  const processCandidate = async (
    candidateRunId: string,
  ): Promise<CandidateRun> => {
    const planned = plannedCandidates.get(candidateRunId);
    if (!planned) {
      throw new Error(
        `Candidate ${candidateRunId} is outside this immutable orchestration snapshot.`,
      );
    }
    if (
      ["completed", "unavailable", "failed"].includes(
        planned.candidate.status,
      )
    ) {
      return planned.candidate;
    }
    const claimed = await options.runs.claimNextCandidate({
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseSeconds,
    });
    if (!claimed || claimed.candidate.id !== candidateRunId) {
      throw new Error(
        `Candidate ${candidateRunId} could not be claimed in deterministic rank order.`,
      );
    }
    if (!options.candidateExecutor) {
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason:
          "Candidate underwriting is unavailable because no executor is configured.",
      });
      return terminalCandidate(claimed.candidate, "failed", now());
    }

    let finalization:
      | CandidateFinalization
      | CandidateFinalizationPayload
      | undefined;
    for (let attempt = 1; attempt <= budget.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      try {
        finalization = await withTimeout(
          options.candidateExecutor({
            candidate: claimed.candidate,
            analysis: planned.analysis,
            deal: planned.deal,
            fundPolicy: planned.fundPolicy,
            batchInputFingerprint: planned.batchInputFingerprint,
            workerId: ORCHESTRATOR_WORKER_ID,
            leaseToken: claimed.leaseToken,
            budget,
            signal: controller.signal,
          }),
          budget.timeoutMs,
          controller,
        );
        break;
      } catch {}
    }
    if (!finalization) {
      await options.runs.saveCheckpoint({
        candidateRunId,
        stage: "finalization",
        status: "failed",
        artifactFingerprint: claimed.candidate.candidateAnalysisFingerprint,
        publicReason: "Candidate underwriting failed after bounded retries.",
        savedAt: now().toISOString(),
        workerId: ORCHESTRATOR_WORKER_ID,
        leaseToken: claimed.leaseToken,
      });
      await options.runs.markCandidateFailed({
        candidateRunId,
        publicReason: "Candidate underwriting failed after bounded retries.",
      });
      options.onWarning?.(
        `Candidate ${planned.deal.id} underwriting failed after ${budget.maxAttempts} bounded ${
          budget.maxAttempts === 1 ? "attempt" : "attempts"
        }; completed candidates remain available.`,
      );
      const failed = terminalCandidate(claimed.candidate, "failed", now());
      planned.candidate = failed;
      return failed;
    }
    const payload = {
      ...finalization,
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseToken: claimed.leaseToken,
      candidateRunId,
    };
    await options.runs.saveCheckpoint({
      candidateRunId,
      stage: "finalization",
      status: "completed",
      artifactFingerprint: payload.candidateAnalysisFingerprint,
      publicReason: null,
      savedAt: now().toISOString(),
      workerId: ORCHESTRATOR_WORKER_ID,
      leaseToken: claimed.leaseToken,
    });
    const completed = await options.runs.finalizeCandidate(payload);
    planned.candidate = completed;
    return completed;
  };

  return {
    async createBatchAndSelections(input) {
      const policy = await options.activeFundPolicy(
        input.scanRun.workspaceId,
      );
      assertAlignedInput(input, policy);
      const batchInputFingerprint = createOrchestrationFingerprint({
        ...input,
        policy,
      });
      const ordinaryBatch = await options.runs.createOrReuseBatch({
        workspaceId: input.scanRun.workspaceId,
        scanRunId: input.scanRun.id,
        batchInputFingerprint,
        fundPolicySnapshotId: policy.id,
        forceRefresh: false,
        refreshNonce: null,
        rerunOfId: null,
      });
      const batch = input.forceRefresh
        ? await options.runs.createOrReuseBatch({
            workspaceId: input.scanRun.workspaceId,
            scanRunId: input.scanRun.id,
            batchInputFingerprint,
            fundPolicySnapshotId: policy.id,
            forceRefresh: true,
            refreshNonce: refreshNonce(),
            rerunOfId: ordinaryBatch.id,
          })
        : ordinaryBatch;
      const qualified = qualifiedCandidates(input.analyses);
      const ranked = qualified.slice(0, MAX_AUTOMATIC_CANDIDATES);
      const truncatedDealIds = new Set(
        qualified.slice(MAX_AUTOMATIC_CANDIDATES)
          .map(({ dealId }) => dealId),
      );
      const ranks = new Map(
        ranked.map((analysis, index) => [
          analysis.dealId,
          index + 1,
        ]),
      );
      await options.runs.saveSelections({
        batchId: batch.id,
        selections: input.eligibleDeals.map((deal) => {
          const rank = ranks.get(deal.id) ?? null;
          return rank === null
            ? {
                dealId: deal.id,
                status: "not_selected" as const,
                rank: null,
                reason: truncatedDealIds.has(deal.id)
                  ? "Truncation warning: candidate exceeded the automatic Top-5 budget; this is not negative evidence or a Pass decision."
                  : "Not selected by the medium/high belief-revised eligibility policy; this is not a Pass decision.",
              }
            : {
                dealId: deal.id,
                status: "selected" as const,
                rank,
                reason:
                  `Selected at rank ${rank} by ${SELECTION_POLICY_VERSION}.`,
              };
        }),
      });
      const candidates = await options.runs.createSelectedCandidates({
        batchId: batch.id,
        dealIds: ranked.map(({ dealId }) => dealId),
      });
      const analysesByDeal = new Map(
        input.analyses.map((analysis) => [analysis.dealId, analysis]),
      );
      const dealsById = new Map(
        input.eligibleDeals.map((deal) => [deal.id, deal]),
      );
      for (const candidate of candidates) {
        plannedCandidates.set(candidate.id, {
          candidate,
          analysis: analysesByDeal.get(candidate.dealId)!,
          deal: dealsById.get(candidate.dealId)!,
          fundPolicy: policy,
          batchInputFingerprint,
        });
      }
      if (options.autoProcessCandidates !== false) {
        const processed: CandidateRun[] = [];
        for (const candidate of candidates) {
          processed.push(await processCandidate(candidate.id));
        }
        return {
          ...batch,
          status: statusForCandidates(processed),
        };
      }
      return batch;
    },

    processCandidate,
  };
}

/**
 * Executes the current product-owned synthetic framework pack through the
 * Task 11 lens service seam. Task 11b can replace that provider without
 * changing orchestration, deterministic valuation, or finalization.
 */
export function createSyntheticCandidateExecutor(options: {
  frameworkLenses: FrameworkLensService;
  router?: ContextRouter;
  valuation?: ValuationEngine;
  decision?: DecisionEngine;
  execution: SyntheticCandidateExecutionSettings;
  now?: () => Date;
}): (
  input: CandidateExecutorInput,
) => Promise<CandidateFinalizationPayload> {
  const router = options.router ?? createContextRouter();
  const valuation = options.valuation ?? createValuationEngine({
    now: options.now,
  });
  const decision = options.decision ?? createDecisionEngine();
  const now = options.now ?? (() => new Date());
  const execution = normalizedExecution(options.execution);

  return async (input) => {
    if (input.signal.aborted) {
      throw new Error("Candidate execution was cancelled before it started.");
    }
    const sourceRevisionId = input.deal.activeSourceRevisionIds[0];
    const dealFingerprint = input.deal.activeSourceRevisionFingerprint;
    if (!sourceRevisionId || !dealFingerprint) {
      throw new Error(
        "Candidate execution requires an immutable active Deal revision.",
      );
    }
    const asOfDate = input.analysis.createdAt.slice(0, 10);
    const companyFact = companyIdentityFact({
      analysis: input.analysis,
      sourceRevisionId,
    });
    const resolution = router.resolve({
      asOfDate,
      companyIdentity: [{
        value: input.deal.companyId,
        basis: "confirmed",
        evidenceItemId: companyFact.id,
      }],
      stage: [derivedRouterValue("seed", companyFact.id)],
      businessModel: [
        derivedRouterValue("b2b_saas", companyFact.id),
      ],
      geography: [derivedRouterValue("us", companyFact.id)],
      securityType: [
        derivedRouterValue("preferred", companyFact.id),
      ],
    });
    if (resolution.kind !== "resolved" || !resolution.context) {
      throw new Error(
        "Candidate context could not be uniquely resolved for this vertical slice.",
      );
    }
    const context = resolution.context;
    const missingFieldIds = [
      "reported_valuation",
      "reported_valuation_basis",
      "arr",
      "customer_evidence",
      "cash",
      "burn",
      "runway",
    ];
    const packSeed = {
      workspaceId: input.candidate.workspaceId,
      dealId: input.candidate.dealId,
      asOfDate,
      sourceRevisionIds: [...input.deal.activeSourceRevisionIds]
        .sort(compareUtf8),
      facts: [companyFact],
      assumptions: candidateAssumptions(context),
      conflicts: [],
      coverage: {
        minimumModelInputsComplete: true,
        criticalEvidenceComplete: false,
        missingFieldIds,
        blockingConflictIds: [],
        decisionCeiling: "Advance" as const,
        underwritingStatus: "available" as const,
        reasonCodes: ["MISSING_CRITICAL_EVIDENCE"],
      },
    };
    const evidenceFingerprint = fingerprint(packSeed);
    const pack: EvidencePack = EvidencePackSchema.parse({
      id: `evidence_pack:${evidenceFingerprint.slice("sha256:".length)}`,
      version: 1,
      ...packSeed,
      createdAt: now().toISOString(),
    });
    const valuationArtifacts = valuation.evaluateDetailed({
      pack,
      context,
      fundPolicy: input.fundPolicy,
    });
    const scenarioModel = {
      ...valuationArtifacts.scenarioModel,
      id: `scenario-model:${input.candidate.id}`,
      candidateRunId: input.candidate.id,
    };
    const lensResult = await options.frameworkLenses.runAll({
      candidate: input.candidate,
      pack,
      context,
      calculations: valuationArtifacts.calculations,
    });
    if (input.signal.aborted) {
      throw new Error("Candidate execution exceeded its stage budget.");
    }
    const formalDecision = decision.decide({
      pack,
      coverage: pack.coverage,
      judgments: lensResult.judgments,
      valuation: valuationArtifacts.evaluation,
      fundPolicy: input.fundPolicy,
      context,
      decisionPolicy: DECISION_POLICY_V1,
    });
    const narrative = buildUnderwritingNarrative({
      facts: pack.facts,
      assumptions: pack.assumptions,
      calculations: valuationArtifacts.calculations,
      judgments: lensResult.judgments,
      disagreements: lensResult.disagreements,
      decision: formalDecision,
    });
    const missingEvidence = missingFieldIds.map<MissingEvidenceItem>(
      (fieldId) => ({
        fieldId,
        label: fieldId.replaceAll("_", " "),
        reasonCode: "MISSING_CRITICAL_EVIDENCE",
        mostLikelyDecisionImpact:
          "Providing accepted evidence may raise or lower the formal decision ceiling.",
      }),
    );
    const actionDrafts = createActionDraftGenerator({
      workspaceId: input.candidate.workspaceId,
      now,
    }).generate({
      candidateRunId: input.candidate.id,
      decision: formalDecision,
      missingEvidence,
      recommendedNextSteps: [
        "Review source-backed missing evidence with the investment team.",
        "Request exact round terms and operating metrics from the founder.",
      ],
    });
    const formulaVersions = [
      ...new Set(
        valuationArtifacts.calculations.map(
          ({ formulaId, formulaVersion }) =>
            `${formulaId}@${formulaVersion}`,
        ),
      ),
    ].sort(compareUtf8);
    const candidateAnalysisFingerprint = createCandidateAnalysisFingerprint({
      workspaceId: input.candidate.workspaceId,
      batchInputFingerprint: input.batchInputFingerprint,
      dealRevision: {
        dealId: input.deal.id,
        status: input.deal.status,
        sourceRevisionIds: input.deal.activeSourceRevisionIds,
        fingerprint: dealFingerprint,
      },
      evidencePack: {
        id: pack.id,
        version: pack.version,
        sourceRevisionIds: pack.sourceRevisionIds,
        fingerprint: evidenceFingerprint,
      },
      evidenceSourceIds: input.analysis.sources.map(({ id }) => id),
      context: {
        id: context.id,
        contextVersion: context.contextVersion,
        criticalEvidenceProfileId: context.criticalEvidenceProfileId,
        benchmarkPackId: context.benchmarkPackId,
        valuationMethodPolicyId: context.valuationMethodPolicyId,
        frameworkPackId: context.frameworkPackId,
        decisionPolicyId: context.decisionPolicyId,
      },
      criticalEvidenceProfile: {
        id: context.criticalEvidenceProfileId,
        version: "1",
      },
      benchmarkPack: context.benchmarkPackId
        ? { id: context.benchmarkPackId, version: "1" }
        : null,
      valuationMethodPolicy: {
        id: context.valuationMethodPolicyId,
        version: "1",
      },
      formulaVersions,
      providerModel: execution.providerModel,
      promptVersion: execution.promptVersion,
      schemaVersion: execution.schemaVersion,
      settingsFingerprint: execution.settingsFingerprint,
      applicationCommit: execution.applicationCommit,
    });

    return {
      candidateAnalysisFingerprint,
      evidencePack: pack,
      context,
      scenarioModel,
      calculations: valuationArtifacts.calculations,
      calculationClaimEdges:
        valuationArtifacts.calculationClaimEdges,
      judgments: lensResult.judgments,
      disagreements: lensResult.disagreements,
      valuation: valuationArtifacts.evaluation,
      decision: formalDecision,
      narrative,
      actionDrafts,
      versionSnapshot: {
        fundPolicyId: input.fundPolicy.id,
        benchmarkPackId: context.benchmarkPackId,
        frameworkPackId: context.frameworkPackId,
        routerVersion: "context-router-v1",
        criticalEvidenceProfileId: context.criticalEvidenceProfileId,
        valuationMethodPolicyId: context.valuationMethodPolicyId,
        decisionPolicyId: context.decisionPolicyId,
        formulaVersions,
        providerModel: execution.providerModel,
        promptVersion: execution.promptVersion,
        schemaVersion: execution.schemaVersion,
        settingsFingerprint: execution.settingsFingerprint,
        applicationCommit: execution.applicationCommit,
      },
    };
  };
}

function qualifiedCandidates(
  analyses: CompanyAnalysis[],
): CompanyAnalysis[] {
  return analyses
    .filter((analysis) =>
      analysis.outcome === "belief_revised"
      && (analysis.confidence === "medium"
        || analysis.confidence === "high")
    )
    .sort((left, right) =>
      right.score - left.score
      || compareUtf8(left.dealId, right.dealId)
    );
}

function createOrchestrationFingerprint(
  input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
    policy: FundPolicySnapshot;
  },
): string {
  const value = canonicalJson({
    kind: "underwriting-orchestration-v1",
    workspaceId: input.scanRun.workspaceId,
    windowDays: input.scanRun.windowDays,
    market: {
      summary: input.report.marketSummary,
      coverage: input.report.evidenceCoverage,
      opportunities: input.report.opportunities,
    },
    eligibleDealRevisions: input.eligibleDeals.map((deal) => ({
      dealId: deal.id,
      status: deal.status,
      sourceRevisionIds: [...deal.activeSourceRevisionIds].sort(compareUtf8),
      fingerprint: deal.activeSourceRevisionFingerprint,
    })).sort((left, right) => compareUtf8(left.dealId, right.dealId)),
    analyses: input.analyses.map((analysis) => ({
      dealId: analysis.dealId,
      outcome: analysis.outcome,
      confidence: analysis.confidence,
      score: analysis.score,
      sourceIds: analysis.sources.map(({ id }) => id).sort(compareUtf8),
      memoryIds: [...analysis.investmentMemory.memoryIds].sort(compareUtf8),
      xtraceSourceIds: [...analysis.investmentMemory.sourceIds]
        .sort(compareUtf8),
      fixtureIds: [...analysis.investmentMemory.fixtureIds]
        .sort(compareUtf8),
    })).sort((left, right) => compareUtf8(left.dealId, right.dealId)),
    fundPolicy: input.policy,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
  });
  return `sha256:${
    createHash("sha256").update(value, "utf8").digest("hex")
  }`;
}

function assertAlignedInput(
  input: {
    scanRun: RunRecord;
    report: IntelligenceReportRecord;
    analyses: CompanyAnalysis[];
    eligibleDeals: RegisteredDeal[];
  },
  policy: FundPolicySnapshot,
): void {
  const workspaceId = input.scanRun.workspaceId;
  if (
    input.report.workspaceId !== workspaceId
    || input.report.runId !== input.scanRun.id
    || policy.workspaceId !== workspaceId
    || input.eligibleDeals.some((deal) => deal.workspaceId !== workspaceId)
  ) {
    throw new Error(
      "Underwriting batch inputs must share one workspace and scan run.",
    );
  }
  const analysisIds = input.analyses.map(({ dealId }) => dealId);
  const eligibleIds = input.eligibleDeals.map(({ id }) => id);
  if (
    new Set(analysisIds).size !== analysisIds.length
    || new Set(eligibleIds).size !== eligibleIds.length
    || analysisIds.length !== eligibleIds.length
    || eligibleIds.some((dealId) => !analysisIds.includes(dealId))
  ) {
    throw new Error(
      "Every eligible Deal must retain exactly one CompanyAnalysis before underwriting selection.",
    );
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Candidate stage budget expired."));
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    return await Promise.race([operation, expired]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function terminalCandidate(
  candidate: CandidateRun,
  status: "failed" | "unavailable",
  now: Date,
): CandidateRun {
  return {
    ...candidate,
    status,
    finalizedAt: now.toISOString(),
  };
}

function statusForCandidates(
  candidates: CandidateRun[],
): UnderwritingBatch["status"] {
  if (candidates.length === 0) return "completed";
  if (candidates.every(({ status }) => status === "completed")) {
    return "completed";
  }
  if (
    candidates.every(({ status }) =>
      status === "failed" || status === "unavailable"
    )
  ) {
    return "failed";
  }
  if (
    candidates.every(({ status }) =>
      ["completed", "failed", "unavailable"].includes(status)
    )
  ) {
    return "partial";
  }
  return "running";
}

function companyIdentityFact(input: {
  analysis: CompanyAnalysis;
  sourceRevisionId: string;
}): Fact {
  const source = input.analysis.sources[0];
  const excerpt = source?.excerpt?.trim() || input.analysis.companyName;
  return {
    id: `fact:${input.analysis.dealId}:company_identity`,
    analysisType: "fact",
    provenanceOrigin: source?.provenance === "public_web"
      ? "public_source"
      : "uploaded_document",
    field: "company_identity",
    value: input.analysis.companyName,
    unit: null,
    currency: null,
    periodStart: null,
    periodEnd: null,
    publishedAt: source?.publishedAt ?? null,
    eventAt: null,
    retrievedAt: input.analysis.createdAt,
    sourceRevisionId: input.sourceRevisionId,
    locator: source?.provenance === "public_web" && source.url
      ? {
          kind: "web_snapshot",
          url: source.url,
          excerpt,
        }
      : {
          kind: "text_range",
          start: 0,
          end: Math.max(1, excerpt.length),
          excerpt,
        },
    sourceRole: source?.provenance === "public_web"
      ? "independent_third_party"
      : "management",
    assertionStatus: "reported",
    verificationMethod: null,
    freshness: "current",
    acceptedForGate: true,
  };
}

function candidateAssumptions(
  context: ResolvedUnderwritingContext,
): Assumption[] {
  const assumptions: Assumption[] = [];
  if (context.benchmarkPackId) {
    assumptions.push(
      {
        id: `assumption:${context.id}:compatible_benchmark_value`,
        analysisType: "assumption",
        provenanceOrigin: "benchmark",
        scenario: "all",
        field: "compatible_benchmark_value",
        value: context.stage === "seed" ? "24000000" : "80000000",
        unit: "USD",
        rationale:
          "Published Slice-1 benchmark selected by the immutable candidate context.",
        inputRefIds: [context.benchmarkPackId],
        sensitivity: "high",
        requiresConfirmation: false,
      },
      {
        id: `assumption:${context.id}:compatible_benchmark_stale_after`,
        analysisType: "assumption",
        provenanceOrigin: "benchmark",
        scenario: "all",
        field: "compatible_benchmark_stale_after",
        value: "2027-01-25",
        unit: "date",
        rationale:
          "Expiry date published with the immutable Slice-1 benchmark pack.",
        inputRefIds: [context.benchmarkPackId],
        sensitivity: "high",
        requiresConfirmation: false,
      },
    );
  }
  for (const scenario of ["bear", "base", "bull"] as const) {
    assumptions.push({
      id: `assumption:${context.id}:scenario_price_multiplier:${scenario}`,
      analysisType: "assumption",
      provenanceOrigin: "recommended_policy",
      scenario,
      field: "scenario_price_multiplier",
      value: BALANCED_POLICY_VALUES.scenarioPriceMultipliers[scenario],
      unit: "decimal",
      rationale:
        "Balanced recommended policy multiplier for the valuation scenario.",
      inputRefIds: [BALANCED_POLICY_VALUES.id],
      sensitivity: "high",
      requiresConfirmation: false,
    });
  }
  return assumptions;
}

function derivedRouterValue(value: string, evidenceItemId: string) {
  return {
    value,
    basis: "derived" as const,
    evidenceItemId,
  };
}

function normalizedExecution(
  input: SyntheticCandidateExecutionSettings,
): SyntheticCandidateExecutionSettings {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (!value || value.trim() !== value) {
        throw new Error(
          `Synthetic candidate execution ${key} must be normalized.`,
        );
      }
      return [key, value];
    }),
  ) as unknown as SyntheticCandidateExecutionSettings;
}

function fingerprint(value: unknown): string {
  return `sha256:${
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
  }`;
}

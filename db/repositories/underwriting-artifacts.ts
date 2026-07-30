import { z } from "zod";

import {
  CalculationSchema,
  ClaimEdgeSchema,
  EvidencePackSchema,
  type Calculation,
  type ClaimEdge,
  type EvidencePack,
} from "../../lib/contracts/evidence";
import {
  ActionDraftSchema,
  DecisionResultSchema,
  FrameworkDisagreementSchema,
  FrameworkJudgmentSchema,
  ResolvedUnderwritingContextSchema,
  ScenarioModelSchema,
  ValuationEvaluationSchema,
  type ActionDraft,
  type DecisionResult,
  type FrameworkDisagreement,
  type FrameworkJudgment,
  type ResolvedUnderwritingContext,
  type ScenarioModel,
  type ValuationEvaluation,
} from "../../lib/contracts/underwriting";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";

const IdSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "IDs cannot have surrounding whitespace",
);
const FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const CandidateVersionSnapshotSchema = z.strictObject({
  fundPolicyId: IdSchema,
  benchmarkPackId: IdSchema.nullable(),
  benchmarkEntryId: IdSchema.nullable(),
  benchmarkDefinitionFingerprint: FingerprintSchema.nullable(),
  frameworkPackId: IdSchema,
  frameworkPackDefinitionFingerprint: FingerprintSchema,
  routerVersion: z.string().min(1),
  criticalEvidenceProfileId: IdSchema,
  criticalEvidenceProfileDefinitionFingerprint: FingerprintSchema,
  valuationMethodPolicyId: IdSchema,
  valuationMethodPolicyDefinitionFingerprint: FingerprintSchema,
  decisionPolicyId: IdSchema,
  decisionPolicyDefinitionFingerprint: FingerprintSchema,
  referenceCatalogFingerprint: FingerprintSchema,
  formulaVersions: z.array(z.string().min(1)),
  providerModel: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  settingsFingerprint: z.string().min(1),
  applicationCommit: z.string().min(1),
}).superRefine((value, context) => {
  const benchmarkValues = [
    value.benchmarkPackId,
    value.benchmarkEntryId,
    value.benchmarkDefinitionFingerprint,
  ];
  if (
    benchmarkValues.some((item) => item === null)
      !== benchmarkValues.every((item) => item === null)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Benchmark pack, entry, and definition fingerprint must be pinned together.",
    });
  }
});

export type CandidateVersionSnapshot = z.infer<
  typeof CandidateVersionSnapshotSchema
>;

export interface CandidateFinalization {
  workerId: string;
  leaseToken: string;
  candidateRunId: string;
  candidateAnalysisFingerprint: string;
  evidencePack: EvidencePack;
  context: ResolvedUnderwritingContext;
  scenarioModel: ScenarioModel;
  calculations: Calculation[];
  calculationClaimEdges: ClaimEdge[];
  judgments: FrameworkJudgment[];
  disagreements: FrameworkDisagreement[];
  valuation: ValuationEvaluation;
  decision: DecisionResult;
  narrative: string;
  actionDrafts: ActionDraft[];
  versionSnapshot: CandidateVersionSnapshot;
}

export interface CandidateArtifactBundle
  extends Omit<
    CandidateFinalization,
    "workerId" | "leaseToken" | "candidateRunId"
  > {
  candidateRunId: string;
  workspaceId: string;
  dealId: string;
  claimEdges: ClaimEdge[];
}

export interface ReusableCandidateArtifacts {
  candidateRunId: string;
  workspaceId: string;
  dealId: string;
  candidateAnalysisFingerprint: string;
}

export interface ArtifactRowCounts {
  evidencePacks: number;
  contexts: number;
  scenarioModels: number;
  calculations: number;
  judgments: number;
  disagreements: number;
  valuations: number;
  decisions: number;
  narratives: number;
  actionDrafts: number;
  claimEdges: number;
  versionSnapshots: number;
}

export interface UnderwritingArtifactsRepository {
  findReusable(input: {
    workspaceId: string;
    candidateAnalysisFingerprint: string;
  }): Promise<ReusableCandidateArtifacts | null>;
  getByCandidateRunId(input: {
    workspaceId: string;
    candidateRunId: string;
  }): Promise<CandidateArtifactBundle | null>;
}

export interface MemoryUnderwritingArtifactsRepository
  extends UnderwritingArtifactsRepository {
  prepareFinalization(input: {
    candidate: {
      id: string;
      workspaceId: string;
      dealId: string;
      fundPolicySnapshotId: string;
    };
    finalization: CandidateFinalization;
  }): CandidateArtifactBundle;
  commitPrepared(bundle: CandidateArtifactBundle): void;
  aliasCandidate(input: {
    workspaceId: string;
    candidateRunId: string;
    sourceCandidateRunId: string;
    dealId: string;
    candidateAnalysisFingerprint: string;
  }): void;
  inspect(): {
    bundles: CandidateArtifactBundle[];
    rowCounts: ArtifactRowCounts;
  };
}

export function createMemoryUnderwritingArtifactsRepository():
  MemoryUnderwritingArtifactsRepository {
  const bundles = new Map<string, CandidateArtifactBundle>();
  const reusable = new Map<string, ReusableCandidateArtifacts>();
  const aliases = new Map<string, string>();

  return {
    async findReusable(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateAnalysisFingerprint = requiredText(
        input.candidateAnalysisFingerprint,
        "A candidate analysis fingerprint",
      );
      const value = reusable.get(
        identity(workspaceId, candidateAnalysisFingerprint),
      );
      return value ? structuredClone(value) : null;
    },

    async getByCandidateRunId(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const candidateKey = identity(workspaceId, candidateRunId);
      const artifactCandidateRunId = aliases.get(candidateKey)
        ?? candidateRunId;
      const value = bundles.get(identity(
        workspaceId,
        artifactCandidateRunId,
      ));
      return value ? structuredClone(value) : null;
    },

    prepareFinalization({ candidate, finalization }) {
      return validateFinalization(candidate, finalization);
    },

    commitPrepared(bundle) {
      const key = identity(bundle.workspaceId, bundle.candidateRunId);
      if (bundles.has(key)) {
        throw new Error("Candidate artifacts are immutable once finalized.");
      }
      const reuseKey = identity(
        bundle.workspaceId,
        bundle.candidateAnalysisFingerprint,
      );
      if (reusable.has(reuseKey)) {
        throw new Error(
          "This candidate analysis fingerprint is already finalized.",
        );
      }
      const saved = structuredClone(bundle);
      bundles.set(key, saved);
      reusable.set(reuseKey, {
        candidateRunId: saved.candidateRunId,
        workspaceId: saved.workspaceId,
        dealId: saved.dealId,
        candidateAnalysisFingerprint: saved.candidateAnalysisFingerprint,
      });
    },

    aliasCandidate(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const sourceCandidateRunId = requiredText(
        input.sourceCandidateRunId,
        "A source candidate run",
      );
      const candidateKey = identity(workspaceId, candidateRunId);
      if (bundles.has(candidateKey) || aliases.has(candidateKey)) {
        throw new Error("Candidate artifacts are immutable once finalized.");
      }
      const source = bundles.get(identity(workspaceId, sourceCandidateRunId));
      if (
        !source
        || source.dealId !== requiredText(input.dealId, "A Deal")
        || source.candidateAnalysisFingerprint
          !== requiredText(
            input.candidateAnalysisFingerprint,
            "A candidate analysis fingerprint",
          )
      ) {
        throw new Error(
          "Reusable candidate artifacts do not match the immutable rerun.",
        );
      }
      aliases.set(candidateKey, sourceCandidateRunId);
    },

    inspect() {
      const values = [...bundles.values()].map((bundle) =>
        structuredClone(bundle)
      );
      return {
        bundles: values,
        rowCounts: values.reduce<ArtifactRowCounts>(
          (counts, bundle) => ({
            evidencePacks: counts.evidencePacks + 1,
            contexts: counts.contexts + 1,
            scenarioModels: counts.scenarioModels + 1,
            calculations: counts.calculations + bundle.calculations.length,
            judgments: counts.judgments + bundle.judgments.length,
            disagreements:
              counts.disagreements + bundle.disagreements.length,
            valuations: counts.valuations + 1,
            decisions: counts.decisions + 1,
            narratives: counts.narratives + 1,
            actionDrafts: counts.actionDrafts + bundle.actionDrafts.length,
            claimEdges: counts.claimEdges + bundle.claimEdges.length,
            versionSnapshots: counts.versionSnapshots + 1,
          }),
          emptyRowCounts(),
        ),
      };
    },
  };
}

export function createSupabaseUnderwritingArtifactsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): UnderwritingArtifactsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function request(pathname: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        headers,
        cache: "no-store",
      });
    } catch {
      throw new IntegrationTransportError({ retryable: true });
    }
    if (!response.ok) {
      throw new IntegrationTransportError({
        retryable: isRetryableTransportStatus(response.status),
      });
    }
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }

  async function rows(
    table: string,
    workspaceId: string,
    candidateRunId: string,
    extra = "",
  ): Promise<Array<Record<string, unknown>>> {
    return await request(
      `/${table}?workspace_id=eq.${encodeURIComponent(workspaceId)}`
        + `&candidate_run_id=eq.${encodeURIComponent(candidateRunId)}`
        + extra,
    ) as Array<Record<string, unknown>>;
  }

  return {
    async findReusable(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const fingerprint = requiredText(
        input.candidateAnalysisFingerprint,
        "A candidate analysis fingerprint",
      );
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        candidate_analysis_fingerprint: `eq.${fingerprint}`,
        status: "eq.completed",
        artifact_source_candidate_run_id: "is.null",
        select:
          "id,workspace_id,deal_id,candidate_analysis_fingerprint",
        limit: "1",
      });
      const values = await request(`/candidate_runs?${query}`) as Array<
        Record<string, unknown>
      >;
      const value = values[0];
      return value
        ? {
          candidateRunId: String(value.id),
          workspaceId: String(value.workspace_id),
          dealId: String(value.deal_id),
          candidateAnalysisFingerprint: String(
            value.candidate_analysis_fingerprint,
          ),
        }
        : null;
    },

    async getByCandidateRunId(input) {
      const workspaceId = requiredText(input.workspaceId, "A workspace");
      const candidateRunId = requiredText(
        input.candidateRunId,
        "A candidate run",
      );
      const candidateQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${candidateRunId}`,
        status: "eq.completed",
        select:
          "id,batch_id,workspace_id,deal_id,candidate_analysis_fingerprint,artifact_source_candidate_run_id",
        limit: "1",
      });
      const candidates = await request(
        `/candidate_runs?${candidateQuery}`,
      ) as Array<Record<string, unknown>>;
      const candidate = candidates[0];
      if (!candidate) return null;
      const artifactCandidateRunId =
        typeof candidate.artifact_source_candidate_run_id === "string"
          ? candidate.artifact_source_candidate_run_id
          : candidateRunId;
      const batchQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        id: `eq.${String(candidate.batch_id)}`,
        select: "fund_policy_snapshot_id",
        limit: "1",
      });
      const batchRows = await request(
        `/underwriting_batches?${batchQuery}`,
      ) as Array<Record<string, unknown>>;
      if (!batchRows[0]) {
        throw new Error(
          "Completed candidate artifacts are missing their pinned Fund Policy.",
        );
      }

      const [
        evidenceRows,
        contextRows,
        scenarioRows,
        calculationRows,
        judgmentRows,
        disagreementRows,
        valuationRows,
        decisionRows,
        narrativeRows,
        draftRows,
        edgeRows,
        versionRows,
      ] = await Promise.all([
        rows(
          "evidence_packs",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "candidate_context_snapshots",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "scenario_models",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "underwriting_calculations",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "framework_judgment_artifacts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "framework_disagreement_artifacts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "valuation_evaluations",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "final_syntheses",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "underwriting_narratives",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
        rows(
          "action_drafts",
          workspaceId,
          artifactCandidateRunId,
          "&order=artifact_id.asc",
        ),
        rows(
          "underwriting_claim_edges",
          workspaceId,
          artifactCandidateRunId,
          "&order=claim_item_id.asc,dependency_type.asc,dependency_item_id.asc",
        ),
        rows(
          "candidate_version_snapshots",
          workspaceId,
          artifactCandidateRunId,
          "&limit=1",
        ),
      ]);
      if (
        !evidenceRows[0]
        || !contextRows[0]
        || !scenarioRows[0]
        || !valuationRows[0]
        || !decisionRows[0]
        || !narrativeRows[0]
        || !versionRows[0]
      ) {
        throw new Error(
          "Completed candidate artifacts are incomplete or inconsistent.",
        );
      }
      const persistedEdges = edgeRows.map((row) =>
        ClaimEdgeSchema.parse({
          claimItemId: row.claim_item_id,
          dependencyItemId: row.dependency_item_id,
          dependencyType: row.dependency_type,
        })
      );
      const persistedCalculationIds = new Set(
        calculationRows.map((row) => String(row.artifact_id)),
      );
      const calculationClaimEdges = persistedEdges.filter((edge) =>
        edge.dependencyType === "calculation"
        && persistedCalculationIds.has(edge.claimItemId)
        && persistedCalculationIds.has(edge.dependencyItemId)
      );
      const prepared = validateFinalization(
        {
          id: artifactCandidateRunId,
          workspaceId,
          dealId: String(candidate.deal_id),
          fundPolicySnapshotId: String(
            batchRows[0].fund_policy_snapshot_id,
          ),
        },
        {
          workerId: "persisted",
          leaseToken: "persisted",
          candidateRunId: artifactCandidateRunId,
          candidateAnalysisFingerprint: String(
            candidate.candidate_analysis_fingerprint,
          ),
          evidencePack: evidenceRows[0].payload as EvidencePack,
          context: contextRows[0].payload as ResolvedUnderwritingContext,
          scenarioModel: scenarioRows[0].payload as ScenarioModel,
          calculations: calculationRows.map((row) =>
            row.payload as Calculation
          ),
          calculationClaimEdges,
          judgments: judgmentRows.map((row) =>
            row.payload as FrameworkJudgment
          ),
          disagreements: disagreementRows.map((row) =>
            row.payload as FrameworkDisagreement
          ),
          valuation: valuationRows[0].payload as ValuationEvaluation,
          decision: decisionRows[0].payload as DecisionResult,
          narrative: String(narrativeRows[0].body),
          actionDrafts: draftRows.map((row) => row.payload as ActionDraft),
          versionSnapshot:
            versionRows[0].payload as CandidateVersionSnapshot,
        },
      );
      if (
        JSON.stringify(sortedClaimEdges(persistedEdges))
          !== JSON.stringify(sortedClaimEdges(prepared.claimEdges))
      ) {
        throw new Error(
          "Persisted candidate claim edges do not match artifact claims.",
        );
      }
      return prepared;
    },
  };
}

function validateFinalization(
  candidate: {
    id: string;
    workspaceId: string;
    dealId: string;
    fundPolicySnapshotId: string;
  },
  input: CandidateFinalization,
): CandidateArtifactBundle {
  const candidateRunId = requiredText(input.candidateRunId, "A candidate run");
  const workspaceId = requiredText(candidate.workspaceId, "A workspace");
  const dealId = requiredText(candidate.dealId, "A Deal");
  if (candidate.id !== candidateRunId) {
    throw new Error("Finalization candidate identity does not match.");
  }
  const evidencePack = EvidencePackSchema.parse(input.evidencePack);
  const context = ResolvedUnderwritingContextSchema.parse(input.context);
  const scenarioModel = ScenarioModelSchema.parse(input.scenarioModel);
  const calculations = input.calculations.map((value) =>
    CalculationSchema.parse(value)
  );
  const calculationClaimEdges = input.calculationClaimEdges.map((value) =>
    ClaimEdgeSchema.parse(value)
  );
  const judgments = input.judgments.map((value) =>
    FrameworkJudgmentSchema.parse(value)
  );
  const disagreements = input.disagreements.map((value) =>
    FrameworkDisagreementSchema.parse(value)
  );
  const valuation = ValuationEvaluationSchema.parse(input.valuation);
  const decision = DecisionResultSchema.parse(input.decision);
  const actionDrafts = input.actionDrafts.map((value) =>
    ActionDraftSchema.parse(value)
  );
  const versionSnapshot = CandidateVersionSnapshotSchema.parse(
    input.versionSnapshot,
  );
  const narrative = requiredText(input.narrative, "A narrative");
  const candidateAnalysisFingerprint = requiredText(
    input.candidateAnalysisFingerprint,
    "A candidate analysis fingerprint",
  );

  if (
    evidencePack.workspaceId !== workspaceId
    || evidencePack.dealId !== dealId
    || scenarioModel.candidateRunId !== candidateRunId
    || actionDrafts.some((draft) =>
      draft.workspaceId !== workspaceId
      || draft.candidateRunId !== candidateRunId
    )
  ) {
    throw new Error(
      "Every finalized artifact must match the candidate workspace and identity.",
    );
  }
  if (
    context.criticalEvidenceProfileId
      !== versionSnapshot.criticalEvidenceProfileId
    || context.benchmarkPackId !== versionSnapshot.benchmarkPackId
    || context.valuationMethodPolicyId
      !== versionSnapshot.valuationMethodPolicyId
    || context.decisionPolicyId !== versionSnapshot.decisionPolicyId
    || context.frameworkPackId !== versionSnapshot.frameworkPackId
    || candidate.fundPolicySnapshotId !== versionSnapshot.fundPolicyId
  ) {
    throw new Error(
      "The candidate version snapshot must match the resolved context.",
    );
  }

  assertUnique(calculations.map(({ id }) => id), "Calculation");
  assertUnique(judgments.map(({ id }) => id), "Framework judgment");
  assertUnique(disagreements.map(({ id }) => id), "Framework disagreement");
  assertUnique(actionDrafts.map(({ id }) => id), "Action draft");

  const calculationIds = new Set(calculations.map(({ id }) => id));
  if (
    valuation.calculationIds.some((id) => !calculationIds.has(id))
    || valuation.scenarios.some((scenario) =>
      scenario.calculationIds.some((id) => !calculationIds.has(id))
    )
  ) {
    throw new Error(
      "Valuation calculation references must resolve to saved calculations.",
    );
  }
  const judgmentIds = new Set(judgments.map(({ id }) => id));
  if (
    disagreements.some((value) =>
      !judgmentIds.has(value.leftJudgmentId)
      || !judgmentIds.has(value.rightJudgmentId)
    )
  ) {
    throw new Error(
      "Framework disagreements must reference saved judgments.",
    );
  }

  const evidenceIds = new Set([
    ...evidencePack.facts.map(({ id }) => id),
    ...evidencePack.assumptions.map(({ id }) => id),
  ]);
  const factIds = new Set(evidencePack.facts.map(({ id }) => id));
  const assumptionIds = new Set(
    evidencePack.assumptions.map(({ id }) => id),
  );
  const policyIds = new Set([
    versionSnapshot.fundPolicyId,
    versionSnapshot.criticalEvidenceProfileId,
    versionSnapshot.valuationMethodPolicyId,
    versionSnapshot.decisionPolicyId,
  ]);
  const benchmarkIds = new Set(
    versionSnapshot.benchmarkPackId
      ? [versionSnapshot.benchmarkPackId]
      : [],
  );
  const calculationPolicyIds = new Set([
    ...policyIds,
    "policy:initialCheckMax",
    "policy:acceptableFutureDilution",
    `policy:returnTargets.${context.stage}.grossMoic`,
    `policy:returnTargets.${context.stage}.horizonYears`,
  ]);
  const benchmarkAssumptions = new Map(
    evidencePack.assumptions
      .filter((assumption) =>
        assumption.provenanceOrigin === "benchmark"
        && assumption.inputRefIds.length === 1
        && assumption.inputRefIds[0] === versionSnapshot.benchmarkPackId
      )
      .map((assumption) => [assumption.id, assumption]),
  );
  const frameworkIds = new Set([
    versionSnapshot.frameworkPackId,
    ...judgments.map(({ frameworkCardId }) => frameworkCardId),
  ]);
  if (
    judgments.some((judgment) =>
      [
        ...judgment.supportEvidenceItemIds,
        ...judgment.counterEvidenceItemIds,
        ...judgment.unusedEvidenceItemIds,
      ].some((id) => !evidenceIds.has(id) && !calculationIds.has(id))
    )
    || decision.blockingEvidenceItemIds.some((id) => !evidenceIds.has(id))
  ) {
    throw new Error(
      "Judgment and decision evidence references must resolve to saved artifacts.",
    );
  }

  const claimEdges = [
    ...calculationClaimEdges,
    ...judgments.flatMap((judgment) => judgment.claimEdges),
    ...decision.claimEdges,
  ].map((edge) => ClaimEdgeSchema.parse(edge));
  assertUnique(
    claimEdges.map((edge) =>
      `${edge.claimItemId}\u0000${edge.dependencyType}\u0000${edge.dependencyItemId}`
    ),
    "Claim edge",
  );
  const dependencySets: Record<ClaimEdge["dependencyType"], Set<string>> = {
    fact: factIds,
    assumption: assumptionIds,
    calculation: calculationIds,
    framework_judgment: judgmentIds,
    policy_ref: policyIds,
    benchmark_ref: benchmarkIds,
    framework_ref: frameworkIds,
  };
  if (
    calculationClaimEdges.some((edge) =>
      edge.dependencyType !== "calculation"
      || !calculationIds.has(edge.claimItemId)
      || !calculationIds.has(edge.dependencyItemId)
    )
  ) {
    throw new Error(
      "Calculation claim edges must connect two saved calculations.",
    );
  }
  if (
    claimEdges.some((edge) =>
      !dependencySets[edge.dependencyType].has(edge.dependencyItemId)
    )
  ) {
    throw new Error(
      "Every typed claim dependency must resolve to a persisted artifact or version reference.",
    );
  }
  if (
    calculations.some((calculation) =>
      calculation.inputRefs.some((reference) => {
        const dependencies = reference.type === "fact"
          ? factIds
          : reference.type === "assumption"
          ? assumptionIds
          : reference.type === "policy"
          ? calculationPolicyIds
          : null;
        if (dependencies) return !dependencies.has(reference.itemId);
        const benchmarkAssumption = benchmarkAssumptions.get(reference.itemId);
        return !benchmarkAssumption
          || benchmarkAssumption.value !== reference.value;
      })
    )
  ) {
    throw new Error(
      "Every calculation input must resolve to persisted evidence or a version reference.",
    );
  }

  return {
    candidateRunId,
    workspaceId,
    dealId,
    candidateAnalysisFingerprint,
    evidencePack,
    context,
    scenarioModel,
    calculations,
    calculationClaimEdges,
    judgments,
    disagreements,
    valuation,
    decision,
    narrative,
    actionDrafts,
    versionSnapshot,
    claimEdges,
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} identities must be unique.`);
  }
}

function sortedClaimEdges(edges: ClaimEdge[]): ClaimEdge[] {
  return [...edges].sort((left, right) =>
    `${left.claimItemId}\u0000${left.dependencyType}\u0000${left.dependencyItemId}`
      .localeCompare(
        `${right.claimItemId}\u0000${right.dependencyType}\u0000${right.dependencyItemId}`,
      )
  );
}

function emptyRowCounts(): ArtifactRowCounts {
  return {
    evidencePacks: 0,
    contexts: 0,
    scenarioModels: 0,
    calculations: 0,
    judgments: 0,
    disagreements: 0,
    valuations: 0,
    decisions: 0,
    narratives: 0,
    actionDrafts: 0,
    claimEdges: 0,
    versionSnapshots: 0,
  };
}

function identity(workspaceId: string, id: string): string {
  return `${workspaceId.length}:${workspaceId}${id.length}:${id}`;
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}

import {
  CandidateVersionSnapshotSchema,
  type CandidateArtifactBundle,
  type CandidateVersionSnapshot,
  type UnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import type {
  UnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";
import type {
  ClaimEdge,
  Fact,
} from "../contracts/evidence";
import type {
  ActionDraft,
  CandidateRun,
  UnderwritingBatch,
} from "../contracts/underwriting";
import { evidenceQueryTokens } from "../demo/search";

export type DealUnderwritingStatus =
  | "not_selected"
  | CandidateRun["status"];

export interface DealUnderwritingSelectionView {
  dealId: string;
  underwritingStatus: DealUnderwritingStatus;
  rank: number | null;
  candidateRunId: string | null;
  decision: CandidateArtifactBundle["decision"]["decision"];
}

export interface UnderwritingBatchSummary {
  batchId: string;
  status: UnderwritingBatch["status"];
  selections: DealUnderwritingSelectionView[];
}

export interface PublicActionDraft {
  id: string;
  candidateRunId: string;
  channel: ActionDraft["channel"];
  audienceType: ActionDraft["audienceType"];
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const PublicCandidateVersionSnapshotSchema =
  CandidateVersionSnapshotSchema;
export type PublicCandidateVersionSnapshot = CandidateVersionSnapshot;

export interface UnderwritingSearchResult {
  itemId: string;
  candidateRunId: string;
  dealId: string;
  analysisType:
    | "fact"
    | "assumption"
    | "calculation"
    | "framework_judgment"
    | "final_synthesis";
  text: string;
  sourceRevisionIds: string[];
  claimEdges: ClaimEdge[];
}

export async function buildUnderwritingBatchSummary(input: {
  workspaceId: string;
  scanRunId: string;
  runs: UnderwritingRunsRepository;
  artifacts: UnderwritingArtifactsRepository;
}): Promise<UnderwritingBatchSummary | null> {
  const batch = await input.runs.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.scanRunId,
  });
  if (!batch) return null;
  const [selections, candidates] = await Promise.all([
    input.runs.listSelectionsForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
    input.runs.listCandidatesForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
  ]);
  const candidatesByDeal = new Map(
    candidates.map((candidate) => [candidate.dealId, candidate]),
  );
  const decisions = new Map<string, CandidateArtifactBundle["decision"]["decision"]>();
  await Promise.all(candidates.map(async (candidate) => {
    if (!["completed", "partial"].includes(candidate.status)) return;
    const bundle = await input.artifacts.getByCandidateRunId({
      workspaceId: input.workspaceId,
      candidateRunId: candidate.id,
    });
    if (bundle) decisions.set(candidate.id, bundle.decision.decision);
  }));
  return {
    batchId: batch.id,
    status: batch.status,
    selections: selections.map((selection) => {
      if (selection.status === "not_selected") {
        return {
          dealId: selection.dealId,
          underwritingStatus: "not_selected" as const,
          rank: null,
          candidateRunId: null,
          decision: null,
        };
      }
      const candidate = candidatesByDeal.get(selection.dealId);
      return {
        dealId: selection.dealId,
        underwritingStatus: candidate?.status ?? "queued",
        rank: selection.rank,
        candidateRunId: candidate?.id ?? null,
        decision: candidate ? decisions.get(candidate.id) ?? null : null,
      };
    }),
  };
}

export async function findCandidateForReportDeal(input: {
  workspaceId: string;
  scanRunId: string;
  dealId: string;
  runs: UnderwritingRunsRepository;
}): Promise<CandidateRun | null> {
  const batch = await input.runs.getBatchByScanRunId({
    workspaceId: input.workspaceId,
    scanRunId: input.scanRunId,
  });
  if (!batch) return null;
  const [selection, candidates] = await Promise.all([
    input.runs.listSelectionsForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }).then((values) =>
      values.find((value) =>
        value.dealId === input.dealId && value.status === "selected"
      )
    ),
    input.runs.listCandidatesForBatch({
      workspaceId: input.workspaceId,
      batchId: batch.id,
    }),
  ]);
  if (!selection) return null;
  return candidates.find((candidate) =>
    candidate.dealId === input.dealId
  ) ?? null;
}

export function toCandidateUnderwritingDetail(
  bundle: CandidateArtifactBundle,
) {
  return {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
    evidencePack: structuredClone(bundle.evidencePack),
    context: structuredClone(bundle.context),
    scenarioModel: structuredClone(bundle.scenarioModel),
    calculations: structuredClone(bundle.calculations),
    judgments: structuredClone(bundle.judgments),
    disagreements: structuredClone(bundle.disagreements),
    valuation: structuredClone(bundle.valuation),
    decision: structuredClone(bundle.decision),
    narrative: bundle.narrative,
    claimEdges: structuredClone(bundle.claimEdges),
    sourceRevisionIds: [...bundle.evidencePack.sourceRevisionIds],
    versionSnapshot: toPublicVersionSnapshot(bundle.versionSnapshot),
  };
}

export function toPublicActionDraft(draft: ActionDraft): PublicActionDraft {
  return {
    id: draft.id,
    candidateRunId: draft.candidateRunId,
    channel: draft.channel,
    audienceType: draft.audienceType,
    body: draft.body,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export async function searchPersistedUnderwriting(input: {
  workspaceId: string;
  query: string;
  artifacts: UnderwritingArtifactsRepository;
}): Promise<UnderwritingSearchResult[]> {
  const tokens = evidenceQueryTokens(input.query);
  if (tokens.length === 0) return [];
  const bundles = await input.artifacts.listFinalizedForWorkspace({
    workspaceId: input.workspaceId,
  });
  return bundles
    .flatMap(searchItemsForBundle)
    .filter((item) => {
      const searchable = new Set(evidenceQueryTokens(item.text));
      return tokens.every((token) => searchable.has(token));
    })
    .sort((left, right) =>
      left.dealId.localeCompare(right.dealId)
      || left.analysisType.localeCompare(right.analysisType)
      || left.itemId.localeCompare(right.itemId)
    )
    .slice(0, 50);
}

function searchItemsForBundle(
  bundle: CandidateArtifactBundle,
): UnderwritingSearchResult[] {
  const facts = new Map(bundle.evidencePack.facts.map((fact) => [fact.id, fact]));
  const edges = bundle.claimEdges;
  const common = {
    candidateRunId: bundle.candidateRunId,
    dealId: bundle.dealId,
  };
  return [
    ...bundle.evidencePack.facts.map((fact) => ({
      ...common,
      itemId: fact.id,
      analysisType: "fact" as const,
      text: `${fact.field}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`,
      sourceRevisionIds: [fact.sourceRevisionId],
      claimEdges: [],
    })),
    ...bundle.evidencePack.assumptions.map((assumption) => ({
      ...common,
      itemId: assumption.id,
      analysisType: "assumption" as const,
      text: `${assumption.field}: ${assumption.value}. ${assumption.rationale}`,
      sourceRevisionIds: [],
      claimEdges: [] as ClaimEdge[],
    })),
    ...bundle.calculations.map((calculation) => {
      const itemEdges = edges.filter((edge) =>
        edge.claimItemId === calculation.id
      );
      return {
        ...common,
        itemId: calculation.id,
        analysisType: "calculation" as const,
        text:
          `${calculation.formulaId}: ${calculation.output} ${calculation.unit}`,
        sourceRevisionIds: sourceRevisionIdsForClaim({
          claimItemId: calculation.id,
          facts,
          edges,
        }),
        claimEdges: structuredClone(itemEdges),
      };
    }),
    ...bundle.judgments.map((judgment) => ({
      ...common,
      itemId: judgment.id,
      analysisType: "framework_judgment" as const,
      text: [
        judgment.frameworkCardId,
        judgment.conclusion,
        judgment.strongestSupport,
        judgment.strongestCounterargument,
        ...judgment.unknowns,
        ...judgment.limitations,
      ].filter(Boolean).join(". "),
      sourceRevisionIds: sourceRevisionIdsForClaim({
        claimItemId: judgment.id,
        facts,
        edges,
      }),
      claimEdges: structuredClone(judgment.claimEdges),
    })),
    {
      ...common,
      itemId: bundle.decision.id,
      analysisType: "final_synthesis" as const,
      text: [
        bundle.decision.decision,
        bundle.decision.companyQuality,
        bundle.decision.priceAttractiveness,
        bundle.decision.fundFit,
        bundle.narrative,
      ].filter(Boolean).join(". "),
      sourceRevisionIds: sourceRevisionIdsForClaim({
        claimItemId: bundle.decision.id,
        facts,
        edges,
      }),
      claimEdges: structuredClone(bundle.decision.claimEdges),
    },
  ];
}

function sourceRevisionIdsForClaim(input: {
  claimItemId: string;
  facts: Map<string, Fact>;
  edges: ClaimEdge[];
}): string[] {
  const pending = [input.claimItemId];
  const visited = new Set<string>();
  const revisionIds = new Set<string>();
  while (pending.length > 0) {
    const claimItemId = pending.pop()!;
    if (visited.has(claimItemId)) continue;
    visited.add(claimItemId);
    const directFact = input.facts.get(claimItemId);
    if (directFact) revisionIds.add(directFact.sourceRevisionId);
    for (const edge of input.edges) {
      if (edge.claimItemId !== claimItemId) continue;
      const fact = input.facts.get(edge.dependencyItemId);
      if (fact) revisionIds.add(fact.sourceRevisionId);
      else pending.push(edge.dependencyItemId);
    }
  }
  return [...revisionIds].sort();
}

function toPublicVersionSnapshot(
  snapshot: CandidateVersionSnapshot,
): PublicCandidateVersionSnapshot {
  return PublicCandidateVersionSnapshotSchema.parse(structuredClone(snapshot));
}

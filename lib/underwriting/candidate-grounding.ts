import type {
  EvidencePacksRepository,
  SourceEvidenceInput,
} from "../../db/repositories/evidence-packs";
import {
  sourceRevisionFingerprint,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import type {
  SourceRegistry,
  SourceRevision,
} from "../../db/repositories/source-registry";
import type {
  XTraceLineageRepository,
} from "../../db/repositories/xtrace-lineage";
import type { CompanyAnalysis } from "../contracts/domain";
import {
  SourceRevisionSchema,
  type EvidencePack,
} from "../contracts/evidence";
import type {
  CandidateRun,
  FundPolicySnapshot,
  ResolvedUnderwritingContext,
  XTraceLineageSnapshot,
} from "../contracts/underwriting";
import {
  type EvidencePackBuilder,
  type SelectedBenchmarkInput,
} from "./evidence/builder";
import { normalizeSourceEvidence } from "./evidence/normalization";
import type {
  CandidateIdentityEvidence,
  CriticalEvidenceProfile,
  RouterEvidenceValue,
} from "./router";
import type {
  ReferenceDefinitionRef,
} from "./fingerprints";

export interface CandidateGroundingSnapshot {
  identityEvidence: CandidateIdentityEvidence;
  sourceRevisionIds: string[];
  sourceRevisionSnapshots: SourceRevision[];
  xtraceLineage: XTraceLineageSnapshot;
}

export interface GroundedEvidencePack {
  pack: EvidencePack;
  criticalEvidenceProfile: ReferenceDefinitionRef;
  benchmark: SelectedBenchmarkInput | null;
}

export interface CandidateGroundingPort {
  load(input: {
    candidate: CandidateRun;
    analysis: CompanyAnalysis;
    deal: RegisteredDeal;
    signal: AbortSignal;
  }): Promise<CandidateGroundingSnapshot>;
  buildEvidencePack(input: {
    candidate: CandidateRun;
    analysis: CompanyAnalysis;
    deal: RegisteredDeal;
    context: ResolvedUnderwritingContext;
    fundPolicy: FundPolicySnapshot;
    snapshot: CandidateGroundingSnapshot;
    signal: AbortSignal;
  }): Promise<GroundedEvidencePack>;
}

export function createEvidencePackCandidateGrounding(options: {
  repository: EvidencePacksRepository;
  sourceRegistry: SourceRegistry;
  builder: EvidencePackBuilder;
  criticalEvidenceProfiles: CriticalEvidenceProfile[];
  xtraceLineage?: Pick<XTraceLineageRepository, "resolve">;
  resolveBenchmark(
    context: ResolvedUnderwritingContext,
  ): Promise<SelectedBenchmarkInput | null>;
}): CandidateGroundingPort {
  const criticalEvidenceProfiles = new Map(
    options.criticalEvidenceProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    async load({ candidate, analysis, deal, signal }) {
      throwIfAborted(signal);
      assertCandidateIdentity({ candidate, analysis, deal });
      const sourceRevisionIds = uniqueSorted(deal.activeSourceRevisionIds);
      if (
        sourceRevisionIds.length === 0
        || deal.activeSourceRevisionFingerprint
          !== sourceRevisionFingerprint(sourceRevisionIds)
      ) {
        throw new CandidateGroundingUnavailableError([
          "ACTIVE_SOURCE_REVISION_SET_INVALID",
        ]);
      }
      const sourceRevisionSnapshots: SourceRevision[] = [];
      for (const revisionId of sourceRevisionIds) {
        const revision = await options.sourceRegistry.getRevision({
          workspaceId: candidate.workspaceId,
          revisionId,
        });
        if (!revision) {
          throw new CandidateGroundingUnavailableError([
            "ACTIVE_SOURCE_REVISION_UNAVAILABLE",
          ]);
        }
        sourceRevisionSnapshots.push(canonicalSourceRevision(revision));
      }
      const sourceEvidence = await options.repository.listSourceEvidence({
        workspaceId: candidate.workspaceId,
        dealId: candidate.dealId,
        sourceRevisionIds,
      });
      throwIfAborted(signal);
      const identityEvidence = candidateIdentityEvidence({
        analysis,
        deal,
        sourceEvidence,
      });
      const xtraceLineage = await resolveXTraceLineage({
        analysis,
        deal,
        sourceEvidence,
        sourceRevisionSnapshots,
        repository: options.xtraceLineage,
        capturedAt: analysis.createdAt,
      });
      return {
        identityEvidence,
        sourceRevisionIds,
        sourceRevisionSnapshots: [...sourceRevisionSnapshots]
          .sort((left, right) => compareUtf8(left.id, right.id)),
        xtraceLineage,
      };
    },

    async buildEvidencePack(input) {
      throwIfAborted(input.signal);
      const criticalEvidenceProfile = criticalEvidenceProfiles.get(
        input.context.criticalEvidenceProfileId,
      );
      if (
        !criticalEvidenceProfile
        || criticalEvidenceProfile.publicationStatus !== "published"
      ) {
        throw new CandidateGroundingUnavailableError([
          "CRITICAL_EVIDENCE_PROFILE_UNAVAILABLE",
        ]);
      }
      const benchmark = await options.resolveBenchmark(input.context);
      throwIfAborted(input.signal);
      if (
        input.context.benchmarkPackId
        && ["exact", "broad_compatible"].includes(
          input.context.benchmarkCompatibility,
        )
        && !benchmark
      ) {
        throw new CandidateGroundingUnavailableError([
          "SELECTED_BENCHMARK_UNAVAILABLE",
        ]);
      }
      const pack = await options.builder.build({
        workspaceId: input.candidate.workspaceId,
        dealId: input.candidate.dealId,
        asOfDate: input.context.asOfDate,
        sourceRevisionIds: input.snapshot.sourceRevisionIds,
        xtraceLineage: input.snapshot.xtraceLineage,
        context: input.context,
        fundPolicy: input.fundPolicy,
        benchmark,
      });
      return {
        pack,
        criticalEvidenceProfile: {
          kind: "critical_evidence_profile",
          id: criticalEvidenceProfile.id,
          version: criticalEvidenceProfile.version,
          definitionFingerprint:
            criticalEvidenceProfile.definitionFingerprint,
        },
        benchmark,
      };
    },
  };
}

export class CandidateGroundingUnavailableError extends Error {
  readonly reasonCodes: string[];

  constructor(reasonCodes: string[]) {
    super("Candidate source grounding is unavailable.");
    this.name = "CandidateGroundingUnavailableError";
    this.reasonCodes = uniqueSorted(reasonCodes);
  }
}

function candidateIdentityEvidence(input: {
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  sourceEvidence: SourceEvidenceInput[];
}): CandidateIdentityEvidence {
  const values = new Map<string, RouterEvidenceValue[]>();
  for (const source of input.sourceEvidence) {
    const fact = normalizeSourceEvidence(source);
    if (
      !fact.acceptedForGate
      || fact.assertionStatus === "disputed"
      || fact.freshness === "stale"
    ) {
      continue;
    }
    const value = fact.value.trim().toLowerCase();
    const item: RouterEvidenceValue = {
      value,
      basis: "source_explicit",
      evidenceItemId: fact.id,
    };
    const existing = values.get(fact.field) ?? [];
    existing.push(item);
    values.set(fact.field, existing);
  }
  const explicitCompany = values.get("company_identity") ?? [];
  const confirmedCompany: RouterEvidenceValue = {
    value: input.deal.companyId,
    basis: "confirmed",
    evidenceItemId: `deal-confirmation:${input.deal.id}`,
  };
  if (
    explicitCompany.some(({ value }) =>
      !sameCompanyIdentity(value, input.deal)
    )
  ) {
    throw new CandidateGroundingUnavailableError([
      "COMPANY_IDENTITY_CONFLICT",
    ]);
  }
  return {
    asOfDate: input.analysis.createdAt.slice(0, 10),
    companyIdentity: [confirmedCompany, ...explicitCompany],
    stage: values.get("stage") ?? [],
    businessModel: values.get("business_model") ?? [],
    geography: values.get("geography") ?? [],
    securityType: values.get("security_type") ?? [],
  };
}

async function resolveXTraceLineage(input: {
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
  sourceEvidence: SourceEvidenceInput[];
  sourceRevisionSnapshots: SourceRevision[];
  repository?: Pick<XTraceLineageRepository, "resolve">;
  capturedAt: string;
}): Promise<XTraceLineageSnapshot> {
  const memoryIds = uniqueSorted(input.analysis.investmentMemory.memoryIds);
  if (memoryIds.length === 0) {
    return {
      memoryIds: [],
      sourceRevisionIds: [],
      sourceIds: [],
      fixtureIds: [],
      capturedAt: input.capturedAt,
    };
  }
  if (!input.repository) {
    throw new CandidateGroundingUnavailableError([
      "XTRACE_LINEAGE_UNAVAILABLE",
    ]);
  }
  const evidenceById = new Map(
    input.sourceEvidence.map((evidence) => [evidence.id, evidence]),
  );
  const revisionsById = new Map(
    input.sourceRevisionSnapshots.map((revision) => [revision.id, revision]),
  );
  const sourceRevisionIds = new Set<string>();
  const sourceIds = new Set<string>();
  const fixtureIds = new Set<string>();
  for (const memoryId of memoryIds) {
    const lineage = await input.repository.resolve({
      memoryId,
      workspaceId: input.deal.workspaceId,
      convId: `deal:${input.deal.id}`,
    });
    if (
      !lineage
      || lineage.workspaceId !== input.deal.workspaceId
      || lineage.dealId !== input.deal.id
    ) {
      throw new CandidateGroundingUnavailableError([
        "XTRACE_LINEAGE_UNRESOLVED",
      ]);
    }
    for (const evidenceId of lineage.sourceIds) {
      const evidence = evidenceById.get(evidenceId);
      const revision = evidence
        ? revisionsById.get(evidence.sourceRevisionId)
        : undefined;
      if (!evidence || !revision) {
        throw new CandidateGroundingUnavailableError([
          "XTRACE_SOURCE_LINEAGE_MISMATCH",
        ]);
      }
      sourceRevisionIds.add(revision.id);
      sourceIds.add(revision.sourceId);
    }
    for (const fixtureId of lineage.fixtureIds) fixtureIds.add(fixtureId);
  }
  if (sourceRevisionIds.size === 0) {
    throw new CandidateGroundingUnavailableError([
      "XTRACE_SOURCE_LINEAGE_MISSING",
    ]);
  }
  return {
    memoryIds,
    sourceRevisionIds: uniqueSorted([...sourceRevisionIds]),
    sourceIds: uniqueSorted([...sourceIds]),
    fixtureIds: uniqueSorted([...fixtureIds]),
    capturedAt: input.capturedAt,
  };
}

function assertCandidateIdentity(input: {
  candidate: CandidateRun;
  analysis: CompanyAnalysis;
  deal: RegisteredDeal;
}): void {
  if (
    input.candidate.workspaceId !== input.deal.workspaceId
    || input.candidate.dealId !== input.deal.id
    || input.analysis.dealId !== input.deal.id
    || input.analysis.companyName !== input.deal.companyName
  ) {
    throw new CandidateGroundingUnavailableError([
      "CANDIDATE_IDENTITY_MISMATCH",
    ]);
  }
}

function sameCompanyIdentity(value: string, deal: RegisteredDeal): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === deal.companyId.toLowerCase()
    || normalized === deal.companyName.toLowerCase();
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Candidate grounding was cancelled.");
  }
}

function canonicalSourceRevision(
  revision: SourceRevision,
): SourceRevision {
  const parsed = SourceRevisionSchema.parse(revision);
  return SourceRevisionSchema.parse({
    ...parsed,
    extractedAt: new Date(parsed.extractedAt).toISOString(),
    createdAt: new Date(parsed.createdAt).toISOString(),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

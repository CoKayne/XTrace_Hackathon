import {
  DealMemoryBundleSchema,
  DealStatusSchema,
  type DealMemoryBundle,
  type DealStatus,
} from "../../lib/contracts/domain";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import type {
  SourceRegistry,
  SourceRevision,
} from "./source-registry";
import {
  createMemorySourceRegistry,
  getSourceRegistry,
} from "./source-registry";

export interface RegisteredDeal {
  id: string;
  workspaceId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
  analysisEligibleAt: string | null;
  activeSourceRevisionFingerprint: string | null;
  activeSourceRevisionIds: string[];
}

export interface ConfirmSourceAssignmentInput {
  requestId: string;
  workspaceId: string;
  dealId: string;
  companyId: string;
  companyName: string;
  status: DealStatus;
  sourceRevisionId: string;
  assignedByUserId: string;
  reason: string;
  confirmedAt: string;
  memoryBundle?: DealMemoryBundle;
  memoryLineage?: DealMemoryLineage;
}

export interface DealMemoryOwnership {
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
}

export interface DealMemoryLineage {
  evidence: Record<string, DealMemoryOwnership>;
  interactions: Record<string, DealMemoryOwnership>;
}

export interface ExactSourceMemoryBundle extends DealMemoryOwnership {
  bundle: DealMemoryBundle;
}

export interface DealSourceAssignment {
  id: string;
  requestId: string;
  requestFingerprint: string;
  workspaceId: string;
  dealId: string;
  sourceId: string;
  sourceRevisionId: string;
  assignedByUserId: string;
  reason: string;
  createdAt: string;
  supersededAt: string | null;
}

export interface DealRegistry {
  getAnalysisEligibleSnapshot(
    workspaceId: string,
  ): Promise<AnalysisEligibleSnapshot>;
  listAnalysisEligibleBundles(workspaceId: string): Promise<DealMemoryBundle[]>;
  getExactSourceBundle(input: DealMemoryOwnership): Promise<
    ExactSourceMemoryBundle | null
  >;
  findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null>;
  listForWorkspace(workspaceId: string): Promise<RegisteredDeal[]>;
  confirmSourceAssignment(
    input: ConfirmSourceAssignmentInput,
  ): Promise<{
    deal: RegisteredDeal;
    sourceRevision: SourceRevision;
    newlyEligible: boolean;
  }>;
}

export interface AnalysisEligibleSnapshot {
  count: number;
  dealIds: string[];
  fingerprint: string;
}

export interface MemoryDealRegistry extends DealRegistry {
  captureAtomicState(): unknown;
  restoreAtomicState(state: unknown): void;
  usesSourceRegistry(registry: SourceRegistry): boolean;
  inspect(): {
    deals: RegisteredDeal[];
    assignments: DealSourceAssignment[];
    externalEffects: string[];
  };
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredWorkspaceId(workspaceId: string): string {
  return requiredText(workspaceId, "A workspace");
}

function identity(workspaceId: string, externalId: string): string {
  return JSON.stringify([requiredWorkspaceId(workspaceId), externalId]);
}

function requiredIsoDateTime(value: string, label: string): string {
  const normalized = requiredText(value, label);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return new Date(normalized).toISOString();
}

function validateConfirmation(
  input: ConfirmSourceAssignmentInput,
): ConfirmSourceAssignmentInput {
  const candidate = {
    ...input,
    requestId: requiredText(input.requestId, "A confirmation request id"),
    workspaceId: requiredWorkspaceId(input.workspaceId),
    dealId: requiredText(input.dealId, "A Deal id"),
    companyId: requiredText(input.companyId, "A company id"),
    companyName: requiredText(input.companyName, "A company name"),
    status: DealStatusSchema.parse(input.status),
    sourceRevisionId: requiredText(
      input.sourceRevisionId,
      "A source revision id",
    ),
    assignedByUserId: requiredText(
      input.assignedByUserId,
      "An assigning user id",
    ),
    reason: requiredText(input.reason, "An assignment reason"),
    confirmedAt: requiredIsoDateTime(
      input.confirmedAt,
      "A confirmation time",
    ),
  };
  if (candidate.memoryBundle) {
    const memoryBundle = DealMemoryBundleSchema.parse(candidate.memoryBundle);
    if (
      memoryBundle.dealId !== candidate.dealId
      || memoryBundle.companyName !== candidate.companyName
      || memoryBundle.status !== candidate.status
    ) {
      throw new Error(
        "The Deal memory bundle must match the confirmed Deal identity.",
      );
    }
    candidate.memoryBundle = memoryBundle;
  }
  return candidate;
}

function validateMemoryOwnership(
  input: DealMemoryOwnership,
): DealMemoryOwnership {
  return {
    workspaceId: requiredWorkspaceId(input.workspaceId),
    dealId: requiredText(input.dealId, "A Deal id"),
    sourceId: requiredText(input.sourceId, "A source id"),
    sourceRevisionId: requiredText(
      input.sourceRevisionId,
      "A source revision id",
    ),
  };
}

function exactSourceIdentity(input: DealMemoryOwnership): string {
  return JSON.stringify([
    input.workspaceId,
    input.dealId,
    input.sourceId,
    input.sourceRevisionId,
  ]);
}

function exactSourceBundlesFromConfirmation(
  bundle: DealMemoryBundle,
  lineage: DealMemoryLineage,
): ExactSourceMemoryBundle[] {
  const grouped = new Map<string, {
    ownership: DealMemoryOwnership;
    facts: DealMemoryBundle["facts"];
    interactions: DealMemoryBundle["interactions"];
  }>();
  const groupFor = (ownership: DealMemoryOwnership) => {
    const normalized = validateMemoryOwnership(ownership);
    const key = exactSourceIdentity(normalized);
    const existing = grouped.get(key);
    if (existing) return existing;
    const created = {
      ownership: normalized,
      facts: [],
      interactions: [],
    };
    grouped.set(key, created);
    return created;
  };
  for (const fact of bundle.facts) {
    const sourcesByOwner = new Map<string, typeof fact.sources>();
    for (const source of fact.sources) {
      const ownership = lineage.evidence[source.id];
      if (!ownership) continue;
      const key = exactSourceIdentity(validateMemoryOwnership(ownership));
      const sources = sourcesByOwner.get(key) ?? [];
      sources.push(structuredClone(source));
      sourcesByOwner.set(key, sources);
    }
    for (const [key, sources] of sourcesByOwner) {
      const ownership = lineage.evidence[sources[0].id];
      const group = grouped.get(key) ?? groupFor(ownership);
      group.facts.push({ ...structuredClone(fact), sources });
    }
  }
  for (const interaction of bundle.interactions) {
    const ownership = lineage.interactions[interaction.id];
    if (ownership) {
      groupFor(ownership).interactions.push(structuredClone(interaction));
    }
  }
  return [...grouped.values()].map((group) => ({
    ...group.ownership,
    bundle: DealMemoryBundleSchema.parse({
      ...bundle,
      facts: group.facts,
      interactions: group.interactions,
    }),
  }));
}

function replaceMap<T>(
  target: Map<string, T>,
  entries: Array<[string, T]>,
): void {
  target.clear();
  for (const [key, value] of entries) {
    target.set(key, structuredClone(value));
  }
}

export function sourceRevisionFingerprint(
  revisionIds: readonly string[],
): string {
  const sorted = [...new Set(revisionIds)].sort(compareUtf8);
  return sha256(lengthFrame(["source-revisions-v2", ...sorted]));
}

export function eligibleDealSnapshotFingerprint(
  deals: readonly RegisteredDeal[],
): string {
  const frames = deals
    .map((deal) => [
      deal.id,
      deal.status,
      deal.activeSourceRevisionFingerprint ?? "",
    ] as const)
    .sort((left, right) => compareUtf8(left[0], right[0]))
    .flatMap((pair) => pair);
  return sha256(lengthFrame(["eligible-deals-v2", ...frames]));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function lengthFrame(values: readonly string[]): string {
  return values.map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
    .join("");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function confirmationFingerprint(
  input: ConfirmSourceAssignmentInput,
): string {
  return sha256(lengthFrame([
    "confirmation-request-v1",
    input.workspaceId,
    input.dealId,
    input.companyId,
    input.companyName,
    input.status,
    input.sourceRevisionId,
    input.assignedByUserId,
    input.reason,
    input.confirmedAt,
  ]));
}

function cloneDeal(deal: RegisteredDeal): RegisteredDeal {
  return structuredClone(deal);
}

export function createMemoryDealRegistry(options: {
  sourceRegistry?: SourceRegistry;
} = {}): MemoryDealRegistry {
  const sourceRegistry = options.sourceRegistry ?? createMemorySourceRegistry();
  const deals = new Map<string, RegisteredDeal>();
  const companies = new Map<string, { id: string; name: string }>();
  const bundles = new Map<string, DealMemoryBundle>();
  const bundleLineage = new Map<string, DealMemoryLineage>();
  const exactSourceBundles = new Map<string, ExactSourceMemoryBundle>();
  const assignments: DealSourceAssignment[] = [];
  const requestAssignments = new Map<string, DealSourceAssignment>();
  const externalEffects: string[] = [];
  let assignmentSequence = 0;

  async function findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null> {
    const workspaceId = requiredWorkspaceId(input.workspaceId);
    const dealId = requiredText(input.dealId, "A Deal id");
    const deal = deals.get(identity(workspaceId, dealId));
    return deal ? cloneDeal(deal) : null;
  }

  return {
    captureAtomicState() {
      return {
        deals: structuredClone([...deals.entries()]),
        companies: structuredClone([...companies.entries()]),
        bundles: structuredClone([...bundles.entries()]),
        bundleLineage: structuredClone([...bundleLineage.entries()]),
        exactSourceBundles: structuredClone([
          ...exactSourceBundles.entries(),
        ]),
        assignments: structuredClone(assignments),
        requestAssignments: [...requestAssignments.entries()].map(
          ([key, assignment]) => [key, assignment.id] as const,
        ),
        externalEffects: structuredClone(externalEffects),
        assignmentSequence,
      };
    },

    restoreAtomicState(rawState) {
      const state = rawState as {
        deals: Array<[string, RegisteredDeal]>;
        companies: Array<[string, { id: string; name: string }]>;
        bundles: Array<[string, DealMemoryBundle]>;
        bundleLineage: Array<[string, DealMemoryLineage]>;
        exactSourceBundles: Array<[string, ExactSourceMemoryBundle]>;
        assignments: DealSourceAssignment[];
        requestAssignments: Array<readonly [string, string]>;
        externalEffects: string[];
        assignmentSequence: number;
      };
      replaceMap(deals, state.deals);
      replaceMap(companies, state.companies);
      replaceMap(bundles, state.bundles);
      replaceMap(bundleLineage, state.bundleLineage);
      replaceMap(exactSourceBundles, state.exactSourceBundles);
      assignments.splice(
        0,
        assignments.length,
        ...structuredClone(state.assignments),
      );
      const assignmentById = new Map(
        assignments.map((assignment) => [assignment.id, assignment]),
      );
      requestAssignments.clear();
      for (const [key, assignmentId] of state.requestAssignments) {
        const assignment = assignmentById.get(assignmentId);
        if (assignment) requestAssignments.set(key, assignment);
      }
      externalEffects.splice(
        0,
        externalEffects.length,
        ...structuredClone(state.externalEffects),
      );
      assignmentSequence = state.assignmentSequence;
    },

    usesSourceRegistry(registry) {
      return registry === sourceRegistry;
    },

    async getAnalysisEligibleSnapshot(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const eligibleDeals = [...deals.values()]
        .filter((deal) =>
          deal.workspaceId === workspaceId
          && deal.analysisEligibleAt !== null
          && deal.activeSourceRevisionIds.length > 0
          && deal.activeSourceRevisionFingerprint
            === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
        )
        .sort((left, right) => compareUtf8(left.id, right.id));
      return {
        count: eligibleDeals.length,
        dealIds: eligibleDeals.map((deal) => deal.id),
        fingerprint: eligibleDealSnapshotFingerprint(eligibleDeals),
      };
    },

    async listAnalysisEligibleBundles(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      return [...deals.values()]
        .filter((deal) =>
          deal.workspaceId === workspaceId
          && deal.analysisEligibleAt !== null
          && deal.activeSourceRevisionIds.length > 0
          && deal.activeSourceRevisionFingerprint
            === sourceRevisionFingerprint(deal.activeSourceRevisionIds)
        )
        .sort((left, right) =>
          compareUtf8(left.companyName, right.companyName)
          || compareUtf8(left.id, right.id)
        )
        .map((deal) => {
          const stored = bundles.get(identity(workspaceId, deal.id));
          const lineage = bundleLineage.get(identity(workspaceId, deal.id));
          if (stored && lineage) {
            const active = new Set(deal.activeSourceRevisionIds);
            const refs = [
              ...stored.facts.flatMap((fact) =>
                fact.sources.map((source) =>
                  [source.id, source.documentId] as const
                )
              ),
              ...stored.interactions.map((interaction) =>
                [interaction.id, undefined] as const
              ),
            ];
            for (const [id, sourceId] of refs) {
              const owner = lineage.evidence[id] ?? lineage.interactions[id];
              if (
                !owner
                || owner.workspaceId !== workspaceId
                || owner.dealId !== deal.id
                || (sourceId !== undefined && owner.sourceId !== sourceId)
                || !active.has(owner.sourceRevisionId)
              ) {
                throw new Error(
                  `Deal ${deal.id} evidence has foreign, inactive, or stale source revision ownership.`,
                );
              }
            }
          }
          return structuredClone(
            stored
              ? { ...stored, status: deal.status }
              : DealMemoryBundleSchema.parse({
                dealId: deal.id,
                companyName: deal.companyName,
                status: deal.status,
                facts: [],
                interactions: [],
              }),
          );
        });
    },

    async getExactSourceBundle(rawInput) {
      const input = validateMemoryOwnership(rawInput);
      const exact = exactSourceBundles.get(exactSourceIdentity(input));
      return exact ? structuredClone(exact) : null;
    },

    findForWorkspace,

    async listForWorkspace(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      return [...deals.values()]
        .filter((deal) => deal.workspaceId === workspaceId)
        .sort((left, right) =>
          compareUtf8(left.companyName, right.companyName)
          || compareUtf8(left.id, right.id)
        )
        .map(cloneDeal);
    },

    async confirmSourceAssignment(rawInput) {
      const input = validateConfirmation(rawInput);
      const sourceRevision = await sourceRegistry.getRevision({
        workspaceId: input.workspaceId,
        revisionId: input.sourceRevisionId,
      });
      if (!sourceRevision) {
        throw new Error(
          "The source revision does not exist in this workspace.",
        );
      }
      if (
        input.memoryBundle
        && (
          input.memoryBundle.facts.length > 0
          || input.memoryBundle.interactions.length > 0
        )
        && !input.memoryLineage
      ) {
        throw new Error(
          "Source-backed Deal memory requires internal source revision lineage.",
        );
      }
      if (input.memoryBundle && input.memoryLineage) {
        const expectedEvidence = input.memoryBundle.facts.flatMap((fact) =>
          fact.sources.map((source) => [source.id, source.documentId] as const)
        );
        const expectedInteractions = input.memoryBundle.interactions.map(
          (interaction) => interaction.id,
        );
        for (const [id, sourceId] of expectedEvidence) {
          const owner = input.memoryLineage.evidence[id];
          if (!owner || owner.sourceId !== sourceId) {
            throw new Error(
              "Deal evidence is missing exact internal source identity.",
            );
          }
        }
        for (const id of expectedInteractions) {
          if (!input.memoryLineage.interactions[id]) {
            throw new Error(
              "Deal interaction is missing exact internal source identity.",
            );
          }
        }
        for (
          const owner of [
            ...Object.values(input.memoryLineage.evidence),
            ...Object.values(input.memoryLineage.interactions),
          ]
        ) {
          const revision = await sourceRegistry.getRevision({
            workspaceId: owner.workspaceId,
            revisionId: owner.sourceRevisionId,
          });
          if (
            owner.workspaceId !== input.workspaceId
            || owner.dealId !== input.dealId
            || !revision
            || revision.sourceId !== owner.sourceId
          ) {
            throw new Error(
              "Deal memory lineage references a foreign workspace, Deal, source, or revision.",
            );
          }
        }
      }
      const requestKey = identity(input.workspaceId, input.requestId);
      const requestFingerprint = confirmationFingerprint(input);
      const existingRequest = requestAssignments.get(requestKey);
      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new Error(
            "The confirmation request id was already used for a different Deal or source revision.",
          );
        }
        const existingDeal = deals.get(
          identity(input.workspaceId, input.dealId),
        );
        if (!existingDeal) {
          throw new Error("The confirmed Deal no longer exists.");
        }
        return {
          deal: cloneDeal(existingDeal),
          sourceRevision,
          newlyEligible: false,
        };
      }

      const companyKey = identity(input.workspaceId, input.companyId);
      const existingCompany = companies.get(companyKey);
      if (existingCompany && existingCompany.name !== input.companyName) {
        throw new Error(
          "The company id belongs to a different company in this workspace.",
        );
      }
      const dealKey = identity(input.workspaceId, input.dealId);
      const existingDeal = deals.get(dealKey);
      if (
        existingDeal
        && (
          existingDeal.companyId !== input.companyId
          || existingDeal.companyName !== input.companyName
        )
      ) {
        throw new Error(
          "The Deal belongs to a different company in this workspace.",
        );
      }

      const alreadyActive = assignments.find((assignment) =>
        assignment.workspaceId === input.workspaceId
        && assignment.dealId === input.dealId
        && assignment.sourceId === sourceRevision.sourceId
        && assignment.sourceRevisionId === sourceRevision.id
        && assignment.supersededAt === null
      );
      const wasEligible = existingDeal?.analysisEligibleAt !== null
        && existingDeal?.analysisEligibleAt !== undefined;
      if (!alreadyActive) {
        const backdatedSupersession = assignments.some((assignment) =>
          assignment.workspaceId === input.workspaceId
          && assignment.dealId === input.dealId
          && assignment.sourceId === sourceRevision.sourceId
          && assignment.supersededAt === null
          && Date.parse(input.confirmedAt) < Date.parse(assignment.createdAt)
        );
        if (backdatedSupersession) {
          throw new Error(
            "The confirmation time cannot backdate assignment supersession chronology.",
          );
        }
        for (const assignment of assignments) {
          if (
            assignment.workspaceId === input.workspaceId
            && assignment.dealId === input.dealId
            && assignment.sourceId === sourceRevision.sourceId
            && assignment.supersededAt === null
          ) {
            assignment.supersededAt = input.confirmedAt;
          }
        }
        assignmentSequence += 1;
        const assignment: DealSourceAssignment = {
          id: `deal_source_assignment_${assignmentSequence}`,
          requestId: input.requestId,
          requestFingerprint,
          workspaceId: input.workspaceId,
          dealId: input.dealId,
          sourceId: sourceRevision.sourceId,
          sourceRevisionId: sourceRevision.id,
          assignedByUserId: input.assignedByUserId,
          reason: input.reason,
          createdAt: input.confirmedAt,
          supersededAt: null,
        };
        assignments.push(assignment);
        requestAssignments.set(requestKey, assignment);
      } else {
        requestAssignments.set(requestKey, alreadyActive);
      }

      companies.set(companyKey, {
        id: input.companyId,
        name: input.companyName,
      });
      const activeSourceRevisionIds = assignments
        .filter((assignment) =>
          assignment.workspaceId === input.workspaceId
          && assignment.dealId === input.dealId
          && assignment.supersededAt === null
        )
        .map((assignment) => assignment.sourceRevisionId)
        .sort(compareUtf8);
      const deal: RegisteredDeal = {
        id: input.dealId,
        workspaceId: input.workspaceId,
        companyId: input.companyId,
        companyName: input.companyName,
        status: input.status,
        analysisEligibleAt: existingDeal?.analysisEligibleAt
          ?? input.confirmedAt,
        activeSourceRevisionFingerprint: sourceRevisionFingerprint(
          activeSourceRevisionIds,
        ),
        activeSourceRevisionIds,
      };
      deals.set(dealKey, deal);
      if (input.memoryBundle) {
        bundles.set(dealKey, structuredClone(input.memoryBundle));
        if (input.memoryLineage) {
          bundleLineage.set(dealKey, structuredClone(input.memoryLineage));
          for (
            const exact of exactSourceBundlesFromConfirmation(
              input.memoryBundle,
              input.memoryLineage,
            )
          ) {
            exactSourceBundles.set(exactSourceIdentity(exact), exact);
          }
        }
      } else if (!bundles.has(dealKey)) {
        bundles.set(dealKey, DealMemoryBundleSchema.parse({
          dealId: deal.id,
          companyName: deal.companyName,
          status: deal.status,
          facts: [],
          interactions: [],
        }));
      }
      return {
        deal: cloneDeal(deal),
        sourceRevision,
        newlyEligible: !wasEligible,
      };
    },

    inspect() {
      return {
        deals: [...deals.values()].map(cloneDeal),
        assignments: assignments.map((assignment) =>
          structuredClone(assignment)
        ),
        externalEffects: [...externalEffects],
      };
    },
  };
}

function dealFromRow(
  row: Record<string, unknown>,
  activeSourceRevisionIds: string[],
): RegisteredDeal {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    status: DealStatusSchema.parse(row.status),
    analysisEligibleAt: row.analysis_eligible_at
      ? String(row.analysis_eligible_at)
      : null,
    activeSourceRevisionFingerprint: row.active_source_revision_fingerprint
      ? String(row.active_source_revision_fingerprint)
      : null,
    activeSourceRevisionIds: [...activeSourceRevisionIds].sort(compareUtf8),
  };
}

function sourceRevisionFromRpc(value: unknown): SourceRevision {
  if (!value || typeof value !== "object") {
    throw new Error("The confirmation RPC returned no source revision.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    sourceId: String(row.sourceId),
    revision: Number(row.revision),
    contentHash: String(row.contentHash),
    objectKey: String(row.objectKey),
    objectVersion: String(row.objectVersion),
    contentType: String(row.contentType),
    extractorId: String(row.extractorId),
    extractorVersion: String(row.extractorVersion),
    extractedAt: String(row.extractedAt),
    supersedesRevisionId: row.supersedesRevisionId
      ? String(row.supersedesRevisionId)
      : null,
    createdAt: String(row.createdAt),
  };
}

function registeredDealFromRpc(value: unknown): RegisteredDeal {
  if (!value || typeof value !== "object") {
    throw new Error("The confirmation RPC returned no Deal.");
  }
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    workspaceId: String(row.workspaceId),
    companyId: String(row.companyId),
    companyName: String(row.companyName),
    status: DealStatusSchema.parse(row.status),
    analysisEligibleAt: row.analysisEligibleAt
      ? String(row.analysisEligibleAt)
      : null,
    activeSourceRevisionFingerprint: row.activeSourceRevisionFingerprint
      ? String(row.activeSourceRevisionFingerprint)
      : null,
    activeSourceRevisionIds: Array.isArray(row.activeSourceRevisionIds)
      ? row.activeSourceRevisionIds.map(String).sort(compareUtf8)
      : [],
  };
}

export function createSupabaseDealRegistry(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): DealRegistry {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    "content-type": "application/json",
  };
  async function request(
    pathname: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
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
    if (response.status === 204) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  }
  async function activeRevisionIds(
    workspaceId: string,
    dealIds: string[],
  ): Promise<Map<string, Array<{ revisionId: string; sourceId: string }>>> {
    const result = new Map<
      string,
      Array<{ revisionId: string; sourceId: string }>
    >();
    if (dealIds.length === 0) return result;
    const query = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      deal_id: `in.(${dealIds.map(encodeURIComponent).join(",")})`,
      superseded_at: "is.null",
      select: "deal_id,source_id,source_revision_id",
      order: "deal_id.asc,source_revision_id.asc",
    });
    const rows = await request(
      `/deal_source_assignments?${query}`,
    ) as Record<string, unknown>[];
    for (const row of rows) {
      const dealId = String(row.deal_id);
      const values = result.get(dealId) ?? [];
      values.push({
        sourceId: String(row.source_id),
        revisionId: String(row.source_revision_id),
      });
      result.set(dealId, values);
    }
    return result;
  }
  async function findForWorkspace(input: {
    workspaceId: string;
    dealId: string;
  }): Promise<RegisteredDeal | null> {
    const workspaceId = requiredWorkspaceId(input.workspaceId);
    const dealId = requiredText(input.dealId, "A Deal id");
    const query = new URLSearchParams({
      workspace_id: `eq.${workspaceId}`,
      id: `eq.${dealId}`,
      limit: "1",
    });
    const rows = await request(`/deals?${query}`) as Record<string, unknown>[];
    if (!rows[0]) return null;
    const revisions = await activeRevisionIds(workspaceId, [dealId]);
    return dealFromRow(
      rows[0],
      (revisions.get(dealId) ?? []).map((value) => value.revisionId),
    );
  }
  return {
    async getAnalysisEligibleSnapshot(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const value = await request(
        "/rpc/get_analysis_eligible_snapshot",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ p_workspace_id: workspaceId }),
        },
      );
      if (!value || typeof value !== "object") {
        throw new Error(
          "The eligible Deal snapshot RPC returned no snapshot.",
        );
      }
      const snapshot = value as Record<string, unknown>;
      const count = Number(snapshot.count);
      const dealIds = Array.isArray(snapshot.dealIds)
        ? snapshot.dealIds.map(String)
        : [];
      const fingerprint = String(snapshot.fingerprint ?? "");
      if (
        !Number.isInteger(count)
        || count < 0
        || dealIds.length !== count
        || !/^sha256:[0-9a-f]{64}$/.test(fingerprint)
      ) {
        throw new Error(
          "The eligible Deal snapshot RPC returned an invalid snapshot.",
        );
      }
      return { count, dealIds, fingerprint };
    },

    async listAnalysisEligibleBundles(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const dealQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        analysis_eligible_at: "not.is.null",
        order: "company_name.asc,id.asc",
      });
      const dealRows = await request(
        `/deals?${dealQuery}`,
      ) as Record<string, unknown>[];
      if (dealRows.length === 0) return [];
      const dealIds = dealRows.map((row) => String(row.id));
      const revisionMap = await activeRevisionIds(workspaceId, dealIds);
      for (const row of dealRows) {
        const dealId = String(row.id);
        const revisionIds = (revisionMap.get(dealId) ?? [])
          .map((value) => value.revisionId);
        if (
          revisionIds.length === 0
          || row.active_source_revision_fingerprint
            !== sourceRevisionFingerprint(revisionIds)
        ) {
          throw new Error(
            `Analysis-eligible Deal ${dealId} has a stale active source revision fingerprint.`,
          );
        }
      }
      const dealFilter = `in.(${dealIds.map(encodeURIComponent).join(",")})`;
      const evidenceQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: dealFilter,
        order: "deal_id.asc,id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,provenance,page,fact,excerpt",
      });
      const interactionQuery = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        deal_id: dealFilter,
        order: "deal_id.asc,occurred_at.asc,id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,occurred_at,meeting_summary,decision_reason,concerns,revisit_conditions,provenance,label",
      });
      const [evidenceRows, interactionRows] = await Promise.all([
        request(`/source_evidence?${evidenceQuery}`) as Promise<
          Record<string, unknown>[]
        >,
        request(`/deal_interactions?${interactionQuery}`) as Promise<
          Record<string, unknown>[]
        >,
      ]);
      const documentIds = [
        ...new Set(
          [...evidenceRows, ...interactionRows].map((row) =>
            String(row.document_id)
          ),
        ),
      ];
      const documentRows = documentIds.length
        ? await request(
          `/source_documents?${
            new URLSearchParams({
              id: `in.(${documentIds.map(encodeURIComponent).join(",")})`,
              select: "id,title",
            })
          }`,
        ) as Record<string, unknown>[]
        : [];
      const documentTitles = new Map(
        documentRows.map((row) => [String(row.id), String(row.title)]),
      );

      return dealRows.map((row) => {
        const dealId = String(row.id);
        const activeAssignments = new Set(
          (revisionMap.get(dealId) ?? []).map((value) =>
            JSON.stringify([value.sourceId, value.revisionId])
          ),
        );
        if (activeAssignments.size === 0) {
          throw new Error(
            `Analysis-eligible Deal ${dealId} has no active source assignment.`,
          );
        }
        const dealEvidence = evidenceRows.filter((evidence) =>
          String(evidence.deal_id) === dealId
        );
        const dealInteractions = interactionRows.filter((interaction) =>
          String(interaction.deal_id) === dealId
        );
        for (const ownedRow of [...dealEvidence, ...dealInteractions]) {
          if (
            String(ownedRow.workspace_id) !== workspaceId
            || String(ownedRow.deal_id) !== dealId
            || !activeAssignments.has(JSON.stringify([
              String(ownedRow.document_id),
              String(ownedRow.source_revision_id),
            ]))
          ) {
            throw new Error(
              `Deal ${dealId} evidence references a foreign, inactive, or stale source revision.`,
            );
          }
        }
        return DealMemoryBundleSchema.parse({
          dealId,
          companyName: row.company_name,
          status: row.status,
          facts: dealEvidence.map((evidence) => ({
            text: evidence.fact,
            sources: [{
              id: evidence.id,
              provenance: evidence.provenance,
              title: documentTitles.get(String(evidence.document_id))
                ?? String(evidence.document_id),
              documentId: evidence.document_id,
              page: Number(evidence.page),
              excerpt: evidence.excerpt,
            }],
          })),
          interactions: dealInteractions.map((interaction) => ({
            id: interaction.id,
            occurredAt: interaction.occurred_at,
            summary: interaction.meeting_summary,
            decisionReason: interaction.decision_reason,
            concerns: interaction.concerns,
            revisitConditions: interaction.revisit_conditions,
            provenance: interaction.provenance,
            label: interaction.label,
          })),
        });
      }).sort((left, right) =>
        compareUtf8(left.companyName, right.companyName)
        || compareUtf8(left.dealId, right.dealId)
      );
    },

    async getExactSourceBundle(rawInput) {
      const input = validateMemoryOwnership(rawInput);
      const assignmentQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        source_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        select: "source_revision_id",
        limit: "1",
      });
      const evidenceQuery = new URLSearchParams({
        workspace_id: `eq.${input.workspaceId}`,
        deal_id: `eq.${input.dealId}`,
        document_id: `eq.${input.sourceId}`,
        source_revision_id: `eq.${input.sourceRevisionId}`,
        order: "id.asc",
        select:
          "id,workspace_id,deal_id,document_id,source_revision_id,provenance,page,fact,excerpt",
      });
      const [deal, assignmentRows, evidenceRows, documentRows] =
        await Promise.all([
          findForWorkspace({
            workspaceId: input.workspaceId,
            dealId: input.dealId,
          }),
          request(`/deal_source_assignments?${assignmentQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/source_evidence?${evidenceQuery}`) as Promise<
            Record<string, unknown>[]
          >,
          request(`/source_documents?${
            new URLSearchParams({
              id: `eq.${input.sourceId}`,
              select: "id,title",
              limit: "1",
            })
          }`) as Promise<Record<string, unknown>[]>,
        ]);
      if (!deal || assignmentRows.length !== 1 || evidenceRows.length === 0) {
        return null;
      }
      for (const evidence of evidenceRows) {
        if (
          String(evidence.workspace_id) !== input.workspaceId
          || String(evidence.deal_id) !== input.dealId
          || String(evidence.document_id) !== input.sourceId
          || String(evidence.source_revision_id) !== input.sourceRevisionId
        ) {
          throw new Error(
            "Exact source evidence ownership does not match its query.",
          );
        }
      }
      const title = documentRows[0]
        ? String(documentRows[0].title)
        : input.sourceId;
      return {
        ...input,
        bundle: DealMemoryBundleSchema.parse({
          dealId: deal.id,
          companyName: deal.companyName,
          status: deal.status,
          facts: evidenceRows.map((evidence) => ({
            text: evidence.fact,
            sources: [{
              id: evidence.id,
              provenance: evidence.provenance,
              title,
              documentId: evidence.document_id,
              page: Number(evidence.page),
              excerpt: evidence.excerpt,
            }],
          })),
          interactions: [],
        }),
      };
    },

    findForWorkspace,

    async listForWorkspace(workspaceId) {
      workspaceId = requiredWorkspaceId(workspaceId);
      const query = new URLSearchParams({
        workspace_id: `eq.${workspaceId}`,
        order: "company_name.asc,id.asc",
      });
      const rows = await request(`/deals?${query}`) as Record<string, unknown>[];
      const revisions = await activeRevisionIds(
        workspaceId,
        rows.map((row) => String(row.id)),
      );
      return rows.map((row) => dealFromRow(
        row,
        (revisions.get(String(row.id)) ?? []).map((value) => value.revisionId),
      ));
    },

    async confirmSourceAssignment(rawInput) {
      const input = validateConfirmation(rawInput);
      const response = await request("/rpc/confirm_source_assignment", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          p_assignment: {
            requestId: input.requestId,
            workspaceId: input.workspaceId,
            dealId: input.dealId,
            companyId: input.companyId,
            companyName: input.companyName,
            status: input.status,
            sourceRevisionId: input.sourceRevisionId,
            assignedByUserId: input.assignedByUserId,
            reason: input.reason,
            confirmedAt: input.confirmedAt,
          },
        }),
      }) as Record<string, unknown>;
      return {
        deal: registeredDealFromRpc(response.deal),
        sourceRevision: sourceRevisionFromRpc(response.sourceRevision),
        newlyEligible: Boolean(response.newlyEligible),
      };
    },
  };
}

let singleton: DealRegistry | undefined;

export function getDealRegistry(): DealRegistry {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  singleton = url && serviceRoleKey
    ? createSupabaseDealRegistry({ url, serviceRoleKey })
    : createMemoryDealRegistry({ sourceRegistry: getSourceRegistry() });
  return singleton;
}
import { createHash } from "node:crypto";

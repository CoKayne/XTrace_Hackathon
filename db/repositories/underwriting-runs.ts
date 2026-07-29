import { randomUUID } from "node:crypto";

import {
  CandidateCheckpointSchema,
  CandidateRunSchema,
  UnderwritingBatchSchema,
  UnderwritingSelectionSchema,
  type CandidateCheckpoint,
  type CandidateRun,
  type UnderwritingBatch,
  type UnderwritingSelection,
} from "../../lib/contracts/underwriting";
import {
  IntegrationTransportError,
  isRetryableTransportStatus,
} from "../../lib/api/errors";
import {
  createMemoryUnderwritingArtifactsRepository,
  type CandidateFinalization,
  type MemoryUnderwritingArtifactsRepository,
} from "./underwriting-artifacts";

export type { CandidateFinalization } from "./underwriting-artifacts";

export type CandidateStatus = CandidateRun["status"];
export type UnderwritingSelectionStatus = UnderwritingSelection["status"];

export interface CreateBatchInput {
  workspaceId: string;
  scanRunId: string;
  batchInputFingerprint: string;
  fundPolicySnapshotId: string;
  forceRefresh: boolean;
  refreshNonce: string | null;
  rerunOfId: string | null;
}

export interface ClaimedCandidateRun {
  candidate: CandidateRun;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface CandidateCheckpointWrite extends CandidateCheckpoint {
  workerId: string;
  leaseToken: string;
}

export interface UnderwritingRunsRepository {
  createOrReuseBatch(input: CreateBatchInput): Promise<UnderwritingBatch>;
  saveSelections(input: {
    batchId: string;
    selections: Array<{
      dealId: string;
      status: UnderwritingSelectionStatus;
      rank: number | null;
      reason: string;
    }>;
  }): Promise<void>;
  createSelectedCandidates(input: {
    batchId: string;
    dealIds: string[];
  }): Promise<CandidateRun[]>;
  claimNextCandidate(input: {
    workerId: string;
    leaseSeconds: number;
  }): Promise<ClaimedCandidateRun | null>;
  saveCheckpoint(input: CandidateCheckpointWrite): Promise<void>;
  markCandidateUnavailable(input: {
    candidateRunId: string;
    reasonCodes: string[];
  }): Promise<void>;
  markCandidateFailed(input: {
    candidateRunId: string;
    publicReason: string;
  }): Promise<void>;
  finalizeCandidate(input: CandidateFinalization): Promise<CandidateRun>;
}

interface StoredBatch {
  value: UnderwritingBatch;
  forceRefresh: boolean;
  refreshNonce: string | null;
}

interface CandidateLease {
  workerId: string;
  token: string;
  expiresAt: string;
}

export interface MemoryUnderwritingRunsRepository
  extends UnderwritingRunsRepository {
  inspect(): {
    batches: UnderwritingBatch[];
    selections: UnderwritingSelection[];
    candidates: CandidateRun[];
    checkpoints: CandidateCheckpoint[];
    unavailableReasons: Record<string, string[]>;
    failureReasons: Record<string, string>;
  };
}

export interface MemoryUnderwritingRunsOptions {
  now?: () => Date;
  idGenerator?: (kind: "batch" | "candidate") => string;
  leaseTokenGenerator?: () => string;
  artifacts?: MemoryUnderwritingArtifactsRepository;
}

export function createMemoryUnderwritingRunsRepository(
  options: MemoryUnderwritingRunsOptions = {},
): MemoryUnderwritingRunsRepository {
  const now = options.now ?? (() => new Date());
  const idGenerator = options.idGenerator
    ?? ((kind) => `${kind}_${randomUUID()}`);
  const leaseTokenGenerator = options.leaseTokenGenerator ?? randomUUID;
  const artifacts = options.artifacts
    ?? createMemoryUnderwritingArtifactsRepository();
  const batches = new Map<string, StoredBatch>();
  const selections = new Map<string, UnderwritingSelection>();
  const candidates = new Map<string, CandidateRun>();
  const checkpoints = new Map<string, CandidateCheckpoint>();
  const leases = new Map<string, CandidateLease>();
  const unavailableReasons = new Map<string, string[]>();
  const failureReasons = new Map<string, string>();

  function batchById(id: string): StoredBatch {
    const value = batches.get(requiredText(id, "A batch"));
    if (!value) throw new Error("The underwriting batch does not exist.");
    return value;
  }

  function candidateById(id: string): CandidateRun {
    const value = candidates.get(requiredText(id, "A candidate run"));
    if (!value) throw new Error("The candidate run does not exist.");
    return value;
  }

  function selectedForBatch(batchId: string): UnderwritingSelection[] {
    return [...selections.values()].filter(
      (selection) =>
        selection.batchId === batchId && selection.status === "selected",
    );
  }

  function candidatesForBatch(batchId: string): CandidateRun[] {
    return [...candidates.values()].filter(
      (candidate) => candidate.batchId === batchId,
    );
  }

  function recomputeBatch(batchId: string): void {
    const stored = batchById(batchId);
    const batchCandidates = candidatesForBatch(batchId);
    let status: UnderwritingBatch["status"];
    if (batchCandidates.length === 0) {
      status = selectedForBatch(batchId).length === 0
        && [...selections.values()].some(
          (selection) => selection.batchId === batchId,
        )
        ? "completed"
        : stored.value.status;
    } else {
      const terminal = batchCandidates.every((candidate) =>
        ["completed", "unavailable", "failed"].includes(candidate.status)
      );
      if (!terminal) {
        status = "running";
      } else if (
        batchCandidates.every((candidate) => candidate.status === "completed")
      ) {
        status = "completed";
      } else if (
        batchCandidates.every((candidate) =>
          ["unavailable", "failed"].includes(candidate.status)
        )
      ) {
        status = "failed";
      } else {
        status = "partial";
      }
    }
    stored.value = UnderwritingBatchSchema.parse({
      ...stored.value,
      status,
    });
  }

  function activeLease(candidateRunId: string): CandidateLease {
    const lease = leases.get(candidateRunId);
    if (!lease || Date.parse(lease.expiresAt) <= now().getTime()) {
      throw new Error("The candidate lease is absent or expired.");
    }
    return lease;
  }

  return {
    async createOrReuseBatch(rawInput) {
      const input = validateBatchInput(rawInput);
      if (!input.forceRefresh) {
        const existing = [...batches.values()].find(
          ({ value, forceRefresh }) =>
            !forceRefresh
            && value.workspaceId === input.workspaceId
            && value.batchInputFingerprint === input.batchInputFingerprint,
        );
        if (existing) return structuredClone(existing.value);
      } else {
        const repeatedRefresh = [...batches.values()].find(
          ({ value, forceRefresh, refreshNonce }) =>
            forceRefresh
            && value.workspaceId === input.workspaceId
            && value.batchInputFingerprint === input.batchInputFingerprint
            && refreshNonce === input.refreshNonce,
        );
        if (repeatedRefresh) return structuredClone(repeatedRefresh.value);
        const parent = batchById(input.rerunOfId!);
        if (
          parent.value.workspaceId !== input.workspaceId
          || parent.value.batchInputFingerprint
            !== input.batchInputFingerprint
        ) {
          throw new Error(
            "A forced refresh must rerun the same workspace batch input.",
          );
        }
      }
      const batch = UnderwritingBatchSchema.parse({
        id: requiredText(idGenerator("batch"), "A generated batch id"),
        workspaceId: input.workspaceId,
        scanRunId: input.scanRunId,
        status: "queued",
        batchInputFingerprint: input.batchInputFingerprint,
        fundPolicySnapshotId: input.fundPolicySnapshotId,
        rerunOfId: input.rerunOfId,
        createdAt: now().toISOString(),
      });
      batches.set(batch.id, {
        value: batch,
        forceRefresh: input.forceRefresh,
        refreshNonce: input.refreshNonce,
      });
      return structuredClone(batch);
    },

    async saveSelections(input) {
      const batch = batchById(input.batchId);
      const seenDeals = new Set<string>();
      const seenRanks = new Set<number>();
      const normalized = input.selections.map((selection) => {
        const dealId = requiredText(selection.dealId, "A Deal");
        if (seenDeals.has(dealId)) {
          throw new Error("A Deal can have only one batch selection.");
        }
        seenDeals.add(dealId);
        const rank = selection.rank;
        const selected = selection.status === "selected"
          && rank !== null
          && Number.isInteger(rank)
          && rank > 0
          && rank <= 5;
        if (selected && seenRanks.has(rank)) {
          throw new Error("Selected candidate ranks must be unique.");
        }
        if (selected) seenRanks.add(rank);
        return UnderwritingSelectionSchema.parse({
          batchId: batch.value.id,
          dealId,
          status: selected ? "selected" : "not_selected",
          rank: selected ? rank : null,
          reason: requiredText(selection.reason, "A selection reason"),
        });
      });
      for (const selection of normalized) {
        selections.set(selectionIdentity(selection.batchId, selection.dealId), {
          ...selection,
        });
      }
      recomputeBatch(batch.value.id);
    },

    async createSelectedCandidates(input) {
      const batch = batchById(input.batchId);
      const requested = new Set(
        input.dealIds.map((id) => requiredText(id, "A Deal")),
      );
      const selected = selectedForBatch(batch.value.id)
        .filter(({ dealId }) => requested.has(dealId))
        .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
      const result: CandidateRun[] = [];
      for (const selection of selected) {
        let candidate = candidatesForBatch(batch.value.id).find(
          ({ dealId }) => dealId === selection.dealId,
        );
        if (!candidate) {
          const id = requiredText(
            idGenerator("candidate"),
            "A generated candidate id",
          );
          const rerunOfId = batch.value.rerunOfId
            ? candidatesForBatch(batch.value.rerunOfId).find(
              ({ dealId }) => dealId === selection.dealId,
            )?.id ?? null
            : null;
          candidate = CandidateRunSchema.parse({
            id,
            batchId: batch.value.id,
            workspaceId: batch.value.workspaceId,
            dealId: selection.dealId,
            status: "queued",
            candidateAnalysisFingerprint: `pending:${id}`,
            rerunOfId,
            createdAt: now().toISOString(),
            finalizedAt: null,
          });
          candidates.set(candidate.id, candidate);
        }
        result.push(structuredClone(candidate));
      }
      recomputeBatch(batch.value.id);
      return result;
    },

    async claimNextCandidate(input) {
      const workerId = requiredText(input.workerId, "A worker");
      if (
        !Number.isInteger(input.leaseSeconds)
        || input.leaseSeconds <= 0
      ) {
        throw new Error("Lease seconds must be a positive integer.");
      }
      const timestamp = now().getTime();
      const candidate = [...candidates.values()]
        .filter((value) =>
          value.status === "queued"
          || (
            value.status === "running"
            && (!leases.get(value.id)
              || Date.parse(leases.get(value.id)!.expiresAt) <= timestamp)
          )
        )
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt)
          || left.id.localeCompare(right.id)
        )[0];
      if (!candidate) return null;
      const leaseToken = requiredText(
        leaseTokenGenerator(),
        "A generated lease token",
      );
      const leaseExpiresAt = new Date(
        timestamp + input.leaseSeconds * 1_000,
      ).toISOString();
      const running = CandidateRunSchema.parse({
        ...candidate,
        status: "running",
      });
      candidates.set(candidate.id, running);
      leases.set(candidate.id, {
        workerId,
        token: leaseToken,
        expiresAt: leaseExpiresAt,
      });
      recomputeBatch(candidate.batchId);
      return {
        candidate: structuredClone(running),
        leaseToken,
        leaseExpiresAt,
      };
    },

    async saveCheckpoint(input) {
      const candidate = candidateById(input.candidateRunId);
      if (candidate.status !== "running") {
        throw new Error("Only a running candidate can save a checkpoint.");
      }
      const lease = activeLease(candidate.id);
      if (
        lease.workerId !== requiredText(input.workerId, "A worker")
        || lease.token !== requiredText(input.leaseToken, "A lease token")
      ) {
        throw new Error("The checkpoint lease does not match its owner.");
      }
      const checkpoint = CandidateCheckpointSchema.parse({
        candidateRunId: input.candidateRunId,
        stage: input.stage,
        status: input.status,
        artifactFingerprint: input.artifactFingerprint,
        publicReason: input.publicReason,
        savedAt: input.savedAt,
      });
      checkpoints.set(
        checkpointIdentity(checkpoint.candidateRunId, checkpoint.stage),
        checkpoint,
      );
    },

    async markCandidateUnavailable(input) {
      const candidate = candidateById(input.candidateRunId);
      assertCanTerminate(candidate);
      const reasonCodes = [
        ...new Set(
          input.reasonCodes.map((value) =>
            requiredText(value, "An unavailable reason code")
          ),
        ),
      ];
      if (reasonCodes.length === 0) {
        throw new Error("Unavailable candidates require reason codes.");
      }
      unavailableReasons.set(candidate.id, reasonCodes);
      candidates.set(candidate.id, CandidateRunSchema.parse({
        ...candidate,
        status: "unavailable",
        finalizedAt: now().toISOString(),
      }));
      leases.delete(candidate.id);
      recomputeBatch(candidate.batchId);
    },

    async markCandidateFailed(input) {
      const candidate = candidateById(input.candidateRunId);
      assertCanTerminate(candidate);
      failureReasons.set(
        candidate.id,
        requiredText(input.publicReason, "A public failure reason"),
      );
      candidates.set(candidate.id, CandidateRunSchema.parse({
        ...candidate,
        status: "failed",
        finalizedAt: now().toISOString(),
      }));
      leases.delete(candidate.id);
      recomputeBatch(candidate.batchId);
    },

    async finalizeCandidate(input) {
      const candidate = candidateById(input.candidateRunId);
      if (candidate.status !== "running") {
        throw new Error(
          `Only a running candidate can be finalized; candidate is ${candidate.status}.`,
        );
      }
      const lease = activeLease(candidate.id);
      if (
        lease.workerId !== requiredText(input.workerId, "A worker")
        || lease.token !== requiredText(input.leaseToken, "A lease token")
      ) {
        throw new Error("The candidate finalization lease does not match.");
      }
      const prepared = artifacts.prepareFinalization({
        candidate: {
          ...candidate,
          fundPolicySnapshotId:
            batchById(candidate.batchId).value.fundPolicySnapshotId,
        },
        finalization: input,
      });
      const completed = CandidateRunSchema.parse({
        ...candidate,
        status: "completed",
        candidateAnalysisFingerprint:
          prepared.candidateAnalysisFingerprint,
        finalizedAt: now().toISOString(),
      });

      artifacts.commitPrepared(prepared);
      candidates.set(candidate.id, completed);
      leases.delete(candidate.id);
      recomputeBatch(candidate.batchId);
      return structuredClone(completed);
    },

    inspect() {
      return {
        batches: [...batches.values()].map(({ value }) =>
          structuredClone(value)
        ),
        selections: [...selections.values()].map((value) =>
          structuredClone(value)
        ),
        candidates: [...candidates.values()].map((value) =>
          structuredClone(value)
        ),
        checkpoints: [...checkpoints.values()].map((value) =>
          structuredClone(value)
        ),
        unavailableReasons: Object.fromEntries(
          [...unavailableReasons].map(([key, value]) => [
            key,
            structuredClone(value),
          ]),
        ),
        failureReasons: Object.fromEntries(failureReasons),
      };
    },
  };
}

export function createSupabaseUnderwritingRunsRepository(options: {
  url: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): UnderwritingRunsRepository {
  const base = `${options.url.replace(/\/$/, "")}/rest/v1`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  async function request(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${pathname}`, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify(body),
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
    const responseBody = await response.text();
    return responseBody.trim() ? JSON.parse(responseBody) : null;
  }

  return {
    async createOrReuseBatch(input) {
      const validated = validateBatchInput(input);
      return parseBatch(await request(
        "/rpc/create_or_reuse_underwriting_batch",
        { p_payload: validated },
      ));
    },

    async saveSelections(input) {
      await request("/rpc/save_underwriting_selections", {
        p_payload: {
          batchId: requiredText(input.batchId, "A batch"),
          selections: input.selections.map((selection) => ({
            dealId: requiredText(selection.dealId, "A Deal"),
            status: selection.status,
            rank: selection.rank,
            reason: requiredText(selection.reason, "A selection reason"),
          })),
        },
      });
    },

    async createSelectedCandidates(input) {
      const value = await request(
        "/rpc/create_selected_underwriting_candidates",
        {
          p_payload: {
            batchId: requiredText(input.batchId, "A batch"),
            dealIds: input.dealIds.map((dealId) =>
              requiredText(dealId, "A Deal")
            ),
          },
        },
      );
      if (!Array.isArray(value)) {
        throw new Error("Candidate creation returned an invalid result.");
      }
      return value.map(parseCandidate);
    },

    async claimNextCandidate(input) {
      const workerId = requiredText(input.workerId, "A worker");
      if (
        !Number.isInteger(input.leaseSeconds)
        || input.leaseSeconds <= 0
      ) {
        throw new Error("Lease seconds must be a positive integer.");
      }
      const value = await request(
        "/rpc/claim_next_underwriting_candidate",
        {
          p_worker_id: workerId,
          p_lease_seconds: input.leaseSeconds,
        },
      );
      if (value === null) return null;
      const row = value as Record<string, unknown>;
      return {
        candidate: parseCandidate(row.candidate),
        leaseToken: requiredText(String(row.leaseToken), "A lease token"),
        leaseExpiresAt: requiredText(
          String(row.leaseExpiresAt),
          "A lease expiry",
        ),
      };
    },

    async saveCheckpoint(input) {
      const checkpoint = CandidateCheckpointSchema.parse({
        candidateRunId: input.candidateRunId,
        stage: input.stage,
        status: input.status,
        artifactFingerprint: input.artifactFingerprint,
        publicReason: input.publicReason,
        savedAt: input.savedAt,
      });
      await request("/rpc/save_underwriting_checkpoint", {
        p_payload: {
          workerId: requiredText(input.workerId, "A worker"),
          leaseToken: requiredText(input.leaseToken, "A lease token"),
          checkpoint,
        },
      });
    },

    async markCandidateUnavailable(input) {
      const reasonCodes = input.reasonCodes.map((value) =>
        requiredText(value, "An unavailable reason code")
      );
      if (reasonCodes.length === 0) {
        throw new Error("Unavailable candidates require reason codes.");
      }
      await request("/rpc/mark_candidate_underwriting_unavailable", {
        p_payload: {
          candidateRunId: requiredText(
            input.candidateRunId,
            "A candidate run",
          ),
          reasonCodes,
        },
      });
    },

    async markCandidateFailed(input) {
      await request("/rpc/mark_candidate_underwriting_failed", {
        p_payload: {
          candidateRunId: requiredText(
            input.candidateRunId,
            "A candidate run",
          ),
          publicReason: requiredText(
            input.publicReason,
            "A public failure reason",
          ),
        },
      });
    },

    async finalizeCandidate(input) {
      return parseCandidate(await request(
        "/rpc/finalize_candidate_underwriting",
        { p_payload: input },
      ));
    },
  };
}

function parseBatch(value: unknown): UnderwritingBatch {
  const row = value as Record<string, unknown>;
  return UnderwritingBatchSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    scanRunId: row.scanRunId ?? row.scan_run_id,
    status: row.status,
    batchInputFingerprint:
      row.batchInputFingerprint ?? row.batch_input_fingerprint,
    fundPolicySnapshotId:
      row.fundPolicySnapshotId ?? row.fund_policy_snapshot_id,
    rerunOfId: row.rerunOfId ?? row.rerun_of_id ?? null,
    createdAt: row.createdAt ?? row.created_at,
  });
}

function parseCandidate(value: unknown): CandidateRun {
  const row = value as Record<string, unknown>;
  return CandidateRunSchema.parse({
    id: row.id,
    batchId: row.batchId ?? row.batch_id,
    workspaceId: row.workspaceId ?? row.workspace_id,
    dealId: row.dealId ?? row.deal_id,
    status: row.status,
    candidateAnalysisFingerprint:
      row.candidateAnalysisFingerprint
      ?? row.candidate_analysis_fingerprint,
    rerunOfId: row.rerunOfId ?? row.rerun_of_id ?? null,
    createdAt: row.createdAt ?? row.created_at,
    finalizedAt: row.finalizedAt ?? row.finalized_at ?? null,
  });
}

function validateBatchInput(input: CreateBatchInput): CreateBatchInput {
  const forceRefresh = input.forceRefresh === true;
  const refreshNonce = input.refreshNonce === null
    ? null
    : requiredText(input.refreshNonce, "A refresh nonce");
  const rerunOfId = input.rerunOfId === null
    ? null
    : requiredText(input.rerunOfId, "A rerun parent");
  if (
    (forceRefresh && (refreshNonce === null || rerunOfId === null))
    || (!forceRefresh && (refreshNonce !== null || rerunOfId !== null))
  ) {
    throw new Error(
      "A forced refresh requires a refresh nonce and rerun parent; ordinary batches accept neither.",
    );
  }
  return {
    workspaceId: requiredText(input.workspaceId, "A workspace"),
    scanRunId: requiredText(input.scanRunId, "A scan run"),
    batchInputFingerprint: requiredText(
      input.batchInputFingerprint,
      "A batch input fingerprint",
    ),
    fundPolicySnapshotId: requiredText(
      input.fundPolicySnapshotId,
      "A Fund Policy snapshot",
    ),
    forceRefresh,
    refreshNonce,
    rerunOfId,
  };
}

function assertCanTerminate(candidate: CandidateRun): void {
  if (!["queued", "running", "partial"].includes(candidate.status)) {
    throw new Error("A terminal candidate cannot be changed.");
  }
}

function selectionIdentity(batchId: string, dealId: string): string {
  return `${batchId.length}:${batchId}${dealId.length}:${dealId}`;
}

function checkpointIdentity(candidateRunId: string, stage: string): string {
  return `${candidateRunId.length}:${candidateRunId}${stage.length}:${stage}`;
}

function requiredText(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized !== value) {
    throw new Error(`${label} is required without surrounding whitespace.`);
  }
  return value;
}

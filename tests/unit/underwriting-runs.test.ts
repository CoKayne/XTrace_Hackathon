import assert from "node:assert/strict";
import test from "node:test";

import {
  createSupabaseUnderwritingArtifactsRepository,
} from "../../db/repositories/underwriting-artifacts";
import {
  createMemoryUnderwritingRunsRepository,
  createSupabaseUnderwritingRunsRepository,
} from "../../db/repositories/underwriting-runs";

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    idGenerator: (kind: "batch" | "candidate") =>
      `${kind}_${++sequence}`,
    leaseTokenGenerator: () => `lease_${++sequence}`,
  };
}

test("same batch fingerprint reuses one batch and force refresh creates a linked rerun", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const input = {
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"1".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  };

  const first = await repository.createOrReuseBatch(input);
  const reused = await repository.createOrReuseBatch({
    ...input,
    scanRunId: "scan_2",
  });
  const refreshed = await repository.createOrReuseBatch({
    ...input,
    scanRunId: "scan_3",
    forceRefresh: true,
    refreshNonce: "refresh_1",
    rerunOfId: first.id,
  });

  assert.equal(reused.id, first.id);
  assert.notEqual(refreshed.id, first.id);
  assert.equal(refreshed.rerunOfId, first.id);
  assert.equal(repository.inspect().batches.length, 2);
});

test("batch idempotency is workspace scoped and refresh requires an explicit nonce and parent", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const common = {
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"2".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  };
  const left = await repository.createOrReuseBatch({
    ...common,
    workspaceId: "workspace_1",
  });
  const right = await repository.createOrReuseBatch({
    ...common,
    workspaceId: "workspace_2",
  });

  assert.notEqual(left.id, right.id);
  await assert.rejects(
    repository.createOrReuseBatch({
      ...common,
      workspaceId: "workspace_1",
      forceRefresh: true,
    }),
    /refresh nonce|rerun/i,
  );
});

test("only ranks one through five remain selected and receive CandidateRuns", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"3".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  const dealIds = Array.from({ length: 7 }, (_, index) => `deal_${index + 1}`);
  await repository.saveSelections({
    batchId: batch.id,
    selections: dealIds.map((dealId, index) => ({
      dealId,
      status: "selected",
      rank: index + 1,
      reason: `Rank ${index + 1}`,
    })),
  });
  const candidates = await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds,
  });
  const snapshot = repository.inspect();

  assert.deepEqual(
    snapshot.selections.map(({ dealId, status, rank }) => ({
      dealId,
      status,
      rank,
    })),
    dealIds.map((dealId, index) => ({
      dealId,
      status: index < 5 ? "selected" : "not_selected",
      rank: index < 5 ? index + 1 : null,
    })),
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.dealId),
    dealIds.slice(0, 5),
  );
});

test("claim returns a lease capability and checkpoints reject a foreign token", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"4".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Top candidate",
    }],
  });
  await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  const claimed = await repository.claimNextCandidate({
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  assert.equal(claimed.candidate.status, "running");
  assert.match(claimed.leaseToken, /^lease_/);

  const checkpoint = {
    candidateRunId: claimed.candidate.id,
    stage: "evidence_pack" as const,
    status: "completed" as const,
    inputFingerprint: `sha256:${"5".repeat(64)}`,
    outputFingerprint: `sha256:${"6".repeat(64)}`,
    outputPayload: { packId: "pack_1" },
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-29T12:00:00.000Z",
  };
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      workerId: "worker_1",
      leaseToken: "foreign",
    }),
    /lease/i,
  );
  await repository.saveCheckpoint({
    ...checkpoint,
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });
  assert.deepEqual(repository.inspect().checkpoints, [checkpoint]);
});

test("completed checkpoints are readable by exact workspace and candidate", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const batch = await repository.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"4".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  await repository.saveSelections({
    batchId: batch.id,
    selections: [{
      dealId: "deal_1",
      status: "selected",
      rank: 1,
      reason: "Top candidate",
    }],
  });
  const [candidate] = await repository.createSelectedCandidates({
    batchId: batch.id,
    dealIds: ["deal_1"],
  });
  assert.ok(candidate);
  const claimed = await repository.claimCandidate({
    workspaceId: "workspace_1",
    candidateRunId: candidate.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.ok(claimed);
  const checkpoint = {
    candidateRunId: candidate.id,
    stage: "context_router" as const,
    status: "completed" as const,
    inputFingerprint: `sha256:${"5".repeat(64)}`,
    outputFingerprint: `sha256:${"6".repeat(64)}`,
    outputPayload: { contextId: "context_1" },
    attemptCount: 1,
    costUnits: 0,
    tokenUnits: 0,
    actualTokenUnits: 0,
    providerAttempts: [],
    reasonCode: null,
    publicReason: null,
    savedAt: "2026-07-29T12:00:00.000Z",
  };
  await repository.saveCheckpoint({
    ...checkpoint,
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });

  const readable = repository as typeof repository & {
    listCheckpoints(input: {
      workspaceId: string;
      candidateRunId: string;
    }): Promise<typeof checkpoint[]>;
  };
  assert.deepEqual(await readable.listCheckpoints({
    workspaceId: "workspace_1",
    candidateRunId: candidate.id,
  }), [checkpoint]);
  assert.deepEqual(await readable.listCheckpoints({
    workspaceId: "workspace_foreign",
    candidateRunId: candidate.id,
  }), []);
  await repository.saveCheckpoint({
    ...checkpoint,
    savedAt: "2026-07-29T12:00:01.000Z",
    workerId: "worker_1",
    leaseToken: claimed.leaseToken,
  });
  assert.equal(
    repository.inspect().checkpoints[0]?.savedAt,
    checkpoint.savedAt,
    "an idempotent completed write retains the original checkpoint",
  );
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      outputPayload: { contextId: "mutated_context" },
      workerId: "worker_1",
      leaseToken: claimed.leaseToken,
    }),
    /immutable/i,
  );
  await assert.rejects(
    repository.saveCheckpoint({
      ...checkpoint,
      inputFingerprint: `sha256:${"7".repeat(64)}`,
      workerId: "worker_1",
      leaseToken: claimed.leaseToken,
    }),
    /input fingerprint changed/i,
  );
});

test("target-scoped claim never leases an older candidate or a candidate from another workspace", async () => {
  const repository = createMemoryUnderwritingRunsRepository(
    deterministicOptions(),
  );
  const createCandidate = async (
    workspaceId: string,
    dealId: string,
    fingerprintCharacter: string,
  ) => {
    const batch = await repository.createOrReuseBatch({
      workspaceId,
      scanRunId: `scan_${workspaceId}`,
      batchInputFingerprint:
        `sha256:${fingerprintCharacter.repeat(64)}`,
      fundPolicySnapshotId: `fund_policy_${workspaceId}`,
      forceRefresh: false,
      refreshNonce: null,
      rerunOfId: null,
    });
    await repository.saveSelections({
      batchId: batch.id,
      selections: [{
        dealId,
        status: "selected",
        rank: 1,
        reason: "Target-safe claim fixture",
      }],
    });
    const [candidate] = await repository.createSelectedCandidates({
      batchId: batch.id,
      dealIds: [dealId],
    });
    assert.ok(candidate);
    return candidate;
  };
  const older = await createCandidate("workspace_a", "deal_a", "a");
  const target = await createCandidate("workspace_b", "deal_b", "b");

  const mismatched = await repository.claimCandidate({
    workspaceId: "workspace_a",
    candidateRunId: target.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.equal(mismatched, null);
  assert.deepEqual(
    repository.inspect().candidates.map(({ id, status }) => ({ id, status })),
    [
      { id: older.id, status: "queued" },
      { id: target.id, status: "queued" },
    ],
  );

  const claimed = await repository.claimCandidate({
    workspaceId: "workspace_b",
    candidateRunId: target.id,
    workerId: "worker_1",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.id, target.id);
  assert.deepEqual(
    repository.inspect().candidates.map(({ id, status }) => ({ id, status })),
    [
      { id: older.id, status: "queued" },
      { id: target.id, status: "running" },
    ],
  );
});

test("Supabase adapters use controlled RPC writes and workspace-scoped artifact reuse reads", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("/rpc/create_or_reuse_underwriting_batch")) {
      return Response.json({
        id: "batch_db",
        workspaceId: "workspace_1",
        scanRunId: "scan_1",
        status: "queued",
        batchInputFingerprint: `sha256:${"7".repeat(64)}`,
        fundPolicySnapshotId: "fund_policy_1",
        rerunOfId: null,
        createdAt: "2026-07-29T12:00:00.000Z",
      });
    }
    if (String(url).includes("/candidate_runs?")) {
      return Response.json([{
        id: "candidate_db",
        workspace_id: "workspace_1",
        deal_id: "deal_1",
        candidate_analysis_fingerprint: `sha256:${"8".repeat(64)}`,
      }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl,
  });
  const artifacts = createSupabaseUnderwritingArtifactsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl,
  });

  const batch = await runs.createOrReuseBatch({
    workspaceId: "workspace_1",
    scanRunId: "scan_1",
    batchInputFingerprint: `sha256:${"7".repeat(64)}`,
    fundPolicySnapshotId: "fund_policy_1",
    forceRefresh: false,
    refreshNonce: null,
    rerunOfId: null,
  });
  const reusable = await artifacts.findReusable({
    workspaceId: "workspace_1",
    candidateAnalysisFingerprint: `sha256:${"8".repeat(64)}`,
  });

  assert.equal(batch.id, "batch_db");
  assert.equal(reusable?.candidateRunId, "candidate_db");
  assert.match(requests[0].url, /rpc\/create_or_reuse_underwriting_batch$/);
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    p_payload: {
      workspaceId: "workspace_1",
      scanRunId: "scan_1",
      batchInputFingerprint: `sha256:${"7".repeat(64)}`,
      fundPolicySnapshotId: "fund_policy_1",
      forceRefresh: false,
      refreshNonce: null,
      rerunOfId: null,
    },
  });
  const reuseUrl = new URL(requests[1].url);
  assert.equal(reuseUrl.searchParams.get("workspace_id"), "eq.workspace_1");
  assert.equal(reuseUrl.searchParams.get("status"), "eq.completed");
  assert.equal(
    reuseUrl.searchParams.get("artifact_source_candidate_run_id"),
    "is.null",
  );
  assert.equal(
    reuseUrl.searchParams.get("candidate_analysis_fingerprint"),
    `eq.sha256:${"8".repeat(64)}`,
  );
});

test("Supabase candidate writes use the exact target claim and alias-aware finalization RPCs", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const candidate = {
    id: "candidate_target",
    batchId: "batch_target",
    workspaceId: "workspace_target",
    dealId: "deal_target",
    status: "running",
    candidateAnalysisFingerprint: "pending:candidate_target",
    rerunOfId: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    finalizedAt: null,
  };
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url, init = {}) => {
      const body = JSON.parse(String(init.body));
      requests.push({ url: String(url), body });
      if (String(url).endsWith("/rpc/claim_underwriting_candidate")) {
        return Response.json({
          candidate,
          leaseToken: "lease_target",
          leaseExpiresAt: "2026-07-29T12:01:00.000Z",
        });
      }
      if (
        String(url).endsWith(
          "/rpc/finalize_or_reuse_candidate_underwriting",
        )
      ) {
        return Response.json({
          ...candidate,
          status: "completed",
          candidateAnalysisFingerprint: `sha256:${"9".repeat(64)}`,
          finalizedAt: "2026-07-29T12:00:30.000Z",
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const claimed = await runs.claimCandidate({
    workspaceId: "workspace_target",
    candidateRunId: "candidate_target",
    workerId: "worker_target",
    leaseSeconds: 60,
  });
  assert.equal(claimed?.candidate.id, "candidate_target");
  const completed = await runs.finalizeCandidate({ marker: true } as never);
  assert.equal(completed.status, "completed");
  assert.deepEqual(requests, [
    {
      url:
        "https://supabase.example/rest/v1/rpc/claim_underwriting_candidate",
      body: {
        p_workspace_id: "workspace_target",
        p_candidate_run_id: "candidate_target",
        p_worker_id: "worker_target",
        p_lease_seconds: 60,
      },
    },
    {
      url:
        "https://supabase.example/rest/v1/rpc/finalize_or_reuse_candidate_underwriting",
      body: { p_payload: { marker: true } },
    },
  ]);
});

test("Supabase checkpoint replay reads only the exact workspace candidate", async () => {
  let requestedUrl = "";
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return Response.json([{
        candidate_run_id: "candidate_target",
        stage: "framework_lenses",
        status: "completed",
        input_fingerprint: `sha256:${"1".repeat(64)}`,
        output_fingerprint: `sha256:${"2".repeat(64)}`,
        output_payload: { judgments: [], disagreements: [] },
        attempt_count: 1,
        cost_units: 1,
        token_units: 4_000,
        actual_token_units: 17,
        provider_attempts: [{
          attemptFingerprint: `sha256:${"3".repeat(64)}`,
          status: "completed",
          reservedCostUnits: 1,
          reservedTokenUnits: 4_000,
          actualTokenUnits: 17,
        }],
        reason_code: null,
        public_reason: null,
        saved_at: "2026-07-29T12:00:00.000Z",
      }]);
    },
  });

  const checkpoints = await runs.listCheckpoints({
    workspaceId: "workspace_target",
    candidateRunId: "candidate_target",
  });

  assert.equal(checkpoints[0]?.actualTokenUnits, 17);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/rest/v1/candidate_checkpoints");
  assert.equal(
    url.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(
    url.searchParams.get("candidate_run_id"),
    "eq.candidate_target",
  );
  assert.equal(url.searchParams.get("order"), "saved_at.asc,stage.asc");
});

test("Supabase underwriting read models scope every batch projection to one workspace", async () => {
  const requestedUrls: string[] = [];
  const runs = createSupabaseUnderwritingRunsRepository({
    url: "https://supabase.example",
    serviceRoleKey: "secret",
    fetchImpl: async (url) => {
      const requestedUrl = String(url);
      requestedUrls.push(requestedUrl);
      if (requestedUrl.includes("/underwriting_batches?")) {
        return Response.json([{
          id: "batch_target",
          workspace_id: "workspace_target",
          scan_run_id: "scan_target",
          status: "completed",
          batch_input_fingerprint: `sha256:${"a".repeat(64)}`,
          fund_policy_snapshot_id: "policy_target",
          rerun_of_id: null,
          created_at: "2026-07-29T12:00:00.000Z",
        }]);
      }
      if (requestedUrl.includes("/underwriting_selections?")) {
        return Response.json([{
          batch_id: "batch_target",
          deal_id: "deal_target",
          status: "selected",
          rank: 1,
          reason: "Top candidate",
        }]);
      }
      if (requestedUrl.includes("/candidate_runs?")) {
        return Response.json([{
          id: "candidate_target",
          batch_id: "batch_target",
          workspace_id: "workspace_target",
          deal_id: "deal_target",
          status: "completed",
          candidate_analysis_fingerprint: `sha256:${"b".repeat(64)}`,
          rerun_of_id: null,
          created_at: "2026-07-29T12:00:00.000Z",
          finalized_at: "2026-07-29T12:01:00.000Z",
        }]);
      }
      throw new Error(`Unexpected URL ${requestedUrl}`);
    },
  });

  assert.equal((await runs.getBatchByScanRunId({
    workspaceId: "workspace_target",
    scanRunId: "scan_target",
  }))?.id, "batch_target");
  assert.equal((await runs.listSelectionsForBatch({
    workspaceId: "workspace_target",
    batchId: "batch_target",
  }))[0]?.dealId, "deal_target");
  assert.equal((await runs.listCandidatesForBatch({
    workspaceId: "workspace_target",
    batchId: "batch_target",
  }))[0]?.id, "candidate_target");

  const [batchUrl, selectionUrl, candidateUrl] = requestedUrls.map(
    (value) => new URL(value),
  );
  assert.equal(
    batchUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(batchUrl.searchParams.get("scan_run_id"), "eq.scan_target");
  assert.equal(
    selectionUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(selectionUrl.searchParams.get("batch_id"), "eq.batch_target");
  assert.equal(
    candidateUrl.searchParams.get("workspace_id"),
    "eq.workspace_target",
  );
  assert.equal(candidateUrl.searchParams.get("batch_id"), "eq.batch_target");
});

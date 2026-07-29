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
    artifactFingerprint: `sha256:${"5".repeat(64)}`,
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
    reuseUrl.searchParams.get("candidate_analysis_fingerprint"),
    `eq.sha256:${"8".repeat(64)}`,
  );
});

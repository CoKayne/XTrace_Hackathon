import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryDataClient,
  createSupabaseDataClient,
} from "../../db/client";
import { createRunsRepository } from "../../db/repositories/runs";

test("claims a queued run once and persists completion", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);
  const run = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  const claimed = await runs.claimNext("worker_1");
  assert.equal(claimed?.id, run.id);
  assert.equal(claimed?.status, "running");
  assert.equal(await runs.claimNext("worker_2"), null);

  const completed = await runs.finish({
    workspaceId: run.workspaceId,
    runId: run.id,
    status: "completed",
  });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
});

test("reuses an active run for the same workspace, mode, and window", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);

  const first = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });
  const second = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });

  assert.equal(second.id, first.id);
});

test("records stage progress and partial-run warnings", async () => {
  const client = createMemoryDataClient();
  const runs = createRunsRepository(client);
  const run = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  await runs.updateStage({
    workspaceId: run.workspaceId,
    runId: run.id,
    stage: "collect_market",
    status: "running",
    warning: "One provider timed out",
  });

  const stored = await runs.get(run.workspaceId, run.id);
  assert.equal(stored?.currentStage, "collect_market");
  assert.equal(stored?.warningCount, 1);
  assert.deepEqual(stored?.warnings, ["One provider timed out"]);
});

test("reclaims a run after its worker lease expires", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const client = createMemoryDataClient({
    now: () => current,
    leaseDurationMs: 60_000,
  });
  const runs = createRunsRepository(client);
  const queued = await runs.create({
    workspaceId: "demo",
    mode: "xtrace",
    windowDays: 14,
  });

  const firstClaim = await runs.claimNext("worker_1");
  assert.equal(firstClaim?.id, queued.id);
  assert.equal(firstClaim?.workerId, "worker_1");

  current = new Date("2026-07-24T12:01:01.000Z");
  const reclaimed = await runs.claimNext("worker_2");

  assert.equal(reclaimed?.id, queued.id);
  assert.equal(reclaimed?.workerId, "worker_2");
  assert.equal(reclaimed?.status, "running");
});

test("a reclaimed run rejects writes from its previous worker", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => current,
    leaseDurationMs: 60_000,
  }));
  const queued = await runs.create({
    workspaceId: "demo",
    mode: "structured",
    windowDays: 14,
  });
  await runs.claimNext("worker_old");
  current = new Date("2026-07-24T12:01:01.000Z");
  await runs.claimNext("worker_new");

  await assert.rejects(
    runs.updateStage({
      workspaceId: queued.workspaceId,
      runId: queued.id,
      workerId: "worker_old",
      stage: "report",
      status: "completed",
    }),
    /no longer owns/i,
  );
  await assert.rejects(
    runs.finish({
      workspaceId: queued.workspaceId,
      runId: queued.id,
      workerId: "worker_old",
      status: "completed",
    }),
    /no longer owns/i,
  );
});

test("run stage and finish mutations cannot cross workspace boundaries", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  const run = await runs.create({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });

  await assert.rejects(
    runs.updateStage({
      workspaceId: "workspace_two",
      runId: run.id,
      stage: "report",
      status: "completed",
    }),
    /not found/i,
  );
  await assert.rejects(
    runs.finish({
      workspaceId: "workspace_two",
      runId: run.id,
      status: "completed",
    }),
    /not found/i,
  );

  assert.deepEqual(await runs.get("workspace_one", run.id), run);
});

test("the data client rejects cross-workspace stage parents and identity rewrites", async () => {
  const client = createMemoryDataClient();
  const run = await client.insertRun({
    workspaceId: "workspace_one",
    mode: "structured",
    windowDays: 14,
  });

  await assert.rejects(
    client.insertRunStage({
      workspaceId: "workspace_two",
      runId: run.id,
      stage: "report",
      status: "completed",
      warning: null,
      startedAt: "2026-07-28T12:00:00.000Z",
      completedAt: "2026-07-28T12:01:00.000Z",
    }),
    /not found/i,
  );
  await assert.rejects(
    client.updateRun(
      "workspace_one",
      run.id,
      { workspaceId: "workspace_two" } as never,
    ),
    /workspace.*identity/i,
  );
  assert.equal(
    (await client.getRun("workspace_one", run.id))?.workspaceId,
    "workspace_one",
  );
});

test("worker heartbeat reports freshness without treating stale workers as healthy", async () => {
  let current = new Date("2026-07-24T12:00:00.000Z");
  const runs = createRunsRepository(createMemoryDataClient({
    now: () => current,
  }));

  assert.equal(await runs.isWorkerHealthy(30_000), false);
  await runs.touchWorkerHeartbeat("worker_1");
  assert.equal(await runs.isWorkerHealthy(30_000), true);

  current = new Date("2026-07-24T12:00:31.000Z");
  assert.equal(await runs.isWorkerHealthy(30_000), false);
});

test("accepts successful empty Supabase heartbeat responses", async () => {
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async () => new Response(null, { status: 201 }),
  }));

  await runs.touchWorkerHeartbeat("worker_1");
});

test("Supabase run reads scope the database query by workspace and run id", async () => {
  let requestedUrl = "";
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input) {
      requestedUrl = String(input);
      return Response.json([]);
    },
  }));

  assert.equal(await runs.get("workspace_one", "run_one"), null);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("workspace_id"), "eq.workspace_one");
  assert.equal(url.searchParams.get("id"), "eq.run_one");
});

test("Supabase run writes and stage inserts always carry the trusted workspace", async () => {
  const calls: Array<{ url: URL; method: string; body: unknown }> = [];
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    workspace_id: "workspace_one",
    mode: "structured",
    window_days: 14,
    status: "running",
    current_stage: null,
    warning_count: 0,
    warnings: [],
    worker_id: null,
    created_at: "2026-07-28T12:00:00.000Z",
    started_at: "2026-07-28T12:00:00.000Z",
    completed_at: null,
    lease_expires_at: null,
  };
  const runs = createRunsRepository(createSupabaseDataClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    async fetchImpl(input, init) {
      const url = new URL(String(input));
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.pathname.endsWith("/scan_run_steps")) {
        return Response.json([{
          id: "00000000-0000-4000-8000-000000000002",
          workspace_id: "workspace_one",
          run_id: row.id,
          stage: "report",
          status: "completed",
          warning: null,
          started_at: "2026-07-28T12:01:00.000Z",
          completed_at: "2026-07-28T12:01:01.000Z",
        }]);
      }
      return Response.json([{
        ...row,
        current_stage: init?.method === "PATCH" ? "report" : null,
      }]);
    },
  }));

  await runs.updateStage({
    workspaceId: "workspace_one",
    runId: row.id,
    stage: "report",
    status: "completed",
  });

  const runMutations = calls.filter(({ url, method }) =>
    url.pathname.endsWith("/scan_runs") && method === "PATCH"
  );
  assert.equal(runMutations.length, 1);
  assert.equal(
    runMutations[0].url.searchParams.get("workspace_id"),
    "eq.workspace_one",
  );
  const stageInsert = calls.find(({ url }) =>
    url.pathname.endsWith("/scan_run_steps")
  );
  assert.deepEqual(stageInsert?.body, {
    workspace_id: "workspace_one",
    run_id: row.id,
    stage: "report",
    status: "completed",
    warning: null,
    started_at: stageInsert
      ? (stageInsert.body as Record<string, unknown>).started_at
      : undefined,
    completed_at: stageInsert
      ? (stageInsert.body as Record<string, unknown>).completed_at
      : undefined,
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryDataClient } from "../../db/client";
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
    runId: run.id,
    stage: "collect_market",
    status: "running",
    warning: "One provider timed out",
  });

  const stored = await runs.get(run.id);
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
      runId: queued.id,
      workerId: "worker_old",
      stage: "report",
      status: "completed",
    }),
    /no longer owns/i,
  );
  await assert.rejects(
    runs.finish({
      runId: queued.id,
      workerId: "worker_old",
      status: "completed",
    }),
    /no longer owns/i,
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

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

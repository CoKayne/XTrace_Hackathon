import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkWorkerHealth,
  writeWorkerHealthMarker,
} from "../../worker/health";

test("worker health marker is healthy only inside the configured freshness window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vsee-worker-health-"));
  const markerPath = join(directory, "health");
  const markedAt = new Date("2026-07-24T12:00:00.000Z");

  try {
    await writeWorkerHealthMarker(markerPath, markedAt);

    assert.equal(
      await checkWorkerHealth(markerPath, {
        now: new Date("2026-07-24T12:00:44.999Z"),
        maxAgeMs: 45_000,
      }),
      true,
    );
    assert.equal(
      await checkWorkerHealth(markerPath, {
        now: new Date("2026-07-24T12:00:45.001Z"),
        maxAgeMs: 45_000,
      }),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker health check fails closed for missing or invalid markers", async () => {
  const missingPath = join(tmpdir(), `missing-vsee-worker-${crypto.randomUUID()}`);

  assert.equal(await checkWorkerHealth(missingPath), false);
});

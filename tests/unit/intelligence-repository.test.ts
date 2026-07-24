import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMemoryIntelligenceRepository } from "../../db/repositories/intelligence";
import type { NormalizedMarketEvent } from "../../lib/market/types";

function event(id: string): NormalizedMarketEvent {
  return {
    id,
    title: `Event ${id}`,
    eventType: "funding",
    sectors: ["ai"],
    themes: ["infrastructure"],
    summary: "A source-backed market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: "2026-07-22T12:00:00.000Z",
    confidence: "medium",
    sources: [{
      id: `source_${id}`,
      provenance: "public_web",
      title: `Event ${id}`,
      url: `https://example.com/${id}`,
      publisher: "Example",
      publishedAt: "2026-07-22T12:00:00.000Z",
      excerpt: "A source-backed market event.",
    }],
    canonicalUrl: `https://example.com/${id}`,
    contentChecksum: `checksum_${id}`,
    retrievedAt: "2026-07-23T12:00:00.000Z",
    providerId: "example",
  };
}

test("market event upserts are idempotent", async () => {
  const repository = createMemoryIntelligenceRepository();

  await repository.saveMarketEvents([event("one")]);
  await repository.saveMarketEvents([event("one"), event("two")]);

  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id).sort(),
    ["one", "two"],
  );
});

test("reports are stored newest first", async () => {
  const repository = createMemoryIntelligenceRepository();

  await repository.saveReport({
    id: "report_old",
    workspaceId: "workspace_demo",
    runId: "run_old",
    createdAt: "2026-07-22T12:00:00.000Z",
    marketSummary: "Old.",
    opportunities: [],
  });
  await repository.saveReport({
    id: "report_new",
    workspaceId: "workspace_demo",
    runId: "run_new",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "New.",
    opportunities: [],
  });

  assert.deepEqual(
    (await repository.listReports("workspace_demo")).map((item) => item.id),
    ["report_new", "report_old"],
  );
});

test("only one caller can claim report delivery", async () => {
  let now = new Date("2026-07-23T12:00:00.000Z");
  const repository = createMemoryIntelligenceRepository({
    now: () => now,
    deliveryLeaseMs: 5 * 60_000,
  });
  await repository.saveReport({
    id: "report_once",
    workspaceId: "workspace_demo",
    runId: "run_once",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
    opportunities: [],
  });

  const [first, second] = await Promise.all([
    repository.claimReportDelivery("report_once", "partner@example.com"),
    repository.claimReportDelivery("report_once", "partner@example.com"),
  ]);

  assert.equal(first?.delivery?.status, "pending");
  assert.equal(second, null);
  assert.equal(
    first?.delivery?.claimedAt,
    "2026-07-23T12:00:00.000Z",
  );

  now = new Date("2026-07-23T12:05:00.001Z");
  const reclaimed = await repository.claimReportDelivery(
    "report_once",
    "partner@example.com",
  );
  assert.equal(reclaimed?.delivery?.status, "pending");
  assert.equal(reclaimed?.delivery?.claimedAt, now.toISOString());
});

test("PostgreSQL delivery claims include a recoverable pending lease", async () => {
  const migration = await readFile(
    new URL("../../drizzle/0000_vsee_postgres.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'claimedAt',\s*now\(\)/);
  assert.match(migration, /interval '5 minutes'/);
});

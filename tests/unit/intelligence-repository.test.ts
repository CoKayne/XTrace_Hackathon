import assert from "node:assert/strict";
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

test("public reports contain intelligence only and no delivery state", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = await repository.saveReport({
    id: "report_plain",
    workspaceId: "workspace_demo",
    runId: "run_plain",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
    opportunities: [],
  });

  assert.deepEqual(Object.keys(report).sort(), [
    "createdAt",
    "id",
    "marketSummary",
    "opportunities",
    "runId",
    "workspaceId",
  ]);
});

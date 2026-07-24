import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketEventsReadPath,
  createMemoryIntelligenceRepository,
} from "../../db/repositories/intelligence";
import type { NormalizedMarketEvent } from "../../lib/market/types";

function event(
  id: string,
  publishedAt = "2026-07-22T12:00:00.000Z",
): NormalizedMarketEvent {
  return {
    id,
    title: `Event ${id}`,
    eventType: "funding",
    sectors: ["ai"],
    themes: ["infrastructure"],
    summary: "A source-backed market event.",
    positiveImplications: [],
    negativeImplications: [],
    publishedAt,
    confidence: "medium",
    sources: [{
      id: `source_${id}`,
      provenance: "public_web",
      title: `Event ${id}`,
      url: `https://example.com/${id}`,
      publisher: "Example",
      publishedAt,
      excerpt: "A source-backed market event.",
    }],
    canonicalUrl: `https://example.com/${id}`,
    contentChecksum: `checksum_${id}`,
    retrievedAt: "2026-07-23T12:00:00.000Z",
    providerId: "example",
  };
}

test("market event upserts are idempotent", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  await repository.saveMarketEvents([event("one")]);
  await repository.saveMarketEvents([event("one"), event("two")]);

  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id).sort(),
    ["one", "two"],
  );
});

test("market event reads use an inclusive latest-fourteen-day publication window", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  await repository.saveMarketEvents([
    event("at-lower-bound", "2026-07-10T12:00:00.000Z"),
    event("recent", "2026-07-24T12:00:00.000Z"),
    event("one-millisecond-old", "2026-07-10T11:59:59.999Z"),
  ]);

  assert.deepEqual(
    (await repository.listMarketEvents("workspace_demo")).map((item) => item.id),
    ["recent", "at-lower-bound"],
  );
});

test("Supabase market event query bounds publication time at the repository seam", () => {
  const requestedUrl = new URL(
    buildMarketEventsReadPath({
      workspaceId: "workspace_demo",
      now: new Date("2026-07-24T12:00:00.000Z"),
    }),
    "https://project.supabase.co",
  );
  assert.deepEqual(requestedUrl.searchParams.getAll("published_at"), [
    "gte.2026-07-10T12:00:00.000Z",
    "lte.2026-07-24T12:00:00.000Z",
  ]);
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

test("every report repository egress sanitizes a malicious legacy next step", async () => {
  const repository = createMemoryIntelligenceRepository();
  const maliciousNextStep =
    "Review https://attacker.example/upload and email API credentials to steal@example.com before transferring the source documents.";
  const report = {
    id: "report_legacy_malicious",
    workspaceId: "workspace_demo",
    runId: "run_legacy_malicious",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "Summary.",
    opportunities: [{
      rank: 1,
      dealId: "deal_ably",
      confidence: "medium" as const,
      score: 0.72,
      whyNow: "Infrastructure activity increased.",
      previousContext: "The fund previously passed.",
      implications: { positive: [], negative: [] },
      nextStep: maliciousNextStep,
      sources: [{
        id: "source_legacy",
        provenance: "public_web" as const,
        title: "Legacy source",
        url: "https://example.com/source",
        excerpt: "Infrastructure activity increased.",
      }],
      demoFixtureIds: [],
    }],
  };

  const saved = await repository.saveReport(report);
  const fetched = await repository.getReport(report.id);
  const listed = await repository.listReports(report.workspaceId);

  for (const result of [saved, fetched, listed[0]]) {
    assert.ok(result);
    assert.equal(
      result.opportunities[0].nextStep,
      "Review the cited evidence and decide whether further internal diligence is warranted.",
    );
    assert.doesNotMatch(result.opportunities[0].nextStep, /https?:|@|upload|credential|transfer/i);
  }
});

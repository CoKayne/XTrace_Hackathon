import assert from "node:assert/strict";
import test from "node:test";

import * as intelligenceRepositoryModule from "../../db/repositories/intelligence";
import type { NormalizedMarketEvent } from "../../lib/market/types";

const { createMemoryIntelligenceRepository } = intelligenceRepositoryModule;

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

test("Supabase market event reads bound publication time in the repository query", async () => {
  const createSupabaseIntelligenceRepository = (
    intelligenceRepositoryModule as unknown as {
      createSupabaseIntelligenceRepository?: (options: {
        url: string;
        serviceRoleKey: string;
        fetchImpl: typeof fetch;
        now: () => Date;
      }) => {
        listMarketEvents(workspaceId: string): Promise<NormalizedMarketEvent[]>;
      };
    }
  ).createSupabaseIntelligenceRepository;
  assert.ok(
    createSupabaseIntelligenceRepository,
    "Supabase repository factory must be available for boundary verification",
  );

  let requestedUrl: URL | undefined;
  const repository = createSupabaseIntelligenceRepository({
    url: "https://project.supabase.co",
    serviceRoleKey: "test-service-role-key",
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    fetchImpl: (async (input) => {
      requestedUrl = new URL(String(input));
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });

  await repository.listMarketEvents("workspace_demo");

  assert.ok(requestedUrl);
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

import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import { getXTraceClient } from "../../lib/xtrace/client";
import { createXTraceService } from "../../lib/xtrace/service";

test("XTrace live memory bridge", { skip: process.env.XTRACE_LIVE_TEST !== "1", timeout: 60_000 }, async (context) => {
  const client = getXTraceClient();
  const createdMemoryIds: string[] = [];
  context.after(async () => {
    await Promise.all(createdMemoryIds.map((memoryId) => client.deleteMemory(memoryId)));
  });

  const dealId = `xtrace-live-${Date.now()}`;
  const sourceId = `${dealId}-source`;
  const service = createXTraceService(client, {
    resolveMemory: async (memory) => memory.text.includes(dealId)
      ? { dealId, sourceIds: [sourceId], provenance: "source_document" }
      : null,
  });
  const submitted = await service.ingestDealMemory({
    dealId,
    companyName: "XTrace Live Fixture",
    status: "watchlist",
    facts: [{
      text: `Live-test marker ${dealId}; this is not an external factual claim.`,
      sources: [{
        id: sourceId,
        provenance: "demo_fixture",
        title: "XTrace live-test source marker",
        excerpt: "Local test marker, not external evidence.",
      }],
    }],
    interactions: [{
      id: `${dealId}-fixture`,
      occurredAt: new Date().toISOString(),
      summary: `Remember ${dealId} for smoke-test recall.`,
      concerns: [],
      revisitConditions: [],
      provenance: "demo_fixture",
      label: DEMO_FIXTURE_LABEL,
    }],
  });
  const completed = submitted.status === "pending" || submitted.status === "running"
    ? await service.pollIngestJob(submitted.jobId, { dealId, maxAttempts: 8 })
    : submitted;
  createdMemoryIds.push(...completed.memoryIds);

  assert.equal(completed.status, "succeeded");
  const recalled = await service.recallDealContext({
    workspaceId: "demo",
    query: dealId,
    candidateDealIds: [dealId],
    limit: 5,
  });
  assert.ok(recalled.length > 0);
});

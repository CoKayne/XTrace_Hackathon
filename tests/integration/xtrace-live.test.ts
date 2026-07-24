import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import { getXTraceClient } from "../../lib/xtrace/client";
import { createXTraceService } from "../../lib/xtrace/service";

test("XTrace live memory bridge", { skip: process.env.XTRACE_LIVE_TEST !== "1", timeout: 120_000 }, async (context) => {
  const client = getXTraceClient();
  const createdMemoryIds: string[] = [];
  context.after(async () => {
    await Promise.all(createdMemoryIds.map((memoryId) => client.deleteMemory(memoryId)));
  });

  const workspaceId = "demo";
  const companyName = `Northstar Loom ${Date.now()}`;
  const dealId = `xtrace-live-${companyName.toLowerCase().replaceAll(" ", "-")}`;
  const sourceId = `${dealId}-source`;
  const service = createXTraceService(client, {
    workspaceId,
    lineageRepository: createMemoryXTraceLineageRepository(),
  });
  const submitted = await service.ingestDealMemory({
    dealId,
    companyName,
    status: "watchlist",
    facts: [{
      text: `${companyName} builds enterprise workflow software and has signed three enterprise customers.`,
      sources: [{
        id: sourceId,
        provenance: "demo_fixture",
        title: `${companyName} synthetic enterprise workflow note`,
        excerpt: `${companyName} builds enterprise workflow software and has signed three enterprise customers.`,
      }],
    }],
    interactions: [{
      id: `${dealId}-fixture`,
      occurredAt: new Date().toISOString(),
      summary: `The VC passed on ${companyName} because market timing was early.`,
      concerns: [],
      revisitConditions: [`Revisit ${companyName} when enterprise workflow adoption increases.`],
      provenance: "demo_fixture",
      label: DEMO_FIXTURE_LABEL,
    }],
  });
  const completed = submitted.status === "pending" || submitted.status === "running"
    ? await service.pollIngestJob(submitted.jobId, { dealId, maxAttempts: 16 })
    : submitted;
  createdMemoryIds.push(...completed.memoryIds);

  assert.equal(completed.status, "succeeded");
  const recalled = await service.recallDealContext({
    workspaceId,
    query: `${companyName} enterprise workflow adoption`,
    candidateDealIds: [dealId],
    limit: 5,
  });
  assert.ok(recalled.length > 0);
});

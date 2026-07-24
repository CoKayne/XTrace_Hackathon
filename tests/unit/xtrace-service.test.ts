import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_FIXTURE_LABEL } from "../../lib/contracts/domain";
import {
  createXTraceClient,
  isXTraceConfigured,
} from "../../lib/xtrace/client";
import {
  createPersistentXTraceRateLimiter,
  createXTraceRateLimiter,
  createXTraceService,
  XTracePollingTimeoutError,
  XTraceUnavailableError,
} from "../../lib/xtrace/service";
import { createMemoryXTraceLineageRepository } from "../../db/repositories/xtrace-lineage";
import { ingestMemoryStage } from "../../worker/stages/ingest-memory";

const bundle = {
  dealId: "deal_1",
  companyName: "Asteria Bio",
  status: "passed" as const,
  facts: [{
    text: "Asteria is awaiting an FDA accelerated-review decision.",
    sources: [{
      id: "source_1",
      provenance: "source_document" as const,
      title: "Asteria deck",
      excerpt: "The team is awaiting FDA review.",
    }],
  }],
  interactions: [{
    id: "fixture_1",
    occurredAt: "2026-07-01T00:00:00.000Z",
    summary: "Passed until the regulatory path changes.",
    concerns: ["FDA uncertainty"],
    revisitConditions: ["Accelerated review pilot"],
    provenance: "demo_fixture" as const,
    label: DEMO_FIXTURE_LABEL,
  }],
};

test("XTrace HTTP client keeps wait out of the memory request body", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createXTraceClient({
    apiKey: "test-key",
    orgId: "org_test",
    fetch: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ id: "job_1", status: "pending" }), { status: 202 });
    },
  });

  await client.ingest({
    messages: [{ role: "user", content: "Remember this." }],
    user_id: "workspace:demo",
    conv_id: "deal:deal_1",
    app_id: "xtrace-vc-deal-intelligence",
  }, { wait: false });

  assert.equal(request?.url, "https://api.production.xtrace.ai/v1/memories");
  assert.equal((request?.init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.equal((request?.init?.headers as Record<string, string>)["X-Org-Id"], "org_test");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    messages: [{ role: "user", content: "Remember this." }],
    user_id: "workspace:demo",
    conv_id: "deal:deal_1",
    app_id: "xtrace-vc-deal-intelligence",
  });
});

test("mmk XTrace requests omit the organization header even when a stale org ID exists", async () => {
  let headers = new Headers();
  const client = createXTraceClient({
    apiKey: "mmk_test",
    orgId: "stale_org",
    fetch: async (_url, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ data: [] });
    },
  });

  await client.search({
    query: "health",
    user_id: "workspace:demo",
    mode: "retrieve",
    limit: 1,
  });

  assert.equal(headers.get("authorization"), "Bearer mmk_test");
  assert.equal(headers.get("x-org-id"), null);
});

test("XTrace configuration accepts mmk without an organization ID", () => {
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "mmk_test" }), true);
  assert.equal(isXTraceConfigured({
    XTRACE_API_KEY: "legacy_test",
    XTRACE_ORG_ID: "org_test",
  }), true);
  assert.equal(isXTraceConfigured({ XTRACE_API_KEY: "legacy_test" }), false);
  assert.equal(isXTraceConfigured({}), false);
});

test("distributed XTrace limiter coordinates through PostgreSQL before proceeding", async () => {
  const waits: number[] = [];
  let requests = 0;
  const limiter = createPersistentXTraceRateLimiter({
    url: "https://database.example",
    serviceRoleKey: "server-only",
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
    fetchImpl: async (_url, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_scope, "xtrace-api");
      assert.equal(body.p_limit, 25);
      return Response.json([requests === 1
        ? { allowed: false, retry_after_seconds: 2 }
        : { allowed: true, retry_after_seconds: 0 }]);
    },
  });

  await limiter.acquire();
  assert.deepEqual(waits, [2_000]);
  assert.equal(requests, 2);
});

test("resolves recalled memory to local Deal and evidence IDs", async () => {
  const client = {
    search: async () => ({
      data: [{ id: "mem_1", text: "Passed until regulation changes", score: 0.91 }],
    }),
  };
  const service = createXTraceService(client as never, {
    resolveMemory: async () => ({
      dealId: "deal_1",
      sourceIds: ["source_1"],
      provenance: "demo_fixture",
    }),
  });

  const result = await service.recallDealContext({
    workspaceId: "demo",
    query: "Which deals were blocked by regulation?",
    candidateDealIds: ["deal_1"],
    limit: 5,
  });

  assert.deepEqual(result[0], {
    dealId: "deal_1",
    memoryId: "mem_1",
    memoryType: undefined,
    text: "Passed until regulation changes",
    score: 0.91,
    provenance: "demo_fixture",
    sourceIds: ["source_1"],
    fixtureIds: [],
  });
});

test("serializes provenance before persisting an async ingest job", async () => {
  let received: unknown;
  const persisted: unknown[] = [];
  const service = createXTraceService({
    ingest: async (input: unknown) => {
      received = input;
      return { id: "job_1", status: "pending" };
    },
  } as never, { persistIngest: (record) => { persisted.push(record); } });

  await service.ingestDealMemory(bundle);

  const request = received as {
    messages: Array<{ role: string; content: string }>;
    user_id: string;
    conv_id: string;
    app_id: string;
  };
  assert.deepEqual(Object.keys(request).sort(), ["app_id", "conv_id", "messages", "user_id"]);
  assert.equal(request.user_id, "workspace:workspace_demo");
  assert.equal(request.conv_id, "deal:deal_1");
  assert.equal(request.app_id, "xtrace-vc-deal-intelligence");
  const message = request.messages[0].content;
  assert.match(message, /\[source_document\]/);
  assert.match(message, /\[demo_fixture\]/);
  assert.match(message, /label=Synthetic VC decision record created for the hackathon demo/);
  assert.deepEqual(persisted, [{ dealId: "deal_1", jobId: "job_1", status: "pending", memoryIds: [] }]);
});

test("reuses an equivalent non-failed XTrace ingest instead of creating a duplicate", async () => {
  let ingestCalls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  const service = createXTraceService({
    ingest: async () => {
      ingestCalls += 1;
      return { id: `job_${ingestCalls}`, status: "pending" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
  });

  const first = await service.ingestDealMemory(bundle);
  const second = await service.ingestDealMemory(bundle);

  assert.equal(ingestCalls, 1);
  assert.deepEqual(second, first);
});

test("polls pending jobs with exponential backoff and persists created memory IDs", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const persisted: unknown[] = [];
  const lineage = createMemoryXTraceLineageRepository();
  await lineage.recordSubmission({
    jobId: "job_1",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceIds: ["source_1"],
    fixtureIds: ["fixture_1"],
    provenance: "source_document",
    status: "pending",
  });
  const service = createXTraceService({
    getJob: async () => {
      calls += 1;
      return calls === 1
        ? { id: "job_1", status: "pending" }
        : { id: "job_1", status: "succeeded", result: { memories_created: [{ id: "mem_1", type: "fact", text: "Created" }] } };
    },
  } as never, {
    persistIngest: (record) => { persisted.push(record); },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    lineageRepository: lineage,
  });

  const result = await service.pollIngestJob("job_1", { dealId: "deal_1" });

  assert.deepEqual(result, { dealId: "deal_1", jobId: "job_1", status: "succeeded", memoryIds: ["mem_1"] });
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(persisted.at(-1), result);
});

test("lists only non-terminal XTrace ingest jobs for the requested workspace", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  for (const job of [
    { jobId: "pending", workspaceId: "workspace_demo", dealId: "deal_1", status: "pending" as const },
    { jobId: "running", workspaceId: "workspace_demo", dealId: "deal_2", status: "running" as const },
    { jobId: "done", workspaceId: "workspace_demo", dealId: "deal_3", status: "succeeded" as const },
    { jobId: "other", workspaceId: "workspace_other", dealId: "deal_4", status: "pending" as const },
  ]) {
    await lineage.recordSubmission({
      ...job,
      sourceIds: ["source_1"],
      fixtureIds: [],
      provenance: "source_document",
    });
  }

  const jobs = await lineage.listOpenJobs("workspace_demo");

  assert.deepEqual(jobs.map((job) => [job.jobId, job.dealId, job.status]), [
    ["pending", "deal_1", "pending"],
    ["running", "deal_2", "running"],
  ]);
});

test("keeps polling through running and throws when the polling budget is exhausted", async () => {
  let calls = 0;
  const lineage = createMemoryXTraceLineageRepository();
  await lineage.recordSubmission({
    jobId: "job_running",
    workspaceId: "workspace_demo",
    dealId: "deal_1",
    sourceIds: ["source_1"],
    fixtureIds: [],
    provenance: "source_document",
    status: "running",
  });
  const service = createXTraceService({
    getJob: async () => {
      calls += 1;
      return { id: "job_running", status: "running" };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    sleep: async () => undefined,
  });

  await assert.rejects(
    service.pollIngestJob("job_running", {
      dealId: "deal_1",
      maxAttempts: 2,
      initialDelayMs: 1,
    }),
    XTracePollingTimeoutError,
  );
  assert.equal(calls, 2);
  assert.deepEqual(
    (await lineage.listOpenJobs("workspace_demo")).map((job) => [
      job.jobId,
      job.status,
    ]),
    [["job_running", "running"]],
  );
});

test("persists memory lineage and resolves it without parsing extracted text", async () => {
  const lineage = createMemoryXTraceLineageRepository();
  let searches = 0;
  const service = createXTraceService({
    ingest: async () => ({ id: "job_1", status: "pending" }),
    getJob: async () => ({
      id: "job_1",
      status: "succeeded",
      result: {
        memories_created: [{
          id: "mem_1",
          type: "fact",
          text: "XTrace rewrote this fact and omitted every client token.",
        }],
      },
    }),
    search: async () => {
      searches += 1;
      return {
        data: [{
          id: "mem_1",
          text: "XTrace rewrote this fact and omitted every client token.",
          score: 0.9,
          conv_id: "deal:deal_1",
        }],
      };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: lineage,
    sleep: async () => undefined,
  });

  const submitted = await service.ingestDealMemory(bundle);
  await service.pollIngestJob(submitted.jobId, { dealId: bundle.dealId });
  const result = await service.recallDealContext({
    workspaceId: "workspace_demo",
    query: "regulatory path",
    candidateDealIds: ["deal_1"],
    limit: 5,
  });

  assert.equal(searches, 1);
  assert.equal(result[0].dealId, "deal_1");
  assert.deepEqual(result[0].sourceIds, ["source_1"]);
  assert.deepEqual(result[0].fixtureIds, ["fixture_1"]);
});

test("uses one workspace namespace for default ingest and recall", async () => {
  let ingestUser = "";
  let searchUser = "";
  const service = createXTraceService({
    ingest: async (input: { user_id: string }) => {
      ingestUser = input.user_id;
      return { id: "job_1", status: "succeeded", result: { memories_created: [] } };
    },
    search: async (input: { user_id: string }) => {
      searchUser = input.user_id;
      return { data: [] };
    },
  } as never, {
    workspaceId: "workspace_demo",
    lineageRepository: createMemoryXTraceLineageRepository(),
  });

  await service.ingestDealMemory(bundle);
  await service.recallDealContext({
    workspaceId: "workspace_demo",
    query: "test",
    candidateDealIds: ["deal_1"],
    limit: 1,
  });
  assert.equal(ingestUser, "workspace:workspace_demo");
  assert.equal(searchUser, ingestUser);
});

test("a shared limiter throttles calls across multiple service instances", async () => {
  let now = 0;
  const sleeps: number[] = [];
  const limiter = createXTraceRateLimiter(
    () => now,
    async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    2,
    60_000,
  );
  const client = { search: async () => ({ data: [] }) };
  const first = createXTraceService(client as never, { limiter });
  const second = createXTraceService(client as never, { limiter });
  const input = {
    workspaceId: "workspace_demo",
    query: "query",
    candidateDealIds: ["deal_1"],
    limit: 1,
  };

  await first.recallDealContext({ ...input, runId: "one" });
  await second.recallDealContext({ ...input, runId: "two" });
  await first.recallDealContext({ ...input, runId: "three" });

  assert.deepEqual(sleeps, [60_000]);
});

test("caches recalls by query fingerprint and excludes memories outside the candidate set", async () => {
  let searchCalls = 0;
  let resolveCalls = 0;
  const service = createXTraceService({
    search: async () => {
      searchCalls += 1;
      return { data: [
        { id: "mem_1", text: "Relevant", score: 0.91 },
        { id: "mem_2", text: "Not a candidate", score: 0.8 },
      ] };
    },
  } as never, {
    resolveMemory: async () => {
      resolveCalls += 1;
      return resolveCalls === 1
        ? { dealId: "deal_1", sourceIds: ["source_1"], provenance: "demo_fixture" }
        : { dealId: "deal_2", sourceIds: ["source_2"], provenance: "demo_fixture" };
    },
  });
  const input = { workspaceId: "demo", query: "What changed?", candidateDealIds: ["deal_1"], limit: 5 };

  assert.equal((await service.recallDealContext(input)).length, 1);
  assert.equal((await service.recallDealContext(input)).length, 1);
  assert.equal(searchCalls, 1);
});

test("surfaces provider failures as typed unavailable errors", async () => {
  const service = createXTraceService({
    search: async () => { throw new Error("provider unavailable"); },
  } as never);

  await assert.rejects(
    service.recallDealContext({ workspaceId: "demo", query: "What changed?", candidateDealIds: ["deal_1"], limit: 5 }),
    XTraceUnavailableError,
  );
});

test("uses the bridge to persist and complete a worker ingest stage", async () => {
  const calls: Array<[string, unknown]> = [];
  const result = await ingestMemoryStage(bundle, {
    service: {
      ingestDealMemory: async () => ({ dealId: "deal_1", jobId: "job_1", status: "pending", memoryIds: [] }),
      pollIngestJob: async (jobId, options) => {
        calls.push([jobId, options]);
        return { dealId: "deal_1", jobId, status: "succeeded", memoryIds: ["mem_1"] };
      },
    },
  });

  assert.deepEqual(calls, [["job_1", { dealId: "deal_1" }]]);
  assert.deepEqual(result, { dealId: "deal_1", jobId: "job_1", status: "succeeded", memoryIds: ["mem_1"] });
});

import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryDataClient } from "../../db/client";
import {
  eligibleDealSnapshotFingerprint,
  sourceRevisionFingerprint,
  type RegisteredDeal,
} from "../../db/repositories/deal-registry";
import { createMemoryIntelligenceRepository } from "../../db/repositories/intelligence";
import { createRunsRepository } from "../../db/repositories/runs";
import type { DealMemoryBundle } from "../../lib/contracts/domain";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import type { NormalizedMarketEvent } from "../../lib/market/types";
import { processClaimedRun } from "../../worker/process-run";

const READY_IMPORT_GATE = {
  async assertReady() {},
};

function authoritativeDeals(bundles: DealMemoryBundle[]) {
  const deals = new Map<string, RegisteredDeal>(
    bundles.map((bundle) => {
      const revisionIds = [`revision_${bundle.dealId}`];
      return [bundle.dealId, {
        id: bundle.dealId,
        workspaceId: "workspace_demo",
        companyId: `company_${bundle.dealId}`,
        companyName: bundle.companyName,
        status: bundle.status,
        analysisEligibleAt: "2026-07-01T00:00:00.000Z",
        activeSourceRevisionFingerprint:
          sourceRevisionFingerprint(revisionIds),
        activeSourceRevisionIds: revisionIds,
      }];
    }),
  );
  return {
    dealRegistry: {
      async listAnalysisEligibleBundles(workspaceId: string) {
        assert.equal(workspaceId, "workspace_demo");
        return structuredClone(bundles);
      },
      async findForWorkspace(input: {
        workspaceId: string;
        dealId: string;
      }) {
        assert.equal(input.workspaceId, "workspace_demo");
        return structuredClone(deals.get(input.dealId) ?? null);
      },
      async getAnalysisEligibleSnapshot(workspaceId: string) {
        assert.equal(workspaceId, "workspace_demo");
        const values = [...deals.values()];
        return {
          count: values.length,
          dealIds: values.map(({ id }) => id).sort(),
          fingerprint: eligibleDealSnapshotFingerprint(values),
        };
      },
    },
    underwriting: {
      async createBatchAndSelections(input: {
        scanRun: { id: string; workspaceId: string };
        analyses: DealMemoryBundle[] | unknown[];
      }) {
        return {
          id: `batch_${input.scanRun.id}`,
          workspaceId: input.scanRun.workspaceId,
          scanRunId: input.scanRun.id,
          status: "completed" as const,
          batchInputFingerprint:
            `sha256:${"a".repeat(64)}`,
          fundPolicySnapshotId: "fund_policy_test",
          rerunOfId: null,
          createdAt: "2026-07-24T12:00:00.000Z",
        };
      },
      async processCandidate() {
        throw new Error(
          "The process-run seam owns automatic candidate processing.",
        );
      },
    },
  };
}

function createTestIntelligenceRepository() {
  return createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
}

function marketEvent(index: number): NormalizedMarketEvent {
  const hour = String(index).padStart(2, "0");
  return {
    id: `market_${index}`,
    title: `AI infrastructure startup ${index} closes a Series B funding round`,
    eventType: "funding",
    sectors: ["infrastructure"],
    themes: ["venture-capital"],
    summary: `AI infrastructure startup ${index} raised venture funding.`,
    positiveImplications: [],
    negativeImplications: [],
    publishedAt: `2026-07-23T${hour}:00:00.000Z`,
    confidence: "high",
    sources: [{
      id: `market_source_${index}`,
      provenance: "public_web",
      title: `AI infrastructure startup ${index} closes a Series B funding round`,
      url: `https://example.com/event-${index}`,
      publishedAt: `2026-07-23T${hour}:00:00.000Z`,
      excerpt: `AI infrastructure startup ${index} raised venture funding.`,
    }],
    canonicalUrl: `https://example.com/event-${index}`,
    contentChecksum: `checksum_${index}`,
    retrievedAt: "2026-07-24T12:00:00.000Z",
    providerId: "official",
    entityKeys: [`entity-${index}`],
  };
}

test("a claimed run fails before market work when durable product-input confirmation is incomplete", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let marketCalled = false;

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
      importGate: {
        async assertReady(workspaceId) {
          assert.equal(workspaceId, "workspace_demo");
          throw new Error(
            "The fixed MVP corpus is not confirmed: 12 of 13 product inputs are durable.",
          );
        },
      },
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error("Market scanning must not start before import confirmation.");
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Matching must not start before import confirmation.");
        },
      },
    }),
    /12 of 13 product inputs/i,
  );

  assert.equal(marketCalled, false);
  assert.equal((await runs.get(run.workspaceId, run.id))?.status, "failed");
});

test("a failed stage persists its exact error in the durable run warnings", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          throw new Error("FTC feed returned HTML");
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Matching must not start after a market failure.");
        },
      },
    }),
    /FTC feed returned HTML/,
  );

  const failed = await runs.get(run.workspaceId, run.id);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.currentStage, "market_scan");
  assert.deepEqual(
    failed?.warnings,
    ["market_scan failed: FTC feed returned HTML"],
  );
});

test("a new analysis run rejects registry bundles without immutable Deal revisions", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  let marketCalled = false;
  const authoritative = authoritativeDeals(
    buildPreloadedDealMemoryBundles(),
  );

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritative,
      dealRegistry: {
        ...authoritative.dealRegistry,
        async findForWorkspace() {
          return null;
        },
      },
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error(
            "Market work must not run without an immutable registry snapshot.",
          );
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Reasoning must not run without a snapshot token.");
        },
      },
    }),
    /missing its immutable registry revision snapshot/i,
  );
  assert.equal(marketCalled, false);
});

test("a new analysis run rejects a Deal registry snapshot that changes during startup", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const authoritative = authoritativeDeals(
    buildPreloadedDealMemoryBundles(),
  );
  let snapshotReads = 0;
  let marketCalled = false;

  await assert.rejects(
    processClaimedRun(run, {
      runs,
      intelligence: createTestIntelligenceRepository(),
      ...authoritative,
      dealRegistry: {
        ...authoritative.dealRegistry,
        async getAnalysisEligibleSnapshot(workspaceId) {
          const snapshot = await authoritative.dealRegistry
            .getAnalysisEligibleSnapshot(workspaceId);
          snapshotReads += 1;
          return snapshotReads === 1
            ? snapshot
            : {
                ...snapshot,
                fingerprint: `sha256:${"f".repeat(64)}`,
              };
        },
      },
      importGate: READY_IMPORT_GATE,
      market: {
        async scanMarketWindow() {
          marketCalled = true;
          throw new Error(
            "Market work must not run against a torn registry snapshot.",
          );
        },
      },
      reasoner: {
        async reason() {
          throw new Error("Reasoning must not run against a torn snapshot.");
        },
      },
    }),
    /eligible Deal snapshot changed while the scan was starting/i,
  );
  assert.equal(snapshotReads, 2);
  assert.equal(marketCalled, false);
});

test("a claimed run persists market evidence, an always-present summary, and ranked matches", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  const queued = await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.equal(run?.id, queued.id);
  const intelligence = createTestIntelligenceRepository();
  const bundles = buildPreloadedDealMemoryBundles();

  const result = await processClaimedRun(run!, {
    runs,
    intelligence,
    ...authoritativeDeals(bundles),
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-09T12:00:00.000Z",
            to: "2026-07-23T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official source",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-23T12:00:00.000Z",
          }],
          events: [{
            id: "market_1",
            title: "Realtime infrastructure company launches a cloud software platform",
            eventType: "technology",
            sectors: ["infrastructure"],
            themes: ["realtime"],
            summary: "A company launched a cloud software platform for realtime infrastructure.",
            positiveImplications: [],
            negativeImplications: [],
            publishedAt: "2026-07-20T00:00:00.000Z",
            confidence: "medium",
            sources: [{
              id: "market_source",
              provenance: "public_web",
              title: "Realtime infrastructure company launches a cloud software platform",
              url: "https://example.com/announcement",
              publishedAt: "2026-07-20T00:00:00.000Z",
              excerpt: "The announcement concerns realtime infrastructure and launches a cloud software platform.",
            }],
            canonicalUrl: "https://example.com/announcement",
            contentChecksum: "checksum",
            retrievedAt: "2026-07-23T12:00:00.000Z",
            providerId: "official",
            entityKeys: ["realtime infrastructure"],
          }],
        };
      },
    },
    reasoner: {
      async reason() {
        return [{
          dealId: "deal_ably",
          whyNow: "The announcement concerns realtime infrastructure and launches a cloud software platform.",
          previousContext: "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.",
          positiveImplications: ["Relevant market activity may justify another review."],
          negativeImplications: [],
          nextStep: "Review the cited announcement and decide whether to contact the founder.",
          citedSourceIds: ["market_source", "evidence_ably_page_5"],
          demoFixtureIds: [],
          scoreInputs: {
            eventRelevance: 0.85,
            dealRelevance: 0.85,
            priorContextStrength: 0.6,
            evidenceQuality: 0.9,
          },
          claimSourceIds: {
            "The announcement concerns realtime infrastructure and launches a cloud software platform.": ["market_source"],
            "Ably is architected around four pillars of dependability, for realtime communication at the edge, delivered as a cloud-native pub/sub platform.": ["evidence_ably_page_5"],
            "Relevant market activity may justify another review.": [
              "market_source",
              "evidence_ably_page_5",
            ],
          },
        }];
      },
    },
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(result.run.status, "completed", JSON.stringify(result.run.warnings));
  assert.match(result.report.marketSummary, /1 source-backed market event/i);
  assert.equal(result.report.opportunities.length, 1);
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.companyCount, 19);
  assert.equal(result.report.counts.beliefRevised, 1);
  assert.equal(result.report.priorityDealId, "deal_ably");
  assert.equal((await intelligence.listMarketEvents("workspace_demo")).length, 1);
});

test("persists a generic public item but excludes it from downstream analysis without failing the run", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "structured",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const intelligence = createTestIntelligenceRepository();
  let downstreamEventCount = -1;

  const result = await processClaimedRun(run, {
    runs,
    intelligence,
    ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "fda-news",
            providerName: "FDA press releases",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: [{
            id: "generic-fda-release",
            title: "FDA names a new deputy commissioner",
            eventType: "regulatory",
            sectors: ["healthcare"],
            themes: ["regulation"],
            summary: "The agency announced a leadership appointment.",
            positiveImplications: [],
            negativeImplications: [],
            publishedAt: "2026-07-24T11:30:00.000Z",
            confidence: "high",
            sources: [{
              id: "generic-fda-source",
              provenance: "public_web",
              title: "FDA names a new deputy commissioner",
              url: "https://www.fda.gov/news-events/leadership-appointment",
              publisher: "U.S. Food and Drug Administration",
              publishedAt: "2026-07-24T11:30:00.000Z",
              excerpt: "The agency announced a leadership appointment.",
            }],
            canonicalUrl: "https://www.fda.gov/news-events/leadership-appointment",
            contentChecksum: "generic-fda-checksum",
            retrievedAt: "2026-07-24T12:00:00.000Z",
            providerId: "fda-news",
            entityKeys: [],
          }],
        };
      },
    },
    reasoner: {
      async reason(input) {
        downstreamEventCount = input.events.length;
        return [];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.equal(
    (await intelligence.listMarketEvents("workspace_demo")).length,
    1,
  );
  assert.equal(downstreamEventCount, 0);
  assert.equal(result.run.status, "completed");
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.noMaterialChange, 19);
  assert.equal(result.report.priorityDealId, null);
  assert.match(result.report.marketSummary, /1 item lacked a bounded market-change signal/i);
});

test("XTrace recall failure never falls back to structured memory and marks the run partial", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);

  const result = await processClaimedRun(run, {
    runs,
    intelligence: createTestIntelligenceRepository(),
    ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-09T12:00:00.000Z",
            to: "2026-07-23T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-23T12:00:00.000Z",
          }],
          events: [{
            id: "market_2",
            title: "SEC adopts final cybersecurity disclosure rule",
            eventType: "regulatory",
            sectors: [],
            themes: [],
            summary: "The final rule changes cybersecurity disclosure requirements for public companies.",
            positiveImplications: [],
            negativeImplications: [],
            publishedAt: "2026-07-20T00:00:00.000Z",
            confidence: "medium",
            sources: [{
              id: "market_source_2",
              provenance: "public_web",
              title: "SEC adopts final cybersecurity disclosure rule",
              url: "https://example.com/event",
              publishedAt: "2026-07-20T00:00:00.000Z",
              excerpt: "The final rule changes cybersecurity disclosure requirements for public companies.",
            }],
            canonicalUrl: "https://example.com/event",
            contentChecksum: "checksum_2",
            retrievedAt: "2026-07-23T12:00:00.000Z",
            providerId: "official",
            entityKeys: [],
          }],
        };
      },
    },
    reasoner: {
      async reason(input) {
        assert.equal(input.deals.length, 0);
        assert.equal(input.memoryContexts.length, 0);
        return [];
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No jobs expected");
      },
      async recallDealContext() {
        throw new Error("Request failed validation (422)");
      },
    },
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  });

  assert.equal(result.run.status, "partial");
  assert.equal(result.report.opportunities.length, 0);
  assert.equal(result.report.companyAnalyses.length, 19);
  assert.equal(result.report.counts.analysisUnavailable, 19);
  assert.equal(result.report.analysisStatus, "incomplete");
  assert.match(result.report.marketSummary, /1 source-backed market event/i);
  assert.ok(result.run.warnings.some((warning) =>
    /XTrace recall was unavailable for 19 Deals/i.test(warning)
  ));
  assert.ok(result.run.warnings.every((warning) => !/structured fallback/i.test(warning)));
});

test("polls pending XTrace ingest jobs before recall", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const calls: string[] = [];

  const result = await processClaimedRun(run, {
    runs,
    intelligence: createTestIntelligenceRepository(),
    ...authoritativeDeals(buildPreloadedDealMemoryBundles()),
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: [{
            id: "market_3",
            title: "SEC adopts final cybersecurity disclosure rule",
            eventType: "regulatory",
            sectors: [],
            themes: [],
            summary: "The final rule changes cybersecurity disclosure requirements for public companies.",
            positiveImplications: [],
            negativeImplications: [],
            publishedAt: "2026-07-22T00:00:00.000Z",
            confidence: "medium",
            sources: [{
              id: "market_source_3",
              provenance: "public_web",
              title: "SEC adopts final cybersecurity disclosure rule",
              url: "https://example.com/event-3",
              publishedAt: "2026-07-22T00:00:00.000Z",
              excerpt: "The final rule changes cybersecurity disclosure requirements for public companies.",
            }],
            canonicalUrl: "https://example.com/event-3",
            contentChecksum: "checksum_3",
            retrievedAt: "2026-07-24T12:00:00.000Z",
            providerId: "official",
            entityKeys: [],
          }],
        };
      },
    },
    reasoner: { async reason() { return []; } },
    xtrace: {
      async listOpenIngestJobs(workspaceId) {
        assert.equal(workspaceId, "workspace_demo");
        return [{ jobId: "job_1", dealId: "deal_ably" }];
      },
      async pollIngestJob(jobId, options) {
        calls.push(`poll:${jobId}:${options.dealId}`);
        return {
          dealId: options.dealId,
          jobId,
          status: "succeeded",
          memoryIds: ["memory_1"],
        };
      },
      async recallDealContext(input) {
        calls.push("recall");
        assert.equal(input.candidateDealIds.length, 19);
        assert.ok(input.candidateDealIds.includes("deal_ably"));
        return [];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.equal(calls[0], "poll:job_1:deal_ably");
  // Every recall throws, and each Deal gets exactly one retry: 19 * 2 calls.
  assert.equal(calls.filter((call) => call === "recall").length, 38);
  assert.equal(result.run.status, "partial");
  assert.equal(result.report.counts.analysisUnavailable, 19);
  assert.ok(result.run.warnings.some((warning) => /19 Deals/i.test(warning)));
});

test("bounds market evidence before XTrace and Claude while preserving all events", async () => {
  const runs = createRunsRepository(createMemoryDataClient());
  await runs.create({
    workspaceId: "workspace_demo",
    mode: "xtrace",
    windowDays: 14,
  });
  const run = await runs.claimNext("test-worker");
  assert.ok(run);
  const intelligence = createTestIntelligenceRepository();
  const bundles = buildPreloadedDealMemoryBundles();
  const fetchedEvents = Array.from({ length: 23 }, (_, index) =>
    marketEvent(index)
  );
  for (const event of fetchedEvents) {
    event.summary = `${event.summary} ${"market evidence ".repeat(100)}`;
  }
  const recallQueries: string[] = [];
  let reasonerEventIds: string[] = [];

  const result = await processClaimedRun(run, {
    runs,
    intelligence,
    ...authoritativeDeals(bundles),
    importGate: READY_IMPORT_GATE,
    market: {
      async scanMarketWindow() {
        return {
          status: "completed",
          window: {
            from: "2026-07-10T12:00:00.000Z",
            to: "2026-07-24T12:00:00.000Z",
            days: 14,
          },
          providers: [{
            providerId: "official",
            providerName: "Official",
            fetchedCount: fetchedEvents.length,
            acceptedCount: fetchedEvents.length,
            rejectedCount: 0,
            lastSuccessAt: "2026-07-24T12:00:00.000Z",
          }],
          events: fetchedEvents,
        };
      },
    },
    xtrace: {
      async listOpenIngestJobs() {
        return [];
      },
      async pollIngestJob() {
        throw new Error("No jobs expected");
      },
      async recallDealContext(input) {
        recallQueries.push(input.query);
        const dealId = input.candidateDealIds[0];
        const bundle = bundles.find((candidate) =>
          candidate.dealId === dealId
        )!;
        return [{
          dealId,
          memoryId: `memory_${dealId}`,
          memoryType: "semantic",
          text: `${bundle.companyName} is described in the supplied deck.`,
          score: 0.9,
          provenance: "source_document",
          sourceIds: bundle.facts.flatMap((fact) =>
            fact.sources.map((source) => source.id)
          ),
          fixtureIds: bundle.interactions.map((interaction) => interaction.id),
        }];
      },
    },
    reasoner: {
      async reason(input) {
        reasonerEventIds = input.events.map((event) => event.id);
        return [];
      },
    },
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  assert.deepEqual(
    reasonerEventIds,
    Array.from({ length: 20 }, (_, offset) => `market_${22 - offset}`),
  );
  assert.equal(recallQueries.length, 19);
  assert.ok(
    recallQueries.every((query) => query.length <= 4_000),
    "Every Deal recall query must stay within the XTrace limit",
  );
  assert.ok(recallQueries.some((query) => /Ably/i.test(query)));
  assert.equal(
    (await intelligence.listMarketEvents("workspace_demo")).length,
    fetchedEvents.length,
  );
  assert.equal(result.run.status, "completed", JSON.stringify(result.run.warnings));
  assert.ok(result.run.warnings.every((warning) =>
    !/lower-ranked market events were excluded/i.test(warning)
  ));
  assert.match(result.report.marketSummary, /selected 20 of 23/i);
});

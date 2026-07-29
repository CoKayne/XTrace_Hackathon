import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketEventsReadPath,
  createMemoryIntelligenceRepository,
  createSupabaseIntelligenceRepository,
  type IntelligenceReportRecord,
  type IntelligenceReportWrite,
} from "../../db/repositories/intelligence";
import * as intelligenceRepositoryModule from "../../db/repositories/intelligence";
import type { CompanyAnalysis } from "../../lib/contracts/domain";
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

function companyAnalysis(
  index: number,
  outcome: CompanyAnalysis["outcome"] = "no_material_change",
): CompanyAnalysis {
  const dealId = `deal_${String(index).padStart(2, "0")}`;
  const source = {
    id: `source_${dealId}`,
    provenance: "source_document" as const,
    title: `Company ${index} pitch deck`,
    documentId: `document_${index}`,
    page: 1,
    excerpt: `Company ${index} source evidence.`,
  };
  return {
    id: `analysis_${index}`,
    reportId: "report_complete",
    runId: "00000000-0000-4000-8000-000000000001",
    dealId,
    companyName: `Company ${index}`,
    dealStatus: "passed",
    outcome,
    confidence: outcome === "belief_revised" ? "medium" : "low",
    score: outcome === "belief_revised" ? 0.75 : 0.1,
    verifiedSourceCount: 1,
    investmentMemory: {
      previousMeetingSummary: "The company was reviewed.",
      decisionReason: "The fund passed at the prior review.",
      concerns: [],
      revisitConditions: [],
      lastEvaluatedAt: "2026-01-01T12:00:00.000Z",
      memoryIds: [`memory_${index}`],
      sourceIds: [source.id],
      fixtureIds: [],
    },
    marketEvidence: {
      relationship: outcome === "belief_revised" ? "related" : "none",
      explanation: outcome === "belief_revised"
        ? "A source-backed market change may affect this company."
        : "No material market evidence matched this company during the current 14-day scan.",
      eventIds: [],
      events: [],
      sourceIds: outcome === "belief_revised" ? [source.id] : [],
    },
    implications: { positive: [], negative: [] },
    recommendedNextMove: outcome === "belief_revised"
      ? "Review the cited evidence and decide whether to reopen internal diligence."
      : "No immediate follow-up recommended. Continue monitoring.",
    companyBrief: {
      icSnapshot: [{
        label: "Company",
        value: `Company ${index}`,
        unavailableReason: null,
        sourceIds: [source.id],
      }],
      traction: [],
      dealTerms: [],
      risks: [],
      decisionHistory: [{
        occurredAt: "2026-01-01T12:00:00.000Z",
        title: "Previous review",
        summary: "The fund passed at the prior review.",
        sourceIds: [source.id],
      }],
      sourceLineage: [source],
    },
    sources: [source],
    createdAt: "2026-07-24T12:00:00.000Z",
  };
}

function completeReport(
  companyAnalyses = Array.from({ length: 19 }, (_, index) =>
    companyAnalysis(index + 1)
  ),
): IntelligenceReportRecord {
  return {
    id: "report_complete",
    workspaceId: "workspace_demo",
    runId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "No material changes.",
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 12,
      truncatedPublicEvents: 0,
      recalledDealCount: 19,
      unavailableDealCount: 0,
    },
    counts: {
      companyCount: 19,
      beliefRevised: 0,
      monitor: 0,
      noMaterialChange: 19,
      analysisUnavailable: 0,
    },
    priorityDealId: null,
    opportunities: [],
    companyAnalyses,
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

test("Supabase market event upserts accept successful empty responses", async () => {
  const createSupabaseRepository = (
    intelligenceRepositoryModule as typeof intelligenceRepositoryModule & {
      createSupabaseIntelligenceRepository?: (options: {
        url: string;
        serviceRoleKey: string;
        fetchImpl: typeof fetch;
      }) => {
        saveMarketEvents(events: NormalizedMarketEvent[]): Promise<void>;
      };
    }
  ).createSupabaseIntelligenceRepository;
  assert.equal(
    typeof createSupabaseRepository,
    "function",
    "the Supabase intelligence repository must be directly testable",
  );

  const repository = createSupabaseRepository!({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async () => new Response(null, { status: 201 }),
  });

  await repository.saveMarketEvents([event("empty-write-response")]);
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
    "analysisStatus",
    "companyAnalyses",
    "counts",
    "createdAt",
    "evidenceCoverage",
    "id",
    "marketSummary",
    "opportunities",
    "priorityDealId",
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
  const fetched = await repository.getReport(report.workspaceId, report.id);
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

test("report repository reads normalize malformed durable opportunity shapes", async () => {
  const repository = createMemoryIntelligenceRepository();
  const malformedValues: unknown[] = [
    {},
    42,
    null,
    [null, "legacy", 42, {}, { rank: 0 }],
  ];

  for (const [index, opportunities] of malformedValues.entries()) {
    const report = {
      id: `report_malformed_${index}`,
      workspaceId: "workspace_demo",
      runId: `run_malformed_${index}`,
      createdAt: "2026-07-23T12:00:00.000Z",
      marketSummary: "Summary.",
      opportunities,
    } as unknown as IntelligenceReportWrite;
    await repository.saveReport(report);

    const fetched = await repository.getReport(report.workspaceId, report.id);
    assert.ok(fetched);
    assert.deepEqual(fetched.opportunities, [], report.id);
  }
});

test("stores one report with exactly nineteen ordered company analyses", async () => {
  const repository = createMemoryIntelligenceRepository();
  const report = completeReport();

  await repository.saveReport(report);

  const stored = await repository.getReport(report.workspaceId, report.id);
  assert.equal(stored?.companyAnalyses.length, 19);
  assert.equal(stored?.counts.noMaterialChange, 19);
  assert.equal(
    (await repository.getReportByRunId(report.workspaceId, report.runId))?.id,
    report.id,
  );
  assert.deepEqual(
    stored?.companyAnalyses.map((analysis) => analysis.dealId),
    report.companyAnalyses.map((analysis) => analysis.dealId),
  );
});

test("lists a Deal's analyses newest first", async () => {
  const repository = createMemoryIntelligenceRepository();
  const older = completeReport();
  const newerAnalysis = {
    ...companyAnalysis(1, "belief_revised"),
    id: "analysis_new",
    reportId: "report_new",
    runId: "00000000-0000-4000-8000-000000000002",
    createdAt: "2026-07-25T12:00:00.000Z",
  };
  const newerAnalyses = [
    newerAnalysis,
    ...Array.from({ length: 18 }, (_, index) => ({
      ...companyAnalysis(index + 2),
      id: `analysis_new_${index + 2}`,
      reportId: "report_new",
      runId: newerAnalysis.runId,
      createdAt: newerAnalysis.createdAt,
    })),
  ];

  await repository.saveReport(older);
  await repository.saveReport({
    ...completeReport(newerAnalyses),
    id: "report_new",
    runId: newerAnalysis.runId,
    createdAt: newerAnalysis.createdAt,
    counts: {
      companyCount: 19,
      beliefRevised: 1,
      monitor: 0,
      noMaterialChange: 18,
      analysisUnavailable: 0,
    },
    priorityDealId: newerAnalysis.dealId,
  });

  assert.deepEqual(
    (
      await repository.listDealAnalyses("workspace_demo", newerAnalysis.dealId)
    ).map((analysis) => analysis.id),
    ["analysis_new", "analysis_1"],
  );
});

test("Supabase report writes use the atomic report RPC", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const report = completeReport();
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return Response.json([{
        id: report.id,
        workspace_id: report.workspaceId,
        run_id: report.runId,
        created_at: report.createdAt,
        market_summary: report.marketSummary,
        opportunities: [],
        analysis_status: report.analysisStatus,
        company_count: 19,
        belief_revised_count: 0,
        monitor_count: 0,
        no_material_change_count: 19,
        analysis_unavailable_count: 0,
        priority_deal_id: null,
        evidence_coverage: report.evidenceCoverage,
      }]);
    },
  });

  const stored = await repository.saveReport(report);

  assert.equal(
    requests[0].url,
    "https://example.supabase.co/rest/v1/rpc/save_intelligence_report",
  );
  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.p_analyses.length, 19);
  assert.equal(body.p_report.companyCount, 19);
  assert.equal(stored.companyAnalyses.length, 19);
  assert.equal(
    JSON.stringify(stored).includes("test-service-role-key"),
    false,
  );
});

test("Supabase reads accept PostgREST timestamptz offset timestamps", async () => {
  const report = completeReport();
  const offsetCreatedAt = "2026-07-25T00:55:05.106+00:00";
  const analysisRows = report.companyAnalyses.map((analysis) => ({
    id: analysis.id,
    workspace_id: report.workspaceId,
    report_id: report.id,
    run_id: analysis.runId,
    deal_id: analysis.dealId,
    company_name: analysis.companyName,
    deal_status: analysis.dealStatus,
    outcome: analysis.outcome,
    confidence: analysis.confidence,
    score: analysis.score,
    investment_memory: analysis.investmentMemory,
    market_evidence: analysis.marketEvidence,
    implications: analysis.implications,
    recommended_next_move: analysis.recommendedNextMove,
    company_brief: analysis.companyBrief,
    source_refs: analysis.sources,
    created_at: offsetCreatedAt,
  }));
  const repository = createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/intelligence_reports")) {
        return Response.json([{
          id: report.id,
          workspace_id: report.workspaceId,
          run_id: report.runId,
          created_at: offsetCreatedAt,
          market_summary: report.marketSummary,
          opportunities: [],
          analysis_status: report.analysisStatus,
          company_count: 19,
          belief_revised_count: 0,
          monitor_count: 0,
          no_material_change_count: 19,
          analysis_unavailable_count: 0,
          priority_deal_id: null,
          evidence_coverage: report.evidenceCoverage,
        }]);
      }
      if (url.includes("/company_analyses")) {
        return Response.json(analysisRows);
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const fetched = await repository.getReportByRunId(
    report.workspaceId,
    report.runId,
  );
  assert.equal(fetched?.companyAnalyses.length, 19);
  assert.equal(fetched?.companyAnalyses[0]?.createdAt, offsetCreatedAt);

  const dealAnalyses = await repository.listDealAnalyses(
    report.workspaceId,
    report.companyAnalyses[0].dealId,
  );
  assert.equal(dealAnalyses.length, 19);
});

test("resetScanProducts wipes reports and market events but nothing else is reachable", async () => {
  const repository = createMemoryIntelligenceRepository({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  await repository.saveMarketEvents([event("wiped")]);
  await repository.saveReport({
    id: "report_wiped",
    workspaceId: "workspace_demo",
    runId: "run_wiped",
    createdAt: "2026-07-23T12:00:00.000Z",
    marketSummary: "To be wiped.",
    opportunities: [],
  });

  await repository.resetScanProducts("workspace_demo");

  assert.deepEqual(await repository.listReports("workspace_demo"), []);
  assert.deepEqual(await repository.listMarketEvents("workspace_demo"), []);
});

test("Supabase resetScanProducts keeps queued and running scans alive", async () => {
  const deletePaths: string[] = [];
  const repository = intelligenceRepositoryModule.createSupabaseIntelligenceRepository({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") deletePaths.push(String(input));
      return new Response(null, { status: 204 });
    },
  });

  await repository.resetScanProducts("workspace_demo");

  assert.equal(deletePaths.length, 4);
  const runsDelete = deletePaths.find((path) => path.includes("/scan_runs"));
  assert.ok(runsDelete, "finished scan runs must be wiped");
  assert.match(
    runsDelete!,
    /status=in\.\(completed,partial,failed\)/,
    "queued and running scans must survive the reset",
  );
});

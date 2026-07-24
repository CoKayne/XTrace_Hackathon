import assert from "node:assert/strict";
import test from "node:test";

import { GET as listReports } from "../../app/api/reports/route";
import { GET as getReport } from "../../app/api/reports/[id]/route";
import { GET as getCompanyAnalysis } from "../../app/api/reports/[id]/companies/[dealId]/route";
import { GET as listDealAnalyses } from "../../app/api/deals/[id]/analyses/route";
import { getIntelligenceRepository } from "../../db/repositories/intelligence";
import { buildPreloadedDealMemoryBundles } from "../../lib/corpus/service";
import {
  buildCompanyAnalyses,
  countCompanyAnalyses,
} from "../../lib/reports/company-analysis";
import type { MemoryContext } from "../../lib/xtrace/service";

const RUN_ID = "00000000-0000-4000-8000-000000000091";
const REPORT_ID = "report_company_route";

async function persistCompleteReport() {
  const bundles = buildPreloadedDealMemoryBundles();
  const contexts = new Map<string, MemoryContext[]>(
    bundles.map((bundle) => [
      bundle.dealId,
      [{
        dealId: bundle.dealId,
        memoryId: `memory_${bundle.dealId}`,
        memoryType: "fact",
        text: `Verified memory for ${bundle.companyName}.`,
        score: 0.9,
        provenance: "source_document",
        sourceIds: bundle.facts.flatMap((fact) =>
          fact.sources.map((source) => source.id)
        ),
        fixtureIds: bundle.interactions.map((interaction) => interaction.id),
      }],
    ]),
  );
  const companyAnalyses = buildCompanyAnalyses({
    reportId: REPORT_ID,
    runId: RUN_ID,
    createdAt: "2026-07-24T12:00:00.000Z",
    bundles,
    contextsByDeal: contexts,
    recallFailures: new Set(),
    groundedMatches: [],
  });
  await getIntelligenceRepository().saveReport({
    id: REPORT_ID,
    workspaceId: "workspace_demo",
    runId: RUN_ID,
    createdAt: "2026-07-24T12:00:00.000Z",
    marketSummary: "No material market change was found.",
    opportunities: [],
    analysisStatus: "completed",
    evidenceCoverage: {
      acceptedPublicEvents: 0,
      excludedPublicItems: 2,
      truncatedPublicEvents: 0,
      recalledDealCount: 19,
      unavailableDealCount: 0,
    },
    counts: countCompanyAnalyses(companyAnalyses),
    priorityDealId: null,
    companyAnalyses,
  });
}

test("report APIs return the full nineteen-company intelligence contract", async () => {
  await persistCompleteReport();

  const byRunResponse = await listReports(
    new Request(`http://localhost/api/reports?runId=${RUN_ID}`),
  );
  const byRun = await byRunResponse.json() as {
    data: Array<Record<string, unknown>>;
  };
  assert.equal(byRun.data.length, 1);
  assert.equal(byRun.data[0].runId, RUN_ID);

  const reportResponse = await getReport(
    new Request(`http://localhost/api/reports/${REPORT_ID}`),
    { params: Promise.resolve({ id: REPORT_ID }) },
  );
  const report = await reportResponse.json() as {
    data: {
      companyAnalyses: Array<{ dealId: string }>;
      counts: { companyCount: number };
      workerId?: string;
    };
  };
  assert.equal(report.data.companyAnalyses.length, 19);
  assert.equal(report.data.counts.companyCount, 19);
  assert.equal("workerId" in report.data, false);
});

test("company brief and Deal history APIs read persisted analyses", async () => {
  await persistCompleteReport();

  const companyResponse = await getCompanyAnalysis(
    new Request(
      `http://localhost/api/reports/${REPORT_ID}/companies/deal_7bridges`,
    ),
    {
      params: Promise.resolve({
        id: REPORT_ID,
        dealId: "deal_7bridges",
      }),
    },
  );
  assert.equal(companyResponse.status, 200);
  const company = await companyResponse.json() as {
    data: { dealId: string; companyBrief: { sourceLineage: unknown[] } };
  };
  assert.equal(company.data.dealId, "deal_7bridges");
  assert.ok(company.data.companyBrief.sourceLineage.length > 0);

  const historyResponse = await listDealAnalyses(
    new Request("http://localhost/api/deals/deal_7bridges/analyses"),
    { params: Promise.resolve({ id: "deal_7bridges" }) },
  );
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json() as {
    data: Array<{ dealId: string }>;
  };
  assert.ok(history.data.length >= 1);
  assert.ok(history.data.every((analysis) =>
    analysis.dealId === "deal_7bridges"
  ));
});

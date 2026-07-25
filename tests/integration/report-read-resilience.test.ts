import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

import { GET as listReports } from "../../app/api/reports/route";
import { GET as getReport } from "../../app/api/reports/[id]/route";
import { GET as getReportCompany } from "../../app/api/reports/[id]/companies/[dealId]/route";
import { GET as listDealAnalyses } from "../../app/api/deals/[id]/analyses/route";

async function expectRetryableEnvelope(response: Response) {
  assert.equal(response.status, 503);
  const body = await response.json() as {
    error?: { code?: string; retryable?: boolean };
  };
  assert.equal(body.error?.code, "INTEGRATION_UNAVAILABLE");
  assert.equal(body.error?.retryable, true);
}

test("report list failures return a retryable error envelope instead of crashing", async () => {
  const response = await listReports(
    new Request("http://localhost/api/reports"),
  );
  await expectRetryableEnvelope(response);
});

test("single report failures return a retryable error envelope instead of crashing", async () => {
  const response = await getReport(
    new Request("http://localhost/api/reports/report_x"),
    { params: Promise.resolve({ id: "report_x" }) },
  );
  await expectRetryableEnvelope(response);
});

test("company brief failures return a retryable error envelope instead of crashing", async () => {
  const response = await getReportCompany(
    new Request("http://localhost/api/reports/report_x/companies/deal_x"),
    { params: Promise.resolve({ id: "report_x", dealId: "deal_x" }) },
  );
  await expectRetryableEnvelope(response);
});

test("deal analysis history failures return a retryable error envelope instead of crashing", async () => {
  const response = await listDealAnalyses(
    new Request("http://localhost/api/deals/deal_x/analyses"),
    { params: Promise.resolve({ id: "deal_x" }) },
  );
  await expectRetryableEnvelope(response);
});

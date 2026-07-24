import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { jsonOk } from "../../../lib/api/response";
import { toPublicReport } from "../../../lib/reports/public";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId")?.trim();
  const repository = getIntelligenceRepository();
  const reports = runId
    ? [await repository.getReportByRunId(runId)].filter(
        (report) => report !== null,
      )
    : await repository.listReports(WORKSPACE_ID);
  return jsonOk(reports.map(toPublicReport));
}

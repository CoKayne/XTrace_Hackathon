import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { jsonOk } from "../../../lib/api/response";
import { toPublicReport } from "../../../lib/reports/public";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET() {
  const reports = await getIntelligenceRepository().listReports(WORKSPACE_ID);
  return jsonOk(reports.map(toPublicReport));
}

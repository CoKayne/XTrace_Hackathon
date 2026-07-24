import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { jsonError, jsonOk } from "../../../../lib/api/response";
import { toPublicReport } from "../../../../lib/reports/public";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const report = await getIntelligenceRepository().getReport(id);
  return report
    ? jsonOk(toPublicReport(report))
    : jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
}

import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";
import { toPublicReport } from "../../../../lib/reports/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const requestContext = await resolveRequestContext(request);
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const report = await getIntelligenceRepository().getReport(
      requestContext.workspaceId,
      id,
    );
    return report
      ? jsonOk(toPublicReport(report))
      : jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

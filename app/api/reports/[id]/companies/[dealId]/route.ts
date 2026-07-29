import { getIntelligenceRepository } from "../../../../../../db/repositories/intelligence";
import { errorResponse, jsonError, jsonOk } from "../../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../../../lib/api/safety";
import { toPublicCompanyAnalysis } from "../../../../../../lib/reports/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; dealId: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readWorkspace");
    const { id, dealId } = await context.params;
    const report = await getIntelligenceRepository().getReport(
      requestContext.workspaceId,
      id,
    );
    if (!report) {
      return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
    }
  const analysis = report.companyAnalyses.find(
    (candidate) => candidate.dealId === dealId,
  );
  if (!analysis) {
    return jsonError(
      "NOT_FOUND",
      `Deal ${dealId} was not analyzed in Report ${id}`,
      404,
    );
  }
  const publicAnalysis = toPublicCompanyAnalysis(analysis);
  return publicAnalysis
    ? jsonOk(publicAnalysis)
    : jsonError(
        "INTEGRATION_UNAVAILABLE",
        `Deal ${dealId} has invalid persisted analysis data`,
        503,
        true,
      );
  } catch (error) {
    return errorResponse(error);
  }
}

import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { toPublicReport } from "../../../lib/reports/public";
import { getTestGenerationRepository } from "../../../db/repositories/test-generations";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const runId = new URL(request.url).searchParams.get("runId")?.trim();
    const repository = getIntelligenceRepository();
    const resetAt = runId
      ? null
      : await getTestGenerationRepository().currentResetAt(
        context.workspaceId,
      );
    const reports = runId
      ? [await repository.getReportByRunId(context.workspaceId, runId)].filter(
          (report) => report !== null,
        )
      : await repository.listReports(context.workspaceId, resetAt);
    return jsonOk(reports.map(toPublicReport));
  } catch (error) {
    return errorResponse(error);
  }
}

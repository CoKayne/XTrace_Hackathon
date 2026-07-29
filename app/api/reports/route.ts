import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { toPublicReport } from "../../../lib/reports/public";

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
    const reports = runId
      ? [await repository.getReportByRunId(context.workspaceId, runId)].filter(
          (report) => report !== null,
        )
      : await repository.listReports(context.workspaceId);
    return jsonOk(reports.map(toPublicReport));
  } catch (error) {
    return errorResponse(error);
  }
}

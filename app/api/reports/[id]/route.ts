import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { getUnderwritingArtifactsRepository } from "../../../../db/repositories/underwriting-artifacts";
import { getUnderwritingRunsRepository } from "../../../../db/repositories/underwriting-runs";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { toPublicReport } from "../../../../lib/reports/public";
import {
  buildUnderwritingBatchSummary,
} from "../../../../lib/underwriting/read-model";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const report = await (
      dependencies.intelligence ?? getIntelligenceRepository()
    ).getReport(
      requestContext.workspaceId,
      id,
    );
    if (!report) {
      return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
    }
    const underwritingBatch = requestContext.mode === "product"
      ? await buildUnderwritingBatchSummary({
        workspaceId: requestContext.workspaceId,
        scanRunId: report.runId,
        runs: dependencies.underwritingRuns
          ?? getUnderwritingRunsRepository(),
        artifacts: dependencies.underwritingArtifacts
          ?? getUnderwritingArtifactsRepository(),
      })
      : null;
    return jsonOk({
      ...toPublicReport(report),
      ...(underwritingBatch ? { underwritingBatch } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

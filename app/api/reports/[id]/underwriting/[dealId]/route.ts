import { getIntelligenceRepository } from "../../../../../../db/repositories/intelligence";
import { getUnderwritingArtifactsRepository } from "../../../../../../db/repositories/underwriting-artifacts";
import { getUnderwritingRunsRepository } from "../../../../../../db/repositories/underwriting-runs";
import {
  errorResponse,
  jsonError,
  jsonOk,
} from "../../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../../../lib/api/safety";
import {
  findCandidateForReportDeal,
  toCandidateUnderwritingDetail,
} from "../../../../../../lib/underwriting/read-model";
import { isDurableWorkspaceMode } from "../../../../../../lib/auth/request-context";

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
    if (!isDurableWorkspaceMode(requestContext.mode)) throw new Error("FORBIDDEN");
    const { id, dealId } = await context.params;
    const report = await (
      dependencies.intelligence ?? getIntelligenceRepository()
    ).getReport(requestContext.workspaceId, id);
    if (!report) {
      return jsonError("NOT_FOUND", `Report ${id} was not found`, 404);
    }
    const candidate = await findCandidateForReportDeal({
      workspaceId: requestContext.workspaceId,
      scanRunId: report.runId,
      dealId,
      runs: dependencies.underwritingRuns
        ?? getUnderwritingRunsRepository(),
    });
    if (!candidate) {
      return jsonError(
        "NOT_FOUND",
        `Deal ${dealId} has no underwriting candidate in Report ${id}`,
        404,
      );
    }
    const bundle = await (
      dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository()
    ).getByCandidateRunId({
      workspaceId: requestContext.workspaceId,
      candidateRunId: candidate.id,
    });
    if (!bundle) {
      return jsonError(
        "NOT_FOUND",
        `Deal ${dealId} has no finalized underwriting detail`,
        404,
      );
    }
    return jsonOk(toCandidateUnderwritingDetail(bundle));
  } catch (error) {
    return errorResponse(error);
  }
}

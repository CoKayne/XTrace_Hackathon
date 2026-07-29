import { getIntelligenceRepository } from "../../../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../../../lib/api/response";
import { requirePermission } from "../../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../../lib/auth/request-context";
import { toPublicCompanyAnalysis } from "../../../../../lib/reports/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const requestContext = await resolveRequestContext(request);
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const analyses = await getIntelligenceRepository().listDealAnalyses(
      requestContext.workspaceId,
      id,
    );
    return jsonOk(analyses.flatMap((analysis) => {
      const publicAnalysis = toPublicCompanyAnalysis(analysis);
      return publicAnalysis ? [publicAnalysis] : [];
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

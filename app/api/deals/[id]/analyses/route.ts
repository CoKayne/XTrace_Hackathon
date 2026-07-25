import { getIntelligenceRepository } from "../../../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../../../lib/api/response";
import { toPublicCompanyAnalysis } from "../../../../../lib/reports/public";

const WORKSPACE_ID = "workspace_demo";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const analyses = await getIntelligenceRepository().listDealAnalyses(
      WORKSPACE_ID,
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

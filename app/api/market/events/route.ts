import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "readWorkspace");
    return jsonOk(
      await getIntelligenceRepository().listMarketEvents(context.workspaceId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

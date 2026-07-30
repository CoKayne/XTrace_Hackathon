import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { getTestGenerationRepository } from "../../../../db/repositories/test-generations";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const resetAt = await getTestGenerationRepository().currentResetAt(
      context.workspaceId,
    );
    return jsonOk(
      await getIntelligenceRepository().listMarketEvents(
        context.workspaceId,
        resetAt,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

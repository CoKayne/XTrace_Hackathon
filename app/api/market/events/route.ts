import { getIntelligenceRepository } from "../../../../db/repositories/intelligence";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    return jsonOk(
      await getIntelligenceRepository().listMarketEvents(context.workspaceId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    return jsonOk(buildDemoViewModel().documents);
  } catch (error) {
    return errorResponse(error);
  }
}

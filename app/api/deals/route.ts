import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim().toLocaleLowerCase() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const deals = buildDemoViewModel().deals.filter((deal) => {
      if (status && deal.status !== status) return false;
      if (!query) return true;
      return [
        deal.companyName,
        deal.status,
        deal.sourceTitle,
        deal.fixture?.meetingSummary,
        deal.fixture?.decisionReason,
        ...(deal.fixture?.concerns ?? []),
        ...(deal.fixture?.revisitConditions ?? []),
      ].join(" ").toLocaleLowerCase().includes(query);
    });
    return jsonOk(deals);
  } catch (error) {
    return errorResponse(error);
  }
}

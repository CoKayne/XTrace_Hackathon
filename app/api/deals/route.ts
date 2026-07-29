import { errorResponse, jsonOk } from "../../../lib/api/response";
import { requirePermission } from "../../../lib/api/safety";
import { resolveRequestContext } from "../../../lib/auth/request-context";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
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

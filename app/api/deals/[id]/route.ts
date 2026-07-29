import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";
import { buildDemoViewModel } from "../../../../lib/demo/view-model";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const requestContext = await resolveRequestContext(request);
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const deal = buildDemoViewModel().deals.find((candidate) => candidate.id === id);
    return deal
      ? jsonOk(deal)
      : jsonError("NOT_FOUND", `Deal ${id} was not found`, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

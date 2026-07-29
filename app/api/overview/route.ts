import { errorResponse, jsonOk } from "../../../lib/api/response";
import { requirePermission } from "../../../lib/api/safety";
import { resolveRequestContext } from "../../../lib/auth/request-context";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "readWorkspace");
    return jsonOk(buildDemoViewModel());
  } catch (error) {
    return errorResponse(error);
  }
}

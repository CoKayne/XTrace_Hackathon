import { errorResponse, jsonOk } from "../../../lib/api/response";
import { requirePermission } from "../../../lib/api/safety";
import { resolveRequestContext } from "../../../lib/auth/request-context";
import { buildDemoViewModel } from "../../../lib/demo/view-model";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "readWorkspace");
    return jsonOk(buildDemoViewModel().documents);
  } catch (error) {
    return errorResponse(error);
  }
}

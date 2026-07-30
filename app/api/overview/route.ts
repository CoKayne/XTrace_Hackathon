import { errorResponse, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import { buildDemoViewModel } from "../../../lib/demo/view-model";
import { getDealRegistry } from "../../../db/repositories/deal-registry";
import { getIntelligenceRepository } from "../../../db/repositories/intelligence";
import { getUploadedDocumentsRepository } from "../../../db/repositories/uploaded-documents";
import { buildProductOverview } from "../../../lib/deals/read-model";
import { isDurableWorkspaceMode } from "../../../lib/auth/request-context";

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
      isDurableWorkspaceMode(context.mode)
        ? await buildProductOverview({
          workspaceId: context.workspaceId,
          deals: dependencies.dealRegistry ?? getDealRegistry(),
          intelligence:
            dependencies.intelligence ?? getIntelligenceRepository(),
          uploads: dependencies.uploadedDocuments
            ?? getUploadedDocumentsRepository(),
          now: dependencies.now ?? Date.now,
        })
        : buildDemoViewModel(),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

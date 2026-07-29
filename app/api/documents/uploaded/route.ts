import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { toPublicUploadedDocument } from "../../../../lib/uploads/public";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readPrivateSources");
    const records = await (
      dependencies.uploadedDocuments ?? getUploadedDocumentsRepository()
    ).list(
      context.workspaceId,
    );
    return jsonOk(records.map(toPublicUploadedDocument));
  } catch (error) {
    return errorResponse(error);
  }
}

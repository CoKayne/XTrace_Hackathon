import { getDealRegistry } from "../../../../db/repositories/deal-registry";
import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import {
  createUploadConfirmationService,
  toUploadRecoveryDetailDto,
} from "../../../../lib/uploads/confirmation";
import { getSourceRegistry } from "../../../../db/repositories/source-registry";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "readPrivateSources");
    const { id } = await context.params;
    const uploads = dependencies.uploadedDocuments
      ?? getUploadedDocumentsRepository();
    const upload = await uploads.get({
      workspaceId: requestContext.workspaceId,
      id,
    });
    if (!upload) {
      return jsonError("NOT_FOUND", "Upload was not found", 404);
    }
    const service = createUploadConfirmationService({
      uploads,
      sources: dependencies.sourceRegistry ?? getSourceRegistry(),
      deals: dependencies.dealRegistry ?? getDealRegistry(),
    });
    return jsonOk(toUploadRecoveryDetailDto(
      upload,
      await service.listCandidateDeals(requestContext.workspaceId),
    ));
  } catch (error) {
    return errorResponse(error);
  }
}

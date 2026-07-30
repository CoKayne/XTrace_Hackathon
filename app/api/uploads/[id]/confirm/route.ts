import { getDealRegistry } from "../../../../../db/repositories/deal-registry";
import { getSourceRegistry } from "../../../../../db/repositories/source-registry";
import { getUploadedDocumentsRepository } from "../../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonError, jsonOk } from "../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../../lib/api/safety";
import { ConfirmUploadSchema } from "../../../../../lib/contracts/http";
import {
  createUploadConfirmationService,
  UploadConfirmationConflictError,
  UploadConfirmationNotFoundError,
} from "../../../../../lib/uploads/confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: RouteDependencies = {},
) {
  try {
    const requestContext = await resolveRouteRequestContext(
      request,
      dependencies,
    );
    requirePermission(requestContext, "mutateSources");
    const choice = ConfirmUploadSchema.parse(await request.json());
    const { id } = await context.params;
    const service = createUploadConfirmationService({
      uploads: dependencies.uploadedDocuments
        ?? getUploadedDocumentsRepository(),
      sources: dependencies.sourceRegistry ?? getSourceRegistry(),
      deals: dependencies.dealRegistry ?? getDealRegistry(),
    });
    return jsonOk(await service.confirm({
      workspaceId: requestContext.workspaceId,
      uploadId: id,
      assignedByUserId: requestContext.principal!.userId,
      choice,
    }));
  } catch (error) {
    if (error instanceof UploadConfirmationNotFoundError) {
      return jsonError("NOT_FOUND", "Upload or Deal was not found", 404);
    }
    if (error instanceof UploadConfirmationConflictError) {
      return jsonError(
        "CONFLICT",
        "The upload confirmation conflicts with its current state",
        409,
      );
    }
    return errorResponse(error);
  }
}

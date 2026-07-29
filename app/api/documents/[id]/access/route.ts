import { getUploadedDocumentsRepository } from "../../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonError } from "../../../../../lib/api/response";
import { rateLimitRequest, requirePermission } from "../../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../../lib/auth/request-context";
import { getPreloadedDocument } from "../../../../../lib/corpus/manifest";
import { createDefaultPrivateDocumentAccess } from "../../../../../lib/storage/service";

export const runtime = "nodejs";
const PRIVATE_READ_TTL_SECONDS = 10 * 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const requestContext = await resolveRequestContext(request);
    requirePermission(requestContext, "readWorkspace");
    const { id } = await context.params;
    const preloaded = getPreloadedDocument(id);
    if (requestContext.mode === "public_demo") {
      if (!preloaded) {
        requirePermission(requestContext, "readPrivateSources");
      }
      return Response.redirect(
        new URL(`/api/documents/${encodeURIComponent(id)}`, request.url),
        307,
      );
    }

    requirePermission(requestContext, "readPrivateSources");
    const uploaded = preloaded
      ? null
      : await getUploadedDocumentsRepository().get({
          workspaceId: requestContext.workspaceId,
          id,
        });
    if (!preloaded && !uploaded) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    const rate = await rateLimitRequest(
      request,
      "document-access",
      30,
      undefined,
      { context: requestContext },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many document requests. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1_000)
      + PRIVATE_READ_TTL_SECONDS;
    const signedPath = await createDefaultPrivateDocumentAccess()
      .createPrivateReadUrl({
        capability: {
          workspaceId: requestContext.workspaceId,
          sourceRevisionId: id,
          objectVersion: preloaded?.checksum ?? uploaded!.checksum,
          expiresAtEpochSeconds,
          permission: "read",
        },
        expiresInSeconds: PRIVATE_READ_TTL_SECONDS,
      });
    return Response.redirect(new URL(signedPath, request.url), 307);
  } catch (error) {
    return errorResponse(error);
  }
}

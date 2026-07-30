import { getSourceRegistry } from "../../../../../db/repositories/source-registry";
import { errorResponse, jsonError } from "../../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../../../lib/api/safety";
import { getPreloadedDocument } from "../../../../../lib/corpus/manifest";
import { createDefaultPrivateDocumentAccess } from "../../../../../lib/storage/service";

export const runtime = "nodejs";
const PRIVATE_READ_TTL_SECONDS = 10 * 60;

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
    const revision = preloaded
      ? null
      : await (
          dependencies.sourceRegistry ?? getSourceRegistry()
        ).getRevision({
          workspaceId: requestContext.workspaceId,
          revisionId: id,
        });
    if (!preloaded && !revision) {
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
    const expiresAtEpochSeconds = Math.floor(
      (dependencies.now ?? Date.now)() / 1_000,
    )
      + PRIVATE_READ_TTL_SECONDS;
    const signedPath = await (
      dependencies.documentAccess ?? createDefaultPrivateDocumentAccess()
    )
      .createPrivateReadUrl({
        capability: {
          workspaceId: requestContext.workspaceId,
          sourceRevisionId: id,
          objectVersion: preloaded?.checksum ?? revision!.objectVersion,
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

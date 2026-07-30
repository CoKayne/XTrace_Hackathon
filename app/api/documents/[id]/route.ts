import { getSourceRegistry } from "../../../../db/repositories/source-registry";
import { errorResponse, jsonError } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import { getPreloadedDocument } from "../../../../lib/corpus/manifest";
import {
  createDefaultPrivateDocumentAccess,
  createDefaultPrivateObjectStorage,
  privateObjectKey,
  type PrivateObjectStorage,
} from "../../../../lib/storage/service";
import { isDurableWorkspaceMode } from "../../../../lib/auth/request-context";

export const runtime = "nodejs";

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
      return readDocumentObject({
        id,
        filename: preloaded!.filename,
        objectKey: privateObjectKey(preloaded!),
      }, dependencies.privateObjectStorage);
    }

    if (!isDurableWorkspaceMode(requestContext.mode)) throw new Error("FORBIDDEN");
    requirePermission(requestContext, "readPrivateSources");
    const capability = await (
      dependencies.documentAccess ?? createDefaultPrivateDocumentAccess()
    )
      .authorizePrivateRead(request);
    if (
      capability.workspaceId !== requestContext.workspaceId
      || capability.sourceRevisionId !== id
    ) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    const revision = preloaded
      ? null
      : await (
          dependencies.sourceRegistry ?? getSourceRegistry()
        ).getRevision({
          workspaceId: requestContext.workspaceId,
          revisionId: id,
        });
    const objectVersion = preloaded?.checksum
      ?? revision?.objectVersion;
    if (!objectVersion || capability.objectVersion !== objectVersion) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    return readDocumentObject({
      id,
      filename: preloaded?.filename
        ?? revision!.objectKey.split("/").at(-1)
        ?? "source",
      objectKey: preloaded
        ? privateObjectKey(preloaded)
        : revision!.objectKey,
      contentType: preloaded
        ? "application/pdf"
        : revision!.contentType,
    }, dependencies.privateObjectStorage);
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.startsWith("Private document")
        || error.message.startsWith("Invalid private document")
      )
    ) {
      return jsonError("NOT_FOUND", "Document was not found", 404);
    }
    return errorResponse(error);
  }
}

async function readDocumentObject(input: {
  id: string;
  filename: string;
  objectKey: string;
  contentType?: string;
}, storage?: PrivateObjectStorage): Promise<Response> {
  const bytes = await (
    storage ?? createDefaultPrivateObjectStorage()
  ).readPrivateObject(
    input.objectKey,
  );
  if (!bytes) {
    return jsonError("NOT_FOUND", `Document file ${input.id} is unavailable`, 404);
  }
  return new Response(toArrayBuffer(bytes), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(input.filename)}`,
      "content-length": String(bytes.byteLength),
      "content-type": input.contentType ?? "application/pdf",
      "x-content-type-options": "nosniff",
    },
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

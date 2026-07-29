import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonError } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";
import { getPreloadedDocument } from "../../../../lib/corpus/manifest";
import {
  createDefaultPrivateDocumentAccess,
  createDefaultPrivateObjectStorage,
  privateObjectKey,
} from "../../../../lib/storage/service";

export const runtime = "nodejs";

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
      return readDocumentObject({
        id,
        filename: preloaded!.filename,
        objectKey: privateObjectKey(preloaded!),
      });
    }

    requirePermission(requestContext, "readPrivateSources");
    const capability = await createDefaultPrivateDocumentAccess()
      .authorizePrivateRead(request);
    if (
      capability.workspaceId !== requestContext.workspaceId
      || capability.sourceRevisionId !== id
    ) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    const uploaded = preloaded
      ? null
      : await getUploadedDocumentsRepository().get({
          workspaceId: requestContext.workspaceId,
          id,
        });
    const objectVersion = preloaded?.checksum ?? uploaded?.checksum;
    if (!objectVersion || capability.objectVersion !== objectVersion) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    return readDocumentObject({
      id,
      filename: preloaded?.filename ?? uploaded!.filename,
      objectKey: preloaded ? privateObjectKey(preloaded) : uploaded!.objectKey,
      contentType: preloaded ? "application/pdf" : uploaded!.contentType,
    });
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
}): Promise<Response> {
  const bytes = await createDefaultPrivateObjectStorage().readPrivateObject(
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

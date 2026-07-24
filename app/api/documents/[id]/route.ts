import { jsonError } from "../../../../lib/api/response";
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
  const { id } = await context.params;
  const document = getPreloadedDocument(id);
  if (!document) {
    return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
  }

  try {
    const authorizedDocumentId = await createDefaultPrivateDocumentAccess().authorizePrivateRead(request);
    if (authorizedDocumentId !== id) {
      return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
    }
    const bytes = await createDefaultPrivateObjectStorage().readPrivateObject(privateObjectKey(document));
    if (!bytes) {
      return jsonError("NOT_FOUND", `Document file ${id} is unavailable`, 404);
    }
    return new Response(toArrayBuffer(bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        "content-length": String(bytes.byteLength),
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

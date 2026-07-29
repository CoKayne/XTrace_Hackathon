import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonCreated, jsonError, jsonOk } from "../../../../lib/api/response";
import { rateLimitRequest } from "../../../../lib/api/safety";
import { createDefaultPrivateObjectStorage } from "../../../../lib/storage/service";
import {
  MAX_UPLOAD_BYTES,
  resolveRuntimeUploadContentType,
  safeFilename,
  sha256Hex,
  uploadedDocumentId,
  uploadedObjectKey,
  UnsupportedUploadError,
} from "../../../../lib/uploads/service";

const WORKSPACE_ID = "workspace_demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uploads never join the fixed 14-document manifest or the 19-Deal scan
// universe: they are stored separately and extracted by the background worker.
export async function POST(request: Request) {
  const rate = await rateLimitRequest(request, "document-upload", 10, 10 * 60_000);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many uploads. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("VALIDATION_ERROR", "Attach a document to upload.", 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(
        "VALIDATION_ERROR",
        `Documents must be ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
        413,
      );
    }
    const filename = safeFilename(file.name);
    const contentType = resolveRuntimeUploadContentType({
      filename,
      reportedType: file.type,
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = await sha256Hex(bytes);
    const repository = getUploadedDocumentsRepository();

    const existing = await repository.findByChecksum(WORKSPACE_ID, checksum);
    if (existing) return jsonOk(existing);

    const id = uploadedDocumentId(checksum);
    const objectKey = uploadedObjectKey({
      workspaceId: WORKSPACE_ID,
      uploadId: id,
      filename,
    });
    await createDefaultPrivateObjectStorage().ensurePrivateObject({
      key: objectKey,
      bytes,
      contentType,
    });
    const record = await repository.create({
      id,
      workspaceId: WORKSPACE_ID,
      filename,
      contentType,
      byteSize: bytes.byteLength,
      checksum,
      objectKey,
    });
    return jsonCreated(record);
  } catch (error) {
    if (error instanceof UnsupportedUploadError) {
      return jsonError("VALIDATION_ERROR", error.message, 415);
    }
    return errorResponse(error);
  }
}

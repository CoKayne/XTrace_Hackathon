import { getUploadedDocumentsRepository } from "../../../db/repositories/uploaded-documents";
import { errorResponse, jsonError, jsonOk } from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { rateLimitRequest, requirePermission } from "../../../lib/api/safety";
import { createDefaultPrivateObjectStorage } from "../../../lib/storage/service";
import {
  MAX_UPLOAD_BYTES,
  resolveRuntimeUploadContentType,
  safeFilename,
  sha256Hex,
  uploadedDocumentId,
  uploadedObjectKey,
  UnsupportedUploadError,
} from "../../../lib/uploads/service";
import { toUploadRecoveryDto } from "../../../lib/uploads/confirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readPrivateSources");
    const uploads = dependencies.uploadedDocuments
      ?? getUploadedDocumentsRepository();
    return jsonOk(
      (await uploads.list(context.workspaceId)).map(toUploadRecoveryDto),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "mutateSources");
    const rate = await rateLimitRequest(
      request,
      "source-upload",
      10,
      10 * 60_000,
      { context },
    );
    if (!rate.allowed) {
      return jsonError(
        "RATE_LIMITED",
        `Too many uploads. Try again in ${rate.retryAfterSeconds} seconds.`,
        429,
        true,
      );
    }
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
    const uploads = dependencies.uploadedDocuments
      ?? getUploadedDocumentsRepository();
    const existing = await uploads.findByChecksum(
      context.workspaceId,
      checksum,
    );
    if (existing) {
      return accepted({
        uploadId: existing.id,
        status: existing.status,
      });
    }

    const id = uploadedDocumentId({
      workspaceId: context.workspaceId,
      checksum,
    });
    const objectKey = uploadedObjectKey({
      workspaceId: context.workspaceId,
      uploadId: id,
      filename,
    });
    await (
      dependencies.privateObjectStorage ?? createDefaultPrivateObjectStorage()
    ).ensurePrivateObject({ key: objectKey, bytes, contentType });
    const record = await uploads.create({
      id,
      workspaceId: context.workspaceId,
      filename,
      contentType,
      byteSize: bytes.byteLength,
      checksum,
      objectKey,
    });
    return accepted({ uploadId: record.id, status: record.status });
  } catch (error) {
    if (error instanceof UnsupportedUploadError) {
      return jsonError("VALIDATION_ERROR", error.message, 415);
    }
    return errorResponse(error);
  }
}

function accepted<T>(data: T) {
  return Response.json({ data }, { status: 202 });
}

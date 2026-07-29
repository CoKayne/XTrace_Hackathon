import { getUploadedDocumentsRepository } from "../../../../db/repositories/uploaded-documents";
import { errorResponse, jsonOk } from "../../../../lib/api/response";
import { requirePermission } from "../../../../lib/api/safety";
import { resolveRequestContext } from "../../../../lib/auth/request-context";
import { toPublicUploadedDocument } from "../../../../lib/uploads/public";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    requirePermission(context, "readPrivateSources");
    const records = await getUploadedDocumentsRepository().list(
      context.workspaceId,
    );
    return jsonOk(records.map(toPublicUploadedDocument));
  } catch (error) {
    return errorResponse(error);
  }
}

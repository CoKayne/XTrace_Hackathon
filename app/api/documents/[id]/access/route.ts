import { jsonError } from "../../../../../lib/api/response";
import { rateLimitRequest } from "../../../../../lib/api/safety";
import { getPreloadedDocument } from "../../../../../lib/corpus/manifest";
import { createDefaultPrivateDocumentAccess } from "../../../../../lib/storage/service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rate = await rateLimitRequest(request, "document-access", 30);
  if (!rate.allowed) {
    return jsonError(
      "RATE_LIMITED",
      `Too many document requests. Try again in ${rate.retryAfterSeconds} seconds.`,
      429,
      true,
    );
  }
  const { id } = await context.params;
  if (!getPreloadedDocument(id)) {
    return jsonError("NOT_FOUND", `Document ${id} was not found`, 404);
  }
  const signedPath = await createDefaultPrivateDocumentAccess().createPrivateReadUrl({
    documentId: id,
    expiresInSeconds: 10 * 60,
  });
  return Response.redirect(new URL(signedPath, request.url), 307);
}

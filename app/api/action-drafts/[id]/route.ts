import { getUnderwritingArtifactsRepository } from "../../../../db/repositories/underwriting-artifacts";
import { errorResponse, jsonError, jsonOk } from "../../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../../lib/api/route-dependencies";
import { requirePermission } from "../../../../lib/api/safety";
import {
  ReplaceActionDraftBodySchema,
} from "../../../../lib/contracts/http";
import { toPublicActionDraft } from "../../../../lib/underwriting/read-model";
import { isDurableWorkspaceMode } from "../../../../lib/auth/request-context";

export const dynamic = "force-dynamic";

export async function PATCH(
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
    if (!isDurableWorkspaceMode(requestContext.mode)) throw new Error("FORBIDDEN");
    if (!requestContext.principal) throw new Error("UNAUTHENTICATED");
    const { id } = await context.params;
    const input = ReplaceActionDraftBodySchema.parse(await request.json());
    const updated = await (
      dependencies.underwritingArtifacts
        ?? getUnderwritingArtifactsRepository()
    ).replaceActionDraftBody({
      workspaceId: requestContext.workspaceId,
      draftId: id,
      body: input.body,
    });
    return updated
      ? jsonOk(toPublicActionDraft(updated))
      : jsonError("NOT_FOUND", "Action draft was not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}

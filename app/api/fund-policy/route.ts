import {
  getUnderwritingReferencesRepository,
} from "../../../db/repositories/underwriting-references";
import {
  errorResponse,
  jsonError,
  jsonOk,
} from "../../../lib/api/response";
import {
  resolveRouteRequestContext,
  type RouteDependencies,
} from "../../../lib/api/route-dependencies";
import { requirePermission } from "../../../lib/api/safety";
import {
  createUnderwritingReferencesService,
} from "../../../lib/underwriting/references/service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "readWorkspace");
    const service = createUnderwritingReferencesService(
      dependencies.underwritingReferences
        ?? getUnderwritingReferencesRepository(),
    );
    return jsonOk(await service.activePolicy(context.workspaceId));
  } catch (error) {
    return policyErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  _routeContext?: unknown,
  dependencies: RouteDependencies = {},
) {
  try {
    const context = await resolveRouteRequestContext(request, dependencies);
    requirePermission(context, "managePolicy");
    const actorId = requireActorId(context);
    const service = createUnderwritingReferencesService(
      dependencies.underwritingReferences
        ?? getUnderwritingReferencesRepository(),
    );
    return jsonOk(await service.savePolicy({
      workspaceId: context.workspaceId,
      actorId,
      body: await request.json(),
    }));
  } catch (error) {
    return policyErrorResponse(error);
  }
}

function requireActorId(context: {
  principal: { userId: string } | null;
}): string {
  if (!context.principal) throw new Error("UNAUTHENTICATED");
  return context.principal.userId;
}

function policyErrorResponse(error: unknown): Response {
  if (
    error instanceof Error
    && error.message === "FUND_POLICY_VERSION_CONFLICT"
  ) {
    return jsonError(
      "CONFLICT",
      "The active Fund Policy changed. Refresh before saving.",
      409,
    );
  }
  if (
    error instanceof Error
    && error.message === "FUND_POLICY_VERSION_NOT_FOUND"
  ) {
    return jsonError("NOT_FOUND", "Fund Policy version not found.", 404);
  }
  return errorResponse(error);
}

export { policyErrorResponse, requireActorId };
